import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { SCALE, type Indexer } from "./indexer/index.js";
import { logger } from "./logger.js";
import { MARKETS, marketById } from "./markets.js";
import { PoolIndexer } from "./pool.js";
import { RelayBody, RelayError, type Circuit, type Relayer } from "./relayer.js";
import type { Reporter } from "./reporter.js";
import { bucketize } from "./store.js";

const STATIC_ORIGINS = new Set(["https://useparlo.xyz", "https://www.useparlo.xyz"]);
const extraOrigins = new Set((config.CORS_EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients
  if (STATIC_ORIGINS.has(origin) || extraOrigins.has(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return true;
  return false;
}

const RANGES = {
  "1h": { span: 3600, bucket: 60 },
  "24h": { span: 86_400, bucket: 300 },
  "7d": { span: 7 * 86_400, bucket: 1800 },
} as const;

interface Deps {
  indexer: Indexer;
  pool: PoolIndexer;
  relayer: Relayer;
  reporter: Reporter;
  vkeys: Record<string, string | null>;
}

export async function buildServer({ indexer, pool, relayer, reporter, vkeys }: Deps) {
  const app = Fastify({ loggerInstance: logger, trustProxy: true, bodyLimit: 256 * 1024 });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86_400,
  });
  await app.register(rateLimit, { global: false });

  app.get("/health", { logLevel: "warn" }, async () => ({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    chainId: config.CHAIN_ID,
    indexer: {
      lastTickAt: indexer.lastTickAt ?? null,
      lastTickMs: indexer.lastTickMs ?? null,
      intervalSec: config.INDEX_INTERVAL_SEC,
      sources: indexer.enabledSources(),
      simulate: config.SIMULATE,
    },
    pool: {
      configured: pool.configured,
      lastSyncedBlock: pool.lastSyncedBlock?.toString() ?? null,
      notes: pool.notes.length,
      positions: pool.positions.length,
      error: pool.lastError ?? null,
    },
    relayer: { configured: relayer.configured, address: relayer.address ?? null, vkeys: Object.fromEntries(Object.entries(vkeys).map(([k, v]) => [k, !!v])) },
    reporter: { configured: reporter.configured, address: reporter.address ?? null, lastRunAt: reporter.lastRunAt ?? null, error: reporter.lastError ?? null },
  }));

  app.get("/markets", async () => {
    const now = Math.floor(Date.now() / 1000);
    return MARKETS.map((m) => {
      const ring = indexer.rings.get(m.id)!;
      const st = indexer.states.get(m.id)!;
      const latest = ring.latest();
      const day = ring.range(now - 86_400, now);
      const spark = bucketize(day, now - 86_400, now, 1800).map((p) => p.v);
      const sparkline = spark.length ? spark : latest ? Array(48).fill(latest.v) : [];
      const ref = day.length ? day[0].v : undefined;
      const change24h = latest && ref ? Number((((latest.v - ref) / ref) * 100).toFixed(2)) : 0;
      return {
        id: m.id,
        symbol: m.symbol,
        name: m.name,
        kind: m.kind,
        score: latest?.v ?? null, // integer scaled 1e4 (100.0 = 1_000_000)
        scoreFloat: latest ? latest.v / SCALE : null,
        change24h, // percent
        sparkline, // 48 points, 30-minute buckets over the last 24h
        sources: st.lastSources,
        simulated: st.simulated,
        updatedAt: latest?.t ?? null,
      };
    });
  });

  const HistoryQuery = z.object({ range: z.enum(["1h", "24h", "7d"]).default("24h") });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>("/markets/:id/history", async (req, reply) => {
    const id = Number(req.params.id);
    const market = marketById.get(id);
    if (!market) return reply.code(404).send({ error: "unknown market" });
    const q = HistoryQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "range must be 1h|24h|7d" });
    const { span, bucket } = RANGES[q.data.range];
    const now = Math.floor(Date.now() / 1000);
    const points = indexer.rings.get(id)!.range(now - span, now);
    const out = bucket === 60 ? points : bucketize(points, now - span, now, bucket);
    return { id, symbol: market.symbol, range: q.data.range, resolutionSec: bucket, points: out.map((p) => ({ t: p.t, score: p.v })) };
  });

  const FromQuery = z.object({ from: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(5000).default(5000) });
  app.get<{ Querystring: Record<string, string> }>("/pool/notes", async (req, reply) => {
    const q = FromQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid from/limit" });
    return PoolIndexer.page(pool.notes, q.data.from, q.data.limit);
  });
  app.get<{ Querystring: Record<string, string> }>("/pool/positions", async (req, reply) => {
    const q = FromQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid from/limit" });
    return PoolIndexer.page(pool.positions, q.data.from, q.data.limit);
  });

  for (const circuit of ["transact", "open", "close"] as Circuit[]) {
    app.post(
      `/relay/${circuit}`,
      { config: { rateLimit: { max: config.RELAY_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } } },
      async (req, reply) => {
        if (!relayer.configured) return reply.code(503).send({ error: "relayer not configured" });
        const parsed = RelayBody.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) });
        }
        try {
          const { txHash } = await relayer.relay(circuit, parsed.data);
          return { txHash };
        } catch (err) {
          if (err instanceof RelayError) return reply.code(err.status).send({ error: err.message });
          req.log.error({ err: String(err) }, "relay error");
          return reply.code(500).send({ error: "internal error" });
        }
      },
    );
  }

  return app;
}
