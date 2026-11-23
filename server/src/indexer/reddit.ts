import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Market } from "../markets.js";
import { Backoff, HttpError, aggregatePosts, fetchJson, type Source, type SourceResult } from "./types.js";

interface RedditListing {
  data?: { children?: { data: { author: string; score: number; num_comments: number; created_utc: number } }[] };
}

/**
 * Reddit search. Uses the public JSON endpoint by default; if REDDIT_CLIENT_ID/SECRET are set it uses
 * app-only OAuth (oauth.reddit.com), which is far less likely to be blocked from datacenter IPs.
 */
export class RedditSource implements Source {
  name = "reddit";
  type = "metric" as const;
  weight = 1.0;
  private backoff = new Backoff(60, 3600);
  private token?: { value: string; exp: number };

  enabled(): boolean {
    return true;
  }

  private async authHeader(): Promise<Record<string, string>> {
    if (!config.REDDIT_CLIENT_ID || !config.REDDIT_CLIENT_SECRET) return {};
    if (!this.token || Date.now() > this.token.exp - 60_000) {
      const basic = Buffer.from(`${config.REDDIT_CLIENT_ID}:${config.REDDIT_CLIENT_SECRET}`).toString("base64");
      const res = await fetchJson<{ access_token: string; expires_in: number }>(
        "https://www.reddit.com/api/v1/access_token",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "User-Agent": config.REDDIT_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        },
      );
      this.token = { value: res.access_token, exp: Date.now() + res.expires_in * 1000 };
    }
    return { Authorization: `Bearer ${this.token.value}` };
  }

  async fetch(market: Market): Promise<SourceResult | null> {
    if (!this.backoff.ready()) return null;
    const auth = await this.authHeader();
    const host = auth.Authorization ? "https://oauth.reddit.com" : "https://www.reddit.com";
    const url = `${host}/search${auth.Authorization ? "" : ".json"}?q=${encodeURIComponent(
      market.queries.reddit,
    )}&sort=new&t=hour&limit=100&raw_json=1`;
    try {
      const json = await fetchJson<RedditListing>(url, {
        headers: { "User-Agent": config.REDDIT_USER_AGENT, Accept: "application/json", ...auth },
      });
      this.backoff.success();
      const cutoff = Date.now() / 1000 - 3600;
      const posts = (json.data?.children ?? [])
        .map((c) => c.data)
        .filter((d) => d && d.created_utc >= cutoff)
        .map((d) => ({ author: d.author, engagement: Math.max(0, d.score) + 2 * (d.num_comments ?? 0) }));
      return aggregatePosts(posts);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 429 || err.status === 403 || err.status >= 500)) {
        const wait = this.backoff.fail(err.retryAfterSec);
        logger.warn({ source: this.name, status: err.status, backoffSec: wait }, "reddit request failed; backing off");
        return null;
      }
      if (err instanceof HttpError && err.status === 401) this.token = undefined;
      throw err;
    }
  }
}
