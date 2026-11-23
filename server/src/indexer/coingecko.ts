import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Market } from "../markets.js";
import { Backoff, HttpError, fetchJson, type Source, type SourceResult } from "./types.js";

interface Trending {
  coins?: { item: { id: string; symbol: string; score: number } }[];
  categories?: { name: string }[];
}

/** CoinGecko trending: boosts coins/categories that are trending. Cached 5 minutes. */
export class CoinGeckoSource implements Source {
  name = "coingecko";
  type = "boost" as const;
  weight = 0;
  private backoff = new Backoff(120, 3600);
  private cache?: { at: number; coinRank: Map<string, number>; categories: string[] };

  enabled(): boolean {
    return true;
  }

  async prepare(): Promise<void> {
    if (this.cache && Date.now() - this.cache.at < 5 * 60_000) return;
    if (!this.backoff.ready()) return;
    try {
      const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "parlo-indexer/1.0" };
      if (config.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = config.COINGECKO_API_KEY;
      const json = await fetchJson<Trending>("https://api.coingecko.com/api/v3/search/trending", { headers });
      const coinRank = new Map<string, number>();
      (json.coins ?? []).forEach((c, i) => coinRank.set(c.item.id, i));
      const categories = (json.categories ?? []).map((c) => c.name.toLowerCase());
      this.cache = { at: Date.now(), coinRank, categories };
      this.backoff.success();
    } catch (err) {
      const status = err instanceof HttpError ? err.status : undefined;
      const wait = this.backoff.fail(err instanceof HttpError ? err.retryAfterSec : undefined);
      logger.warn({ source: this.name, status, backoffSec: wait, err: String(err) }, "coingecko trending failed");
    }
  }

  async fetch(market: Market): Promise<SourceResult | null> {
    if (!this.cache) return null;
    let boost = 1;
    for (const id of market.coingeckoIds ?? []) {
      const rank = this.cache.coinRank.get(id);
      if (rank !== undefined) boost = Math.max(boost, 1 + 0.25 * (1 - rank / 15)); // up to +25%
    }
    for (const cat of market.coingeckoCategories ?? []) {
      const idx = this.cache.categories.findIndex((c) => c.includes(cat));
      if (idx >= 0) boost = Math.max(boost, 1 + 0.15 * (1 - idx / 10)); // up to +15%
    }
    return { mentions: 0, engagement: 0, uniqueAuthors: 0, boost };
  }
}
