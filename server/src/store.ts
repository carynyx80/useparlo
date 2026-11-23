/**
 * In-memory ring buffer of scores: 7 days at 1-minute resolution per market.
 * Slots are addressed by absolute minute index (unix seconds / 60) modulo capacity,
 * so a point written for minute M overwrites whatever was 7 days earlier.
 */
export const RESOLUTION_SEC = 60;
export const CAPACITY = 7 * 24 * 60; // 10080 minutes

export interface Point {
  t: number; // unix seconds, aligned to the minute
  v: number; // score scaled 1e4 (integer)
}

export class ScoreRing {
  private ts = new Float64Array(CAPACITY); // minute index; 0 = empty
  private vs = new Float64Array(CAPACITY);
  private latestMinute = 0;

  put(tSec: number, value: number): void {
    const minute = Math.floor(tSec / RESOLUTION_SEC);
    const slot = minute % CAPACITY;
    this.ts[slot] = minute;
    this.vs[slot] = value;
    if (minute > this.latestMinute) this.latestMinute = minute;
  }

  latest(): Point | undefined {
    if (!this.latestMinute) return undefined;
    const slot = this.latestMinute % CAPACITY;
    return { t: this.latestMinute * RESOLUTION_SEC, v: this.vs[slot] };
  }

  /** Points with t in [fromSec, toSec], ascending. */
  range(fromSec: number, toSec: number = Date.now() / 1000): Point[] {
    const out: Point[] = [];
    const fromM = Math.max(Math.floor(fromSec / RESOLUTION_SEC), this.latestMinute - CAPACITY + 1);
    const toM = Math.min(Math.floor(toSec / RESOLUTION_SEC), this.latestMinute);
    for (let m = fromM; m <= toM; m++) {
      const slot = ((m % CAPACITY) + CAPACITY) % CAPACITY;
      if (this.ts[slot] === m) out.push({ t: m * RESOLUTION_SEC, v: this.vs[slot] });
    }
    return out;
  }

  /** Last known value at or before tSec (searching back up to `lookbackSec`). */
  valueAt(tSec: number, lookbackSec = 3600): number | undefined {
    const pts = this.range(tSec - lookbackSec, tSec);
    return pts.length ? pts[pts.length - 1].v : undefined;
  }

  all(): Point[] {
    return this.range(0, Number.MAX_SAFE_INTEGER);
  }
}

/**
 * Downsample points into fixed buckets ending at `toSec`, taking the last value in each
 * bucket and forward-filling gaps (leading gaps back-filled with the first known value).
 */
export function bucketize(points: Point[], fromSec: number, toSec: number, bucketSec: number): Point[] {
  const n = Math.max(1, Math.round((toSec - fromSec) / bucketSec));
  const out: Point[] = [];
  let i = 0;
  let last: number | undefined;
  for (let b = 0; b < n; b++) {
    const end = fromSec + (b + 1) * bucketSec;
    while (i < points.length && points[i].t < end) {
      last = points[i].v;
      i++;
    }
    out.push({ t: Math.floor(end), v: last ?? NaN });
  }
  const firstKnown = out.find((p) => !Number.isNaN(p.v))?.v;
  if (firstKnown === undefined) return [];
  for (const p of out) {
    if (Number.isNaN(p.v)) p.v = firstKnown;
    else break;
  }
  return out;
}
