import type { Market } from "../markets.js";

export interface Metrics {
  mentions: number;
  engagement: number;
  uniqueAuthors: number;
}

export interface SourceResult extends Metrics {
  /** Optional multiplicative boost (e.g. CoinGecko trending), 1 = neutral. */
  boost?: number;
}

export interface Source {
  name: string;
  /** "metric" sources produce attention volume; "boost" sources only modulate it. */
  type: "metric" | "boost";
  /** Weight in the cross-source blend (metric sources only). */
  weight: number;
  enabled(): boolean;
  /** Called once per indexer tick before per-market fetches (for batch endpoints). */
  prepare?(): Promise<void>;
  /** Return null when the source has no usable data for this market right now. Throw on errors. */
  fetch(market: Market): Promise<SourceResult | null>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public retryAfterSec?: number,
  ) {
    super(`HTTP ${status}`);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 10_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    throw new HttpError(res.status, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  return (await res.json()) as T;
}

/** Simple per-source exponential backoff gate. */
export class Backoff {
  private until = 0;
  private failures = 0;
  constructor(
    private baseSec = 30,
    private maxSec = 1800,
  ) {}
  ready(): boolean {
    return Date.now() >= this.until;
  }
  success(): void {
    this.failures = 0;
    this.until = 0;
  }
  fail(retryAfterSec?: number): number {
    this.failures++;
    const exp = Math.min(this.maxSec, this.baseSec * 2 ** (this.failures - 1));
    const wait = Math.max(exp, retryAfterSec ?? 0);
    this.until = Date.now() + wait * 1000;
    return wait;
  }
}

/** Aggregate a list of posts into metrics with per-author caps (bot resistance). */
export function aggregatePosts(
  posts: { author: string; engagement: number }[],
  maxPostsPerAuthor = 3,
): Metrics {
  const perAuthor = new Map<string, number>();
  let mentions = 0;
  let engagement = 0;
  for (const p of posts) {
    const a = (p.author || "").toLowerCase();
    if (!a || a === "[deleted]" || a === "automoderator") continue;
    const n = (perAuthor.get(a) ?? 0) + 1;
    perAuthor.set(a, n);
    if (n > maxPostsPerAuthor) continue; // ignore spam beyond the cap
    mentions++;
    engagement += Math.max(0, p.engagement);
  }
  return { mentions, engagement, uniqueAuthors: perAuthor.size };
}
