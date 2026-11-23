import type { Market } from "../markets.js";
import type { Source, SourceResult } from "./types.js";

/** mulberry32 PRNG — tiny, deterministic, serializable (single uint32 state). */
function nextRand(state: { s: number }): number {
  state.s = (state.s + 0x6d2b79f5) >>> 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function gaussian(state: { s: number }): number {
  const u = Math.max(nextRand(state), 1e-12);
  const v = nextRand(state);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SimState {
  s: number; // PRNG state
  level: number; // log-space random walk (mean-reverting)
  spike: number; // log-space viral spike component, decays each step
}

const BASE_AUTHORS: Record<number, number> = { 1: 60, 2: 45, 3: 30, 4: 50, 5: 25, 6: 20 };

/**
 * Deterministic seeded random walk with occasional viral spikes. Same seed => same series.
 * Used when every real metric source fails for a market, or for all markets when SIMULATE=1.
 */
export class Simulator implements Source {
  name = "simulator";
  type = "metric" as const;
  weight = 1.0;
  states = new Map<number, SimState>();

  constructor(private seed = 0x9a71) {}

  enabled(): boolean {
    return true;
  }

  private state(marketId: number): SimState {
    let st = this.states.get(marketId);
    if (!st) {
      st = { s: (this.seed * 2654435761 + marketId * 40503) >>> 0, level: 0, spike: 0 };
      this.states.set(marketId, st);
    }
    return st;
  }

  /** Advance one step (one minute) and return synthetic metrics. */
  step(marketId: number): SourceResult {
    const st = this.state(marketId);
    st.level = st.level * 0.995 + gaussian(st) * 0.035; // OU-style walk
    st.spike *= 0.93; // spikes decay over ~15-30 minutes
    if (nextRand(st) < 0.003) st.spike += 0.4 + nextRand(st) * 0.9; // viral spike
    const m = Math.exp(st.level + st.spike);
    const base = BASE_AUTHORS[marketId] ?? 30;
    const uniqueAuthors = base * m;
    return {
      uniqueAuthors,
      mentions: uniqueAuthors * (1.3 + nextRand(st) * 0.2),
      engagement: uniqueAuthors * (10 + nextRand(st) * 4) * (1 + st.spike),
    };
  }

  async fetch(market: Market): Promise<SourceResult> {
    return this.step(market.id);
  }

  serialize(): Record<string, SimState> {
    return Object.fromEntries([...this.states].map(([k, v]) => [String(k), v]));
  }

  restore(data: Record<string, SimState> | undefined): void {
    if (!data) return;
    for (const [k, v] of Object.entries(data)) this.states.set(Number(k), { ...v });
  }
}
