import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { MARKETS, type Market } from "../markets.js";
import { CAPACITY, RESOLUTION_SEC, ScoreRing } from "../store.js";
import { CoinGeckoSource } from "./coingecko.js";
import { FarcasterSource } from "./farcaster.js";
import { RedditSource } from "./reddit.js";
import { Simulator, type SimState } from "./simulator.js";
import type { Metrics, Source, SourceResult } from "./types.js";
import { XSource } from "./x.js";

export const SCALE = 10_000; // scores are integers scaled 1e4 (100.0 => 1_000_000)
export const EMA_ALPHA = 0.2;
export const MAX_STEP_CHANGE = 0.2; // matches on-chain oracle (rejects moves > 20%)
const BASELINE_WARMUP = 30; // samples averaged into each source baseline, then frozen
const MIN_SCORE = 1 * SCALE;

/** Bot resistance: unique authors weigh the most. */
const W_AUTHORS = 0.5;
const W_ENGAGEMENT = 0.3;
const W_MENTIONS = 0.2;

export function composite(m: Metrics): number {
  return (
    1 + W_AUTHORS * Math.log1p(m.uniqueAuthors) + W_ENGAGEMENT * Math.log1p(m.engagement) + W_MENTIONS * Math.log1p(m.mentions)
  );
}

interface Baseline {
  value: number;
  n: number;
}

interface MarketState {
  baselines: Record<string, Baseline>;
  ema?: number; // float index (100.0 = start)
  lastSources: string[];
  simulated: boolean;
  updatedAt?: number;
}

export interface MarketSnapshot {
  market: Market;
  ring: ScoreRing;
  state: MarketState;
}

export class Indexer {
  readonly rings = new Map<number, ScoreRing>();
  readonly states = new Map<number, MarketState>();
  readonly simulator = new Simulator();
  readonly sources: Source[] = [new RedditSource(), new FarcasterSource(), new XSource(), new CoinGeckoSource()];
  private timer?: NodeJS.Timeout;
  private snapTimer?: NodeJS.Timeout;
  private running = false;
  lastTickAt?: number;
  lastTickMs?: number;

  constructor() {
    for (const m of MARKETS) {
      this.rings.set(m.id, new ScoreRing());
      this.states.set(m.id, { baselines: {}, lastSources: [], simulated: false });
    }
  }

  enabledSources(): string[] {
    const names = this.sources.filter((s) => s.enabled()).map((s) => s.name);
    return config.SIMULATE ? ["simulator"] : [...names, "simulator(fallback)"];
  }

  /** Update a market's score from one tick's source results. Returns the integer score. */
  private apply(market: Market, results: Map<string, SourceResult>, weights: Map<string, number>, boost: number, tSec: number): number {
    const st = this.states.get(market.id)!;
    let num = 0;
    let den = 0;
    for (const [name, r] of results) {
      const c = composite(r);
      const b = (st.baselines[name] ??= { value: c, n: 0 });
      if (b.n < BASELINE_WARMUP) {
        b.n++;
        b.value += (c - b.value) / b.n;
      }
      const w = weights.get(name) ?? 1;
      num += w * (c / b.value);
      den += w;
    }
    const raw = den > 0 ? (100 * num * boost) / den : (st.ema ?? 100);

    const prev = st.ema;
    let next = prev === undefined ? 100 : prev + EMA_ALPHA * (raw - prev);
    if (prev !== undefined) {
      next = Math.min(prev * (1 + MAX_STEP_CHANGE), Math.max(prev * (1 - MAX_STEP_CHANGE), next));
    }
    next = Math.max(next, MIN_SCORE / SCALE);
    st.ema = next;
    st.updatedAt = tSec;
    const score = Math.round(next * SCALE);
    this.rings.get(market.id)!.put(tSec, score);
    return score;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    const tSec = Math.floor(started / 1000);
    try {
      const active = config.SIMULATE ? [] : this.sources.filter((s) => s.enabled());
      await Promise.allSettled(active.map((s) => s.prepare?.()));
      for (const market of MARKETS) {
        const results = new Map<string, SourceResult>();
        const weights = new Map<string, number>();
        let boost = 1;
        // Sequential per source keeps us polite with unauthenticated endpoints.
        for (const src of active) {
          try {
            const r = await src.fetch(market);
            if (!r) continue;
            if (src.type === "boost") boost *= r.boost ?? 1;
            else {
              results.set(src.name, r);
              weights.set(src.name, src.weight);
            }
          } catch (err) {
            logger.warn({ source: src.name, market: market.symbol, err: String(err) }, "source fetch failed");
          }
        }
        const st = this.states.get(market.id)!;
        // Keep the simulator walking every tick so fallback transitions are continuous.
        const sim = this.simulator.step(market.id);
        st.simulated = results.size === 0;
        if (st.simulated) {
          results.set("simulator", sim);
          weights.set("simulator", this.simulator.weight);
        }
        st.lastSources = [...results.keys(), ...(boost !== 1 ? ["coingecko"] : [])];
        const score = this.apply(market, results, weights, boost, tSec);
        logger.debug({ market: market.symbol, score, sources: st.lastSources }, "score updated");
      }
      this.lastTickAt = tSec;
      this.lastTickMs = Date.now() - started;
      logger.info(
        {
          ms: this.lastTickMs,
          scores: Object.fromEntries(
            MARKETS.map((m) => [m.symbol, { v: (this.states.get(m.id)!.ema ?? 0).toFixed(2), src: this.states.get(m.id)!.lastSources.join("+") }]),
          ),
        },
        "indexer tick",
      );
    } finally {
      this.running = false;
    }
  }

