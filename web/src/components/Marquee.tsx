import { MARQUEE_EXTRA, MOCK_MARKETS } from '../lib/api'

const ITEMS = [
  ...MOCK_MARKETS.map((m) => ({ symbol: m.symbol, change: m.change24h })),
  ...MARQUEE_EXTRA,
]

export default function Marquee() {
  const row = [...ITEMS, ...ITEMS]
  return (
    <div className="marquee" aria-label="Trending attention markets">
      <div className="marquee-track">
        {row.map((it, i) => (
          <div className="mq-item" key={i} aria-hidden={i >= ITEMS.length}>
            <span>{it.symbol}</span>
            <span className={`chg ${it.change >= 0 ? 'up' : 'down'}`}>
              {it.change >= 0 ? '▲' : '▼'} {Math.abs(it.change).toFixed(1)}%
            </span>
            <span className="mq-sep">✦</span>
          </div>
        ))}
      </div>
    </div>
  )
}
