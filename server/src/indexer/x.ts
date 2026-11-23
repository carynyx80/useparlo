import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Market } from "../markets.js";
import { Backoff, HttpError, fetchJson, type Source, type SourceResult } from "./types.js";

interface CountsResponse {
  data?: { start: string; end: string; tweet_count: number }[];
}

/**
 * X recent search counts (/2/tweets/counts/recent) — cheapest volume signal. Counts carry no
 * author data, so uniqueAuthors is estimated conservatively (sqrt of volume) to keep it from
 * dominating the bot-resistant author term. Polled at most every 15 minutes per market.
 */
export class XSource implements Source {
  name = "x";
  type = "metric" as const;
  weight = 1.0;
  private backoff = new Backoff(120, 3600);
  private cache = new Map<number, { at: number; res: SourceResult }>();

  enabled(): boolean {
    return !!config.X_BEARER_TOKEN;
  }

  async fetch(market: Market): Promise<SourceResult | null> {
    const cached = this.cache.get(market.id);
    if (cached && Date.now() - cached.at < 15 * 60_000) return cached.res;
    if (!this.backoff.ready()) return cached?.res ?? null;
    const start = new Date(Date.now() - 3 * 3600_000).toISOString();
    const url = `https://api.x.com/2/tweets/counts/recent?query=${encodeURIComponent(
      market.queries.x,
    )}&granularity=hour&start_time=${encodeURIComponent(start)}`;
    try {
      const json = await fetchJson<CountsResponse>(url, {
        headers: { Authorization: `Bearer ${config.X_BEARER_TOKEN}` },
      });
      this.backoff.success();
      const buckets = json.data ?? [];
      // Use the last complete hour bucket (the final bucket is partial).
      const full = buckets.length > 1 ? buckets[buckets.length - 2] : buckets[0];
      const count = full?.tweet_count ?? 0;
      const res: SourceResult = { mentions: count, engagement: count, uniqueAuthors: Math.sqrt(count) * 3 };
      this.cache.set(market.id, { at: Date.now(), res });
      return res;
    } catch (err) {
      if (err instanceof HttpError && (err.status === 429 || err.status >= 500)) {
        const wait = this.backoff.fail(err.retryAfterSec);
        logger.warn({ source: this.name, status: err.status, backoffSec: wait }, "x counts failed; backing off");
        return cached?.res ?? null;
      }
      throw err;
    }
  }
}
