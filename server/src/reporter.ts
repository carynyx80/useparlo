import { BaseError, type Hex } from "viem";
import { ORACLE_ABI } from "./abi.js";
import { publicClient, walletFor } from "./chain.js";
import { config } from "./config.js";
import type { Indexer } from "./indexer/index.js";
import { logger } from "./logger.js";
import { MARKETS } from "./markets.js";

/** Oracle rejects moves > 20% vs the previous value; stay safely inside that bound. */
const SAFE_MOVE = 0.19;

export class Reporter {
  readonly configured = !!(config.REPORTER_PRIVATE_KEY && config.ORACLE_ADDRESS);
  private signer = config.REPORTER_PRIVATE_KEY ? walletFor(config.REPORTER_PRIVATE_KEY) : undefined;
  private timer?: NodeJS.Timeout;
  private busy = false;
  lastRunAt?: number;
  lastPushed: Record<number, { value: string; txHash: string; epoch: string }> = {};
  lastError?: string;

  constructor(private indexer: Indexer) {}

  get address(): string | undefined {
    return this.signer?.account.address;
  }

  /** Previous on-chain value: this epoch's close if set, else last epoch's close. */
  private async previousValue(marketId: number, epoch: bigint): Promise<bigint> {
    const oracle = config.ORACLE_ADDRESS as Hex;
    for (const e of [epoch, epoch - 1n, epoch - 2n]) {
      if (e < 0n) break;
      const [close] = (await publicClient.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "getEpoch", args: [BigInt(marketId), e] })) as readonly [bigint, bigint, bigint, boolean];
      if (close > 0n) return close;
    }
    return 0n;
  }

  async runOnce(): Promise<void> {
    if (!this.configured || !this.signer || this.busy) return;
    this.busy = true;
    try {
      const block = await publicClient.getBlock();
      const epoch = block.timestamp / BigInt(config.EPOCH_LENGTH);
      for (const m of MARKETS) {
        const score = this.indexer.latestScore(m.id);
        if (!score) continue;
        try {
          let value = BigInt(Math.round(score));
          const prev = await this.previousValue(m.id, epoch);
          if (prev > 0n) {
            const lo = (prev * BigInt(Math.round((1 - SAFE_MOVE) * 1e6))) / 1_000_000n;
            const hi = (prev * BigInt(Math.round((1 + SAFE_MOVE) * 1e6))) / 1_000_000n;
            if (value < lo) value = lo;
            if (value > hi) value = hi;
          }
          const { request } = await publicClient.simulateContract({
            account: this.signer.account,
            address: config.ORACLE_ADDRESS as Hex,
            abi: ORACLE_ABI,
            functionName: "push",
            args: [BigInt(m.id), value],
          });
          const txHash = await this.signer.wallet.writeContract(request);
          // Wait for inclusion so the next push gets a fresh nonce.
          await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
          this.lastPushed[m.id] = { value: value.toString(), txHash, epoch: epoch.toString() };
          logger.info({ market: m.symbol, value: value.toString(), epoch: epoch.toString(), txHash }, "oracle push");
        } catch (err) {
          const msg = err instanceof BaseError ? err.shortMessage : String(err);
          this.lastError = `${m.symbol}: ${msg}`.slice(0, 300);
          logger.warn({ market: m.symbol, err: msg }, "oracle push failed");
        }
      }
      this.lastRunAt = Math.floor(Date.now() / 1000);
    } catch (err) {
      this.lastError = String(err).slice(0, 300);
      logger.warn({ err: this.lastError }, "reporter run failed");
    } finally {
      this.busy = false;
    }
  }

  start(): void {
    if (!this.configured) {
      logger.info("reporter disabled (REPORTER_PRIVATE_KEY / ORACLE_ADDRESS not set)");
      return;
    }
    const periodMs = Math.max(15, Math.floor(config.EPOCH_LENGTH / 2)) * 1000;
    logger.info({ reporter: this.address, oracle: config.ORACLE_ADDRESS, periodSec: periodMs / 1000 }, "reporter enabled");
    // First push after the indexer has produced a score.
    setTimeout(() => void this.runOnce(), 20_000);
    this.timer = setInterval(() => void this.runOnce(), periodMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
