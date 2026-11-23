import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Market } from "../markets.js";
import { Backoff, HttpError, aggregatePosts, fetchJson, type Source, type SourceResult } from "./types.js";

interface NeynarSearch {
  result?: {
    casts?: {
      timestamp: string;
      author: { username: string; fid: number };
      reactions?: { likes_count?: number; recasts_count?: number };
      replies?: { count?: number };
    }[];
  };
}

/** Farcaster cast search via Neynar (only if NEYNAR_API_KEY is set). */
export class FarcasterSource implements Source {
  name = "farcaster";
  type = "metric" as const;
  weight = 0.8;
  private backoff = new Backoff(60, 3600);

  enabled(): boolean {
    return !!config.NEYNAR_API_KEY;
  }

  async fetch(market: Market): Promise<SourceResult | null> {
    if (!this.backoff.ready()) return null;
    const url = `https://api.neynar.com/v2/farcaster/cast/search?q=${encodeURIComponent(
      market.queries.farcaster,
    )}&limit=100&sort_type=algorithmic`;
    try {
      const json = await fetchJson<NeynarSearch>(url, {
        headers: { accept: "application/json", "x-api-key": config.NEYNAR_API_KEY! },
      });
      this.backoff.success();
      const cutoff = Date.now() - 3600_000;
      const posts = (json.result?.casts ?? [])
        .filter((c) => Date.parse(c.timestamp) >= cutoff)
        .map((c) => ({
          author: String(c.author?.fid ?? c.author?.username ?? ""),
          engagement:
            (c.reactions?.likes_count ?? 0) + 2 * (c.reactions?.recasts_count ?? 0) + 2 * (c.replies?.count ?? 0),
        }));
      return aggregatePosts(posts);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 429 || err.status >= 500 || err.status === 402)) {
        const wait = this.backoff.fail(err.retryAfterSec);
        logger.warn({ source: this.name, status: err.status, backoffSec: wait }, "neynar request failed; backing off");
        return null;
      }
      throw err;
    }
  }
}