  /** Fill history with simulator data (only when SIM_BACKFILL=1 and history is empty). */
  backfill(): void {
    const now = Math.floor(Date.now() / 1000 / RESOLUTION_SEC) * RESOLUTION_SEC;
    for (const market of MARKETS) {
      if (this.rings.get(market.id)!.latest()) continue;
      for (let i = CAPACITY - 1; i >= 1; i--) {
        const t = now - i * RESOLUTION_SEC;
        const sim = this.simulator.step(market.id);
        this.apply(market, new Map([["simulator", sim]]), new Map([["simulator", 1]]), 1, t);
      }
      this.states.get(market.id)!.simulated = true;
    }
    logger.info("backfilled 7d of simulated history");
  }

  // ---------- persistence ----------
  private snapshotPath(): string | undefined {
    return config.DATA_DIR ? path.join(config.DATA_DIR, "scores.json") : undefined;
  }

  async loadSnapshot(): Promise<void> {
    const file = this.snapshotPath();
    if (!file) return;
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8")) as {
        version: number;
        markets: Record<string, { points: [number, number][]; state: MarketState }>;
        sim?: Record<string, SimState>;
      };
      if (data.version !== 1) return;
      const minT = Date.now() / 1000 - CAPACITY * RESOLUTION_SEC;
      for (const [id, m] of Object.entries(data.markets ?? {})) {
        const ring = this.rings.get(Number(id));
        if (!ring) continue;
        for (const [t, v] of m.points) if (t >= minT) ring.put(t, v);
        this.states.set(Number(id), { ...m.state, lastSources: [], simulated: false });
      }
      this.simulator.restore(data.sim);
      logger.info({ file }, "loaded score snapshot");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") logger.warn({ err: String(err) }, "failed to load snapshot");
    }
  }

  async saveSnapshot(): Promise<void> {
    const file = this.snapshotPath();
    if (!file) return;
    const markets: Record<string, unknown> = {};
    for (const m of MARKETS) {
      markets[m.id] = {
        points: this.rings.get(m.id)!.all().map((p) => [p.t, p.v]),
        state: this.states.get(m.id),
      };
    }
    const body = JSON.stringify({ version: 1, savedAt: Date.now(), markets, sim: this.simulator.serialize() });
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
    logger.debug({ file, bytes: body.length }, "saved score snapshot");
  }

  async start(): Promise<void> {
    await this.loadSnapshot();
    if (config.SIM_BACKFILL) this.backfill();
    const run = () => this.tick().catch((err) => logger.error({ err: String(err) }, "indexer tick crashed"));
    void run(); // don't block server startup on the first fetch round
    this.timer = setInterval(run, config.INDEX_INTERVAL_SEC * 1000);
    if (config.DATA_DIR) {
      this.snapTimer = setInterval(
        () => this.saveSnapshot().catch((err) => logger.warn({ err: String(err) }, "snapshot failed")),
        config.SNAPSHOT_INTERVAL_SEC * 1000,
      );
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    clearInterval(this.snapTimer);
    await this.saveSnapshot().catch(() => undefined);
  }

  latestScore(marketId: number): number | undefined {
    return this.rings.get(marketId)?.latest()?.v;
  }
}
