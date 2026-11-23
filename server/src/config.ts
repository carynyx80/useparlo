import { z } from "zod";

const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const hexKey = optStr.refine((v) => v === undefined || /^(0x)?[0-9a-fA-F]{64}$/.test(v), {
  message: "must be a 32-byte hex private key",
});

const address = optStr.refine((v) => v === undefined || /^0x[0-9a-fA-F]{40}$/.test(v), {
  message: "must be a 0x-prefixed 20-byte address",
});

const flag = optStr.transform((v) => v === "1" || v === "true" || v === "yes");

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: optStr,

  // Chain
  CHAIN_ID: z.coerce.number().int().default(56),
  RPC_URL: optStr,
  EPOCH_LENGTH: z.coerce.number().int().positive().default(300),

  // Indexer
  INDEX_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  SIMULATE: flag,
  SIM_BACKFILL: flag,
  DATA_DIR: optStr,
  SNAPSHOT_INTERVAL_SEC: z.coerce.number().int().positive().default(300),
  REDDIT_USER_AGENT: z.string().default("parlo-indexer/1.0"),
  REDDIT_CLIENT_ID: optStr,
  REDDIT_CLIENT_SECRET: optStr,
  NEYNAR_API_KEY: optStr,
  X_BEARER_TOKEN: optStr,
  COINGECKO_API_KEY: optStr,

  // Pool / relayer
  POOL_ADDRESS: address,
  POOL_DEPLOY_BLOCK: z.coerce.bigint().default(0n),
  POOL_ABI_PATH: optStr,
  LOG_CHUNK_SIZE: z.coerce.bigint().default(5000n),
  POOL_SYNC_INTERVAL_SEC: z.coerce.number().int().positive().default(15),
  RELAYER_PRIVATE_KEY: hexKey,
  VKEY_DIR: optStr,
  MIN_RELAYER_FEE: z.coerce.bigint().default(0n),
  RELAY_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),

  // Reporter
  REPORTER_PRIVATE_KEY: hexKey,
  ORACLE_ADDRESS: address,

  // HTTP
  CORS_EXTRA_ORIGINS: optStr,
});

export type Config = z.infer<typeof EnvSchema>;

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only print variable names + messages, never values (may contain keys).
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

export const config = load();

export const DEFAULT_RPC: Record<number, string> = {
  56: "https://bsc-dataseed.bnbchain.org",
  97: "https://bsc-testnet-dataseed.bnbchain.org",
};

export const rpcUrl = config.RPC_URL ?? DEFAULT_RPC[config.CHAIN_ID] ?? DEFAULT_RPC[56];

export function normalizeKey(k: string): `0x${string}` {
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}
