import { config } from "./config.js";
import { Indexer } from "./indexer/index.js";
import { logger } from "./logger.js";
import { PoolIndexer } from "./pool.js";
import { Relayer, loadVkeys } from "./relayer.js";
import { Reporter } from "./reporter.js";
import { buildServer } from "./server.js";

async function main() {
  const indexer = new Indexer();
  const pool = new PoolIndexer();
  const relayer = new Relayer();
  const reporter = new Reporter(indexer);
  const vkeys = loadVkeys();

  logger.info(
    {
      chainId: config.CHAIN_ID,
      sources: indexer.enabledSources(),
      pool: pool.configured ? config.POOL_ADDRESS : null,
      relayer: relayer.configured ? relayer.address : null,
      reporter: reporter.configured ? reporter.address : null,
      vkeys: Object.fromEntries(Object.entries(vkeys).map(([k, v]) => [k, v ?? "missing"])),
      dataDir: config.DATA_DIR ?? null,
    },
    "starting parlo-server",
  );

  const app = await buildServer({ indexer, pool, relayer, reporter, vkeys });
  await app.listen({ port: config.PORT, host: config.HOST });

  await indexer.start();
  pool.start();
  reporter.start();

  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    logger.info({ sig }, "shutting down");
    reporter.stop();
    pool.stop();
    await indexer.stop();
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err: String(err) }, "fatal startup error");
  process.exit(1);
});
