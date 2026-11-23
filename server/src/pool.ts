import { decodeEventLog, getAbiItem, toEventSelector, type AbiEvent, type Hex } from "viem";
import { poolAbi } from "./abi.js";
import { publicClient } from "./chain.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

export interface LeafEvent {
  index: number;
  commitment: string; // 0x-prefixed 32-byte hex
  encryptedOutput: string; // 0x hex
  blockNumber: string;
  txHash: string;
}

function toHex32(v: unknown): string {
  if (typeof v === "bigint") return `0x${v.toString(16).padStart(64, "0")}`;
  return String(v);
}

/** Incrementally indexes NewNote / NewPosition events from the pool with chunked getLogs. */
export class PoolIndexer {
  notes: LeafEvent[] = [];
  positions: LeafEvent[] = [];
  private nextBlock: bigint = config.POOL_DEPLOY_BLOCK;
  private chunk: bigint = config.LOG_CHUNK_SIZE;
  private timer?: NodeJS.Timeout;
  private syncing = false;
  lastSyncedBlock?: bigint;
  lastError?: string;

  readonly configured = !!config.POOL_ADDRESS;
  private noteEvent = getAbiItem({ abi: poolAbi, name: "NewNote" }) as AbiEvent | undefined;
  private positionEvent = getAbiItem({ abi: poolAbi, name: "NewPosition" }) as AbiEvent | undefined;

  async sync(): Promise<void> {
    if (!this.configured || this.syncing || !this.noteEvent || !this.positionEvent) return;
    this.syncing = true;
    try {
      const head = await publicClient.getBlockNumber();
      if (this.nextBlock === 0n) {
        // No deploy block configured: avoid scanning from genesis; look back ~1 day of BSC blocks.
        this.nextBlock = head > 30_000n ? head - 30_000n : 0n;
        logger.warn({ fromBlock: this.nextBlock.toString() }, "POOL_DEPLOY_BLOCK not set; scanning recent blocks only");
      }
      const selNote = toEventSelector(this.noteEvent);
      const selPos = toEventSelector(this.positionEvent);
      while (this.nextBlock <= head) {
        const to = this.nextBlock + this.chunk - 1n > head ? head : this.nextBlock + this.chunk - 1n;
        let logs;
        try {
          logs = await publicClient.getLogs({
            address: config.POOL_ADDRESS as Hex,
            events: [this.noteEvent, this.positionEvent],
            fromBlock: this.nextBlock,
            toBlock: to,
          });
        } catch (err) {
          // RPCs commonly cap the block range: halve the chunk and retry.
          if (this.chunk > 50n) {
            this.chunk = this.chunk / 2n;
            logger.warn({ chunk: this.chunk.toString(), err: String(err).slice(0, 200) }, "getLogs failed; shrinking chunk");
            continue;
          }
          throw err;
        }
        for (const log of logs) {
          const decoded = decodeEventLog({ abi: poolAbi, data: log.data, topics: log.topics, strict: false });
          const args = decoded.args as unknown as Record<string, unknown>;
          const entry: LeafEvent = {
            index: Number(args.index),
            commitment: toHex32(args.commitment),
            encryptedOutput: String(args.encryptedOutput ?? "0x"),
            blockNumber: (log.blockNumber ?? 0n).toString(),
            txHash: log.transactionHash ?? "",
          };
          const sel = log.topics[0];
          const target = sel === selNote ? this.notes : sel === selPos ? this.positions : undefined;
          if (target && !target.some((e) => e.index === entry.index)) target.push(entry);
        }
        this.notes.sort((a, b) => a.index - b.index);
        this.positions.sort((a, b) => a.index - b.index);
        this.lastSyncedBlock = to;
        this.nextBlock = to + 1n;
      }
      this.lastError = undefined;
    } catch (err) {
      this.lastError = String(err).slice(0, 300);
      logger.warn({ err: this.lastError }, "pool sync failed");
    } finally {
      this.syncing = false;
    }
  }

  start(): void {
    if (!this.configured) return;
    if (!this.noteEvent || !this.positionEvent) {
      logger.error("pool ABI lacks NewNote/NewPosition events; pool indexing disabled");
      return;
    }
    const run = () => void this.sync();
    run();
    this.timer = setInterval(run, config.POOL_SYNC_INTERVAL_SEC * 1000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  static page(list: LeafEvent[], from: number, limit = 5000): LeafEvent[] {
    // list is sorted by index; binary search the first index >= from
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].index < from) lo = mid + 1;
      else hi = mid;
    }
    return list.slice(lo, lo + limit);
  }
}
