export type Market = {
  id: number
  symbol: string
  name: string
  value: number // attention index, e.g. 128.4
  change24h: number // percent
  volume24h: number // USDT
  mentions24h: number
  sparkline: number[]
}

export type HistoryPoint = { t: number; value: number; low: number; high: number }

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/** Deterministic PRNG so mock data is stable between renders. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function walk(seed: number, n: number, start: number, vol: number, drift = 0): number[] {
  const r = rng(seed)
  const out: number[] = []
  let v = start
  for (let i = 0; i < n; i++) {
    v = Math.max(5, v * (1 + (r() - 0.5) * vol + drift))
    out.push(+v.toFixed(2))
  }
  return out
}

const SEED_MARKETS: Array<Omit<Market, 'sparkline' | 'value' | 'change24h'> & { start: number; drift: number }> = [
  { id: 1, symbol: '$BNB', name: 'BNB', volume24h: 1_284_000, mentions24h: 48_210, start: 112, drift: 0.002 },
  { id: 2, symbol: '$PEPE', name: 'Pepe', volume24h: 2_904_500, mentions24h: 91_388, start: 96, drift: 0.004 },
  { id: 3, symbol: '#AIAgents', name: 'AI Agents', volume24h: 1_752_300, mentions24h: 64_002, start: 140, drift: -0.0012 },
  { id: 4, symbol: '#Memecoins', name: 'Memecoins', volume24h: 988_100, mentions24h: 120_441, start: 88, drift: 0.0015 },
  { id: 5, symbol: '@cz_binance', name: 'CZ', volume24h: 640_900, mentions24h: 22_870, start: 74, drift: 0.003 },
  { id: 6, symbol: '#RWA', name: 'Real World Assets', volume24h: 412_700, mentions24h: 15_302, start: 61, drift: -0.002 },
]

export const MOCK_MARKETS: Market[] = SEED_MARKETS.map((m) => {
  const spark = walk(m.id * 97, 48, m.start, 0.05, m.drift)
  const value = spark[spark.length - 1]
  const change24h = ((value - spark[0]) / spark[0]) * 100
  const { start: _s, drift: _d, ...rest } = m
  void _s
  void _d
  return { ...rest, value, change24h: +change24h.toFixed(1), sparkline: spark }
})

/** Extra symbols used only for the landing marquee. */
export const MARQUEE_EXTRA = [
  { symbol: '#Solana', change: 6.8 },
  { symbol: '$WIF', change: -4.2 },
  { symbol: '#Airdrop', change: 18.9 },
  { symbol: '@VitalikButerin', change: 2.3 },
  { symbol: '#Restaking', change: -7.5 },
  { symbol: '$DOGE', change: 9.1 },
]

export function mockHistory(id: number, points = 288): HistoryPoint[] {
  const m = MOCK_MARKETS.find((x) => x.id === id) ?? MOCK_MARKETS[0]
  const r = rng(id * 1311)
  const now = Date.now()
  const step = (24 * 3600 * 1000) / points
  const vals = walk(id * 7919, points, m.value * 0.85, 0.03, 0.0006)
  const scale = m.value / vals[vals.length - 1]
  return vals.map((v, i) => {
    const value = +(v * scale).toFixed(2)
    return {
      t: now - (points - 1 - i) * step,
      value,
      low: +(value * (1 - r() * 0.012)).toFixed(2),
      high: +(value * (1 + r() * 0.012)).toFixed(2),
    }
  })
}

async function getJSON<T>(path: string, timeoutMs = 8000): Promise<T> {
  if (!API_URL) throw new Error('no api')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

/** Normalises a backend market (values may be uint scaled by 1e4) into our shape. */
function normMarket(raw: Record<string, unknown>): Market {
  const fallback = MOCK_MARKETS.find((m) => m.id === Number(raw.id))
  const scaled = (v: unknown) => {
    const n = Number(v)
    return n > 100_000 ? n / 1e4 : n
  }
  const value = scaled(raw.value ?? raw.score ?? raw.current ?? fallback?.value ?? 100)
  return {
    id: Number(raw.id),
    symbol: String(raw.symbol ?? fallback?.symbol ?? `#${raw.id}`),
    name: String(raw.name ?? raw.symbol ?? fallback?.name ?? ''),
    value,
    change24h: Number(raw.change24h ?? raw.change ?? fallback?.change24h ?? 0),
    // Live data: never borrow mock volume/mentions; show only what the backend reports.
    volume24h: Number(raw.volume24h ?? 0),
    mentions24h: Number(raw.mentions24h ?? 0),
    sparkline: Array.isArray(raw.sparkline) ? (raw.sparkline as unknown[]).map(scaled) : fallback?.sparkline ?? [value],
  }
}

export async function fetchMarkets(): Promise<{ markets: Market[]; live: boolean }> {
  try {
    const data = await getJSON<unknown>('/markets')
    const arr = (Array.isArray(data) ? data : (data as { markets?: unknown[] }).markets) as Record<string, unknown>[]
    if (!arr?.length) throw new Error('empty')
    return { markets: arr.map(normMarket), live: true }
  } catch {
    return { markets: MOCK_MARKETS, live: false }
  }
}

/** Real-money trading is only safe when the oracle reporter and the relayer are both running. */
export type TradingStatus = { live: boolean; reason: string }
export async function fetchTradingStatus(): Promise<TradingStatus> {
  try {
    const h = await getJSON<{
      relayer?: { configured?: boolean; vkeys?: Record<string, boolean> }
      reporter?: { configured?: boolean; lastRunAt?: number | null; error?: string | null }
    }>('/health')
    const vk = h.relayer?.vkeys ?? {}
    const relayerOk = !!h.relayer?.configured && !!vk.transact && !!vk.open && !!vk.close
    const lastRun = h.reporter?.lastRunAt ?? 0
    const reporterOk = !!h.reporter?.configured && !h.reporter?.error && Date.now() / 1000 - lastRun < 15 * 60
    if (relayerOk && reporterOk) return { live: true, reason: '' }
    const missing = [!reporterOk && 'oracle reporter', !relayerOk && 'relayer'].filter(Boolean).join(' and ')
    return { live: false, reason: `the ${missing} ${missing.includes(' and ') ? 'are' : 'is'} not running yet` }
  } catch {
    return { live: false, reason: 'the Parlo API is unreachable' }
  }
}

export async function fetchHistory(id: number, range = '24h'): Promise<{ points: HistoryPoint[]; live: boolean }> {
  try {
    const data = await getJSON<unknown>(`/markets/${id}/history?range=${range}`)
    const arr = (Array.isArray(data) ? data : (data as { history?: unknown[]; points?: unknown[] }).history ??
      (data as { points?: unknown[] }).points) as Record<string, unknown>[]
    if (!arr?.length) throw new Error('empty')
    const sc = (v: unknown) => {
      const n = Number(v)
      return n > 100_000 ? n / 1e4 : n
    }
    return {
      points: arr.map((p) => {
        const value = sc(p.value ?? p.close ?? p.score)
        const t = Number(p.t ?? p.ts ?? p.time ?? 0)
        return { t: t < 1e12 ? t * 1000 : t, value, low: sc(p.low ?? value), high: sc(p.high ?? value) }
      }),
      live: true,
    }
  } catch {
    return { points: mockHistory(id), live: false }
  }
}

export const fmtUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`
export const fmtNum = (n: number) => (n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`)
