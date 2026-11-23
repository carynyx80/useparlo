import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, useSignMessage, useSwitchChain } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, EyeOff, Info, KeyRound, Lock, ShieldCheck, X } from 'lucide-react'
import Navbar from '../components/Navbar'
import { AreaChart } from '../components/Charts'
import { fetchHistory, fetchMarkets, fmtUsd, MOCK_MARKETS, type HistoryPoint, type Market } from '../lib/api'
import { TARGET_CHAIN } from '../lib/wagmi'
import { CONTRACTS_CONFIGURED, FEE_BPS_CLOSE, FEE_BPS_OPEN, MAX_LEVERAGE, PROFIT_CAP_MULTIPLE, liquidationLevel } from '../lib/contracts'
import { cacheShieldedKey, deriveShieldedKey, loadShieldedKey, type ShieldedKey } from '../lib/zk'

type Position = {
  id: string
  marketId: number
  symbol: string
  isLong: boolean
  margin: number
  leverage: number
  entry: number
  openedAt: number
}

const RANGES = ['1h', '6h', '24h'] as const

export default function TradeApp() {
  const [params, setParams] = useSearchParams()
  const [markets, setMarkets] = useState<Market[]>(MOCK_MARKETS)
  const [live, setLive] = useState(false)
  const [selected, setSelected] = useState<number>(Number(params.get('m')) || 2)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [range, setRange] = useState<(typeof RANGES)[number]>('24h')

  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN.id

  const [shieldKey, setShieldKey] = useState<ShieldedKey | null>(null)
  const [shielded, setShielded] = useState(0)
  const [positions, setPositions] = useState<Position[]>([])
  const [modal, setModal] = useState<null | 'deposit' | 'withdraw'>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [isLong, setIsLong] = useState(true)
  const [margin, setMargin] = useState('100')
  const [lev, setLev] = useState(10)
  const [busy, setBusy] = useState(false)

  useEffect(() => { document.title = 'Trade · Parlo' }, [])
  useEffect(() => {
    let alive = true
    const load = () => fetchMarkets().then((r) => { if (alive) { setMarkets(r.markets); setLive(r.live) } })
    load()
    const t = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  useEffect(() => {
    let alive = true
    fetchHistory(selected, '24h').then((r) => alive && setHistory(r.points))
    return () => { alive = false }
  }, [selected])
  useEffect(() => {
    if (address) setShieldKey(loadShieldedKey(address))
    else setShieldKey(null)
  }, [address])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3800)
    return () => clearTimeout(t)
  }, [toast])

  const market = markets.find((m) => m.id === selected) ?? markets[0]
  const ranged = useMemo(() => {
    const n = range === '1h' ? 12 : range === '6h' ? 72 : history.length
    return history.slice(-n)
  }, [history, range])
  const values = ranged.map((p) => p.value)
  const entry = values.length ? values[values.length - 1] : market.value
  const rangeChg = values.length > 1 ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : market.change24h
  const hi = values.length ? Math.max(...ranged.map((p) => p.high)) : 0
  const lo = values.length ? Math.min(...ranged.map((p) => p.low)) : 0

  const marginNum = Math.max(0, Number(margin) || 0)
  const notional = marginNum * lev
  const openFee = (notional * FEE_BPS_OPEN) / 10_000
  const closeFee = (notional * FEE_BPS_CLOSE) / 10_000
  const liq = liquidationLevel(entry, lev, isLong)
  const maxPayout = marginNum * PROFIT_CAP_MULTIPLE

  const pick = (id: number) => {
    setSelected(id)
    setParams({ m: String(id) }, { replace: true })
  }

  async function ensureKey(): Promise<ShieldedKey | null> {
    if (shieldKey) return shieldKey
    try {
      const k = await deriveShieldedKey(signMessageAsync)
      if (address) cacheShieldedKey(address, k)
      setShieldKey(k)
      return k
    } catch {
      setToast('Signature rejected — shielded account not unlocked.')
      return null
    }
  }

  async function openPosition() {
    if (!isConnected) return openConnectModal?.()
    if (wrongNetwork) return switchChain({ chainId: TARGET_CHAIN.id })
    if (!(await ensureKey())) return
    if (marginNum <= 0) return setToast('Enter a margin amount.')
    if (marginNum > shielded) return setToast('Insufficient shielded balance — deposit USDT first.')
    setBusy(true)
    // TODO(contracts): build witness for `open` circuit → generateProof('open', input) → POST /relay/open.
    await new Promise((r) => setTimeout(r, 1400))
    setShielded((b) => +(b - marginNum).toFixed(2))
    setPositions((p) => [
      { id: crypto.randomUUID(), marketId: market.id, symbol: market.symbol, isLong, margin: marginNum, leverage: lev, entry, openedAt: Date.now() },
      ...p,
    ])
    setBusy(false)
    setToast(CONTRACTS_CONFIGURED ? 'Private position submitted.' : 'Demo mode: position simulated locally (contracts not configured).')
  }

  function closePosition(pos: Position) {
    const m = markets.find((x) => x.id === pos.marketId)
    const exit = m?.value ?? pos.entry
    const pnl = pos.margin * pos.leverage * ((exit - pos.entry) / pos.entry) * (pos.isLong ? 1 : -1)
    const fee = (pos.margin * pos.leverage * (FEE_BPS_OPEN + FEE_BPS_CLOSE)) / 10_000
    const payout = Math.min(Math.max(pos.margin + pnl - fee, 0), pos.margin * PROFIT_CAP_MULTIPLE)
    setShielded((b) => +(b + payout).toFixed(2))
    setPositions((p) => p.filter((x) => x.id !== pos.id))
    setToast(`Closed ${pos.symbol}: ${payout.toFixed(2)} USDT returned to shielded balance.`)
  }

  const cta = !isConnected
    ? 'Connect wallet'
    : wrongNetwork
      ? `Switch to ${TARGET_CHAIN.name}`
      : busy
        ? 'Generating proof…'
        : 'Open private position'

  return (
    <>
      <Navbar app />
      <main className="app-shell">
        <div className="container" style={{ maxWidth: 1480 }}>
          {wrongNetwork && (
            <div className="banner warn">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} color="#FF5C7A" /> You’re on the wrong network. Parlo runs on {TARGET_CHAIN.name}.</span>
              <button className="btn btn-primary btn-sm" disabled={switching} onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}>
                {switching ? 'Switching…' : `Switch to ${TARGET_CHAIN.name}`}
              </button>
            </div>
          )}
          {!CONTRACTS_CONFIGURED && (
            <div className="banner info">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Info size={16} color="#C6FF3D" /> Preview mode — contracts not configured, trades are simulated locally. {live ? 'Live index data.' : 'Index data is simulated.'}</span>
            </div>
          )}

          <div className="app-grid">
            {/* Markets */}
            <aside className="glass panel">
              <div className="panel-title">Markets <span className="mono" style={{ textTransform: 'none' }}>{live ? '● live' : '○ demo'}</span></div>
              <div className="mlist">
                {markets.map((m) => (
                  <button key={m.id} className={`mrow ${m.id === selected ? 'active' : ''}`} onClick={() => pick(m.id)}>
                    <div><div className="s">{m.symbol}</div><div className="v">{m.value.toFixed(2)}</div></div>
                    <div className={`c ${m.change24h >= 0 ? 'up' : 'down'}`}>{m.change24h >= 0 ? '+' : ''}{m.change24h.toFixed(1)}%</div>
                  </button>
                ))}
              </div>
            </aside>

            {/* Chart + positions */}
            <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
              <section className="glass panel" style={{ padding: 20 }}>
                <div className="chart-head" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <div className="chart-sym">{market.symbol} <span className="tag">ATTN-PERP</span></div>
                    <div className="chart-val mono">{entry.toFixed(2)}</div>
                    <div className={`chg ${rangeChg >= 0 ? 'up' : 'down'}`}>{rangeChg >= 0 ? '▲' : '▼'} {Math.abs(rangeChg).toFixed(2)}% <span className="muted">· {range}</span></div>
                  </div>
                  <div className="range-tabs">
                    {RANGES.map((r) => <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
                  </div>
                </div>
                <div style={{ marginTop: 18 }}>
                  {values.length > 1 ? (
                    <AreaChart key={`${selected}-${range}`} values={values} height={300}
                      markers={marginNum > 0 ? [{ value: liq, label: 'liq', color: '#FF5C7A' }] : undefined} />
                  ) : <div style={{ height: 300 }} />}
                </div>
                <div className="chart-foot" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
                  <div className="mini-stat"><div className="l">{range} high</div><div className="v">{hi.toFixed(2)}</div></div>
                  <div className="mini-stat"><div className="l">{range} low</div><div className="v">{lo.toFixed(2)}</div></div>
                  <div className="mini-stat"><div className="l">Volume</div><div className="v">{fmtUsd(market.volume24h)}</div></div>
                  <div className="mini-stat"><div className="l">Liq. line</div><div className="v down">{marginNum > 0 ? liq.toFixed(2) : '—'}</div></div>
                </div>
              </section>

              <section className="glass panel">
                <div className="panel-title">My private positions <span style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none' }}><EyeOff size={13} /> visible only to you</span></div>
                {positions.length === 0 ? (
                  <div className="empty">{isConnected ? 'No open positions yet.' : 'Connect your wallet to see your shielded positions.'}</div>
                ) : (
                  <div className="table-wrap">
                    <table className="pos">
                      <thead><tr><th>Market</th><th>Side</th><th>Margin</th><th>Lev.</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>PnL</th><th /></tr></thead>
                      <tbody>
                        {positions.map((p) => {
                          const mark = markets.find((m) => m.id === p.marketId)?.value ?? p.entry
                          const pnl = p.margin * p.leverage * ((mark - p.entry) / p.entry) * (p.isLong ? 1 : -1)
                          return (
                            <tr key={p.id}>
                              <td style={{ fontFamily: 'var(--sans)', fontWeight: 600 }}>{p.symbol}</td>
                              <td><span className={`side-pill ${p.isLong ? 'long' : 'short'}`}>{p.isLong ? 'LONG' : 'SHORT'}</span></td>
                              <td>{p.margin.toFixed(2)}</td>
                              <td>{p.leverage}x</td>
                              <td>{p.entry.toFixed(2)}</td>
                              <td>{mark.toFixed(2)}</td>
                              <td className="down">{liquidationLevel(p.entry, p.leverage, p.isLong).toFixed(2)}</td>
                              <td className={pnl >= 0 ? 'up' : 'down'}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</td>
                              <td><button className="btn btn-ghost btn-sm" style={{ height: 30 }} onClick={() => closePosition(p)}>Close</button></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            {/* Order + balance */}
            <div style={{ display: 'grid', gap: 14 }}>
              <section className="glass panel" id="vault">
                <div className="panel-title">Shielded balance <ShieldCheck size={14} color="#C6FF3D" /></div>
                <div className="bal">
                  {shieldKey || !isConnected ? <span className="mono">{shielded.toFixed(2)}</span> : <span className="redact" style={{ width: 110, height: 26 }} />}
                  <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>USDT</span>
                </div>
                {isConnected && !shieldKey && (
                  <button className="btn btn-ghost btn-sm wide" style={{ marginTop: 12 }} onClick={ensureKey}><KeyRound size={14} /> Unlock shielded account</button>
                )}
                <div className="bal-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => (isConnected ? setModal('deposit') : openConnectModal?.())}><ArrowDownToLine size={15} /> Deposit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => (isConnected ? setModal('withdraw') : openConnectModal?.())}><ArrowUpFromLine size={15} /> Withdraw</button>
                </div>
              </section>

              <section className="glass panel">
                <div className="seg" role="tablist">
                  <button className={`long ${isLong ? 'on' : ''}`} onClick={() => setIsLong(true)}>Long</button>
                  <button className={`short ${!isLong ? 'on' : ''}`} onClick={() => setIsLong(false)}>Short</button>
                </div>
                <div className="field">
                  <label><span>Margin</span><span>Avail. {shielded.toFixed(2)}</span></label>
                  <div className="input-wrap">
                    <input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" aria-label="Margin in USDT" />
                    <button className="unit" style={{ marginRight: 10, color: 'var(--accent)' }} onClick={() => setMargin(String(shielded))}>MAX</button>
                    <span className="unit">USDT</span>
                  </div>
                </div>
                <div className="field">
                  <label><span>Leverage</span><span className="mono" style={{ color: 'var(--text)' }}>{lev}x</span></label>
                  <div className="lev-row">
                    <input type="range" min={1} max={MAX_LEVERAGE} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} aria-label="Leverage" />
                  </div>
                  <div className="lev-marks">{[1, 5, 10, 15, 20].map((x) => <button key={x} onClick={() => setLev(x)}>{x}x</button>)}</div>
                </div>
                <div className="summary">
                  <div><span>Notional</span><span>{notional.toFixed(2)} USDT</span></div>
                  <div><span>Entry index</span><span>{entry.toFixed(2)}</span></div>
                  <div><span>Est. liquidation</span><span className="down">{liq.toFixed(2)}</span></div>
                  <div><span>Fee (open 0.1% + close 0.1%)</span><span>{(openFee + closeFee).toFixed(2)} USDT</span></div>
                  <div><span>Max payout (10×)</span><span>{maxPayout.toFixed(2)} USDT</span></div>
                </div>
                <button className="btn btn-primary wide" disabled={busy} onClick={openPosition}
                  style={!isLong && isConnected && !wrongNetwork ? { background: 'var(--down)', color: '#1a0308', boxShadow: '0 10px 40px -10px rgba(255,92,122,.6)' } : undefined}>
                  <Lock size={16} /> {cta}
                </button>
                <div className="note"><EyeOff size={13} style={{ flex: 'none', marginTop: 2 }} /> Side and leverage are hidden by a zero-knowledge proof generated in your browser. Only market and margin are public.</div>
              </section>
            </div>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {modal && (
          <BalanceModal
            kind={modal}
            max={modal === 'withdraw' ? shielded : undefined}
            onClose={() => setModal(null)}
            onConfirm={async (amt) => {
              if (wrongNetwork) { switchChain({ chainId: TARGET_CHAIN.id }); return }
              if (!(await ensureKey())) return
              // TODO(contracts): approve USDT → generateProof('transact', …) → pool.transact / POST /relay/transact.
              await new Promise((r) => setTimeout(r, 1000))
              setShielded((b) => +(modal === 'deposit' ? b + amt : b - amt).toFixed(2))
              setModal(null)
              setToast(`${modal === 'deposit' ? 'Shielded' : 'Withdrew'} ${amt.toFixed(2)} USDT${CONTRACTS_CONFIGURED ? '' : ' (demo)'}.`)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 16, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 16, x: '-50%' }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function BalanceModal({ kind, max, onClose, onConfirm }: { kind: 'deposit' | 'withdraw'; max?: number; onClose: () => void; onConfirm: (amt: number) => Promise<void> }) {
  const [amt, setAmt] = useState('')
  const [busy, setBusy] = useState(false)
  const n = Number(amt) || 0
  const invalid = n <= 0 || (max !== undefined && n > max)
  return (
    <motion.div className="modal-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="glass modal" initial={{ y: 20, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.97 }} onClick={(e) => e.stopPropagation()} style={{ background: '#0E1014' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--display)', letterSpacing: '-0.02em' }}>{kind === 'deposit' ? 'Deposit to shielded balance' : 'Withdraw from shielded balance'}</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          {kind === 'deposit'
            ? 'USDT moves from your wallet into the private pool as an encrypted note.'
            : 'Withdraw to any address. A relayer submits the proof so the recipient is unlinkable.'}
        </p>
        <div className="input-wrap">
          <input autoFocus inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" aria-label="Amount" />
          {max !== undefined && <button className="unit" style={{ marginRight: 10, color: 'var(--accent)' }} onClick={() => setAmt(String(max))}>MAX</button>}
          <span className="unit">USDT</span>
        </div>
        <button className="btn btn-primary wide" disabled={invalid || busy} onClick={async () => { setBusy(true); try { await onConfirm(n) } finally { setBusy(false) } }}>
          {busy ? 'Generating proof…' : kind === 'deposit' ? 'Deposit' : 'Withdraw'}
        </button>
      </motion.div>
    </motion.div>
  )
}
