import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, useReadContract, useSignMessage, useSwitchChain } from 'wagmi'
import { formatUnits, isAddress, parseUnits, type Address } from 'viem'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Coins, EyeOff, Info, KeyRound, Loader2, Lock, RefreshCw, ShieldCheck, X } from 'lucide-react'
import Navbar from '../components/Navbar'
import { AreaChart } from '../components/Charts'
import { fetchHistory, fetchMarkets, fetchTradingStatus, fmtUsd, MOCK_MARKETS, type HistoryPoint, type Market } from '../lib/api'
import { IS_LOCAL_CHAIN, TARGET_CHAIN } from '../lib/wagmi'
import { CONTRACTS_CONFIGURED, FEE_BPS_CLOSE, FEE_BPS_OPEN, INDEX_SCALE, MAX_LEVERAGE, PROFIT_CAP_MULTIPLE, USDT_ADDRESS, erc20Abi, liquidationLevel } from '../lib/contracts'
import { SHIELDED_ACCOUNT_MESSAGE, type OwnedPosition, type PositionStatus } from '../lib/zk'
import { errorMessage, useShielded } from '../hooks/useShielded'

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`
const usdt = (v: bigint) => Number(formatUnits(v, 18))

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

  // Real mode (contracts configured): balances/positions come from the shielded-account scan.
  const sh = useShielded()
  // Contracts deployed AND reporter + relayer running. Otherwise stay simulated so no real funds can get stuck.
  const [trading, setTrading] = useState<{ live: boolean; reason: string } | null>(null)
  useEffect(() => {
    if (!CONTRACTS_CONFIGURED) return
    let alive = true
    const load = () => fetchTradingStatus().then((s) => alive && setTrading(s))
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const real = CONTRACTS_CONFIGURED && !!trading?.live
  // Simulated preview mode (VITE_POOL_ADDRESS unset): local-only state.
  const [simUnlocked, setSimUnlocked] = useState(false)
  const [simShielded, setSimShielded] = useState(0)
  const [positions, setPositions] = useState<Position[]>([])
  const [modal, setModal] = useState<null | 'deposit' | 'withdraw'>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [isLong, setIsLong] = useState(true)
  const [margin, setMargin] = useState('100')
  const [lev, setLev] = useState(10)
  const [simBusy, setSimBusy] = useState(false)
  const busy = real ? !!sh.busy : simBusy
  const unlocked = real ? sh.unlocked : simUnlocked
  const shielded = real ? usdt(sh.scan?.balance ?? 0n) : simShielded
  const largestNote = real ? usdt(sh.scan?.notes.reduce((m, n) => (n.amount > m ? n.amount : m), 0n) ?? 0n) : simShielded

  const { data: walletUsdt, refetch: refetchWalletUsdt } = useReadContract({
    address: USDT_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined,
    chainId: TARGET_CHAIN.id, query: { enabled: real && !!address, refetchInterval: 15_000 },
  })

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
  useEffect(() => { setSimUnlocked(false) }, [address])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), /tx 0x|Minted|simulated/.test(toast) ? 6000 : 12_000)
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

  async function ensureKey(): Promise<boolean> {
    if (unlocked) return true
    try {
      if (real) return !!(await sh.unlock())
      await signMessageAsync({ message: SHIELDED_ACCOUNT_MESSAGE })
      setSimUnlocked(true)
      return true
    } catch (err) {
      setToast(`Shielded account not unlocked: ${errorMessage(err)}`)
      return false
    }
  }

  async function openPosition() {
    if (!isConnected) return openConnectModal?.()
    if (wrongNetwork) return switchChain({ chainId: TARGET_CHAIN.id })
    if (!(await ensureKey())) return
    if (marginNum <= 0) return setToast('Enter a margin amount.')
    if (marginNum > shielded) return setToast('Insufficient shielded balance — deposit USDT first.')
    if (real) {
      try {
        const hash = await sh.open({ marketId: market.id, isLong, margin: parseUnits(margin, 18), leverage: lev })
        setToast(`Private position opened on ${market.symbol} · tx ${shortHash(hash)}`)
      } catch (err) {
        setToast(errorMessage(err))
      }
      return
    }
    setSimBusy(true)
    await new Promise((r) => setTimeout(r, 1400))
    setSimShielded((b) => +(b - marginNum).toFixed(2))
    setPositions((p) => [
      { id: crypto.randomUUID(), marketId: market.id, symbol: market.symbol, isLong, margin: marginNum, leverage: lev, entry, openedAt: Date.now() },
      ...p,
    ])
    setSimBusy(false)
    setToast('Preview mode: position simulated locally (contracts not configured).')
  }

  async function closeReal(pos: OwnedPosition) {
    try {
      const r = await sh.close(pos)
      setToast(`Closed: ${usdt(r.payout).toFixed(2)} USDT${r.knockedOut ? ' (knocked out)' : ''} returned to shielded balance · tx ${shortHash(r.txHash)}`)
    } catch (err) {
      setToast(errorMessage(err))
    }
  }

  function closePosition(pos: Position) {
    const m = markets.find((x) => x.id === pos.marketId)
    const exit = m?.value ?? pos.entry
    const pnl = pos.margin * pos.leverage * ((exit - pos.entry) / pos.entry) * (pos.isLong ? 1 : -1)
    const fee = (pos.margin * pos.leverage * (FEE_BPS_OPEN + FEE_BPS_CLOSE)) / 10_000
    const payout = Math.min(Math.max(pos.margin + pnl - fee, 0), pos.margin * PROFIT_CAP_MULTIPLE)
    setSimShielded((b) => +(b + payout).toFixed(2))
    setPositions((p) => p.filter((x) => x.id !== pos.id))
    setToast(`Closed ${pos.symbol}: ${payout.toFixed(2)} USDT returned to shielded balance (simulated).`)
  }

  async function mint() {
    try {
      const h = await sh.mintTestUsdt()
      void refetchWalletUsdt()
      setToast(`Minted 10,000 test USDT · tx ${shortHash(h)}`)
    } catch (err) {
      setToast(errorMessage(err))
    }
  }

  const cta = !isConnected
    ? 'Connect wallet'
    : wrongNetwork
      ? `Switch to ${TARGET_CHAIN.name}`
      : sh.busy === 'open' || simBusy
        ? 'Opening…'
        : 'Open private position'

  return (
    <>
      <Navbar app />
      <main className="app-shell">
        <div className="container" style={{ maxWidth: 1480 }}>
          {wrongNetwork && (
            <div className="banner warn">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} color="#7D7D7D" /> You’re on the wrong network. Parlo runs on {TARGET_CHAIN.name}.</span>
              <button className="btn btn-primary btn-sm" disabled={switching} onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}>
                {switching ? 'Switching…' : `Switch to ${TARGET_CHAIN.name}`}
              </button>
            </div>
          )}
          {CONTRACTS_CONFIGURED && trading && !trading.live && (
            <div className="banner info">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Info size={16} color="#FFFFFF" /> Parlo is deployed on BNB Chain mainnet. Real-money trading opens soon — {trading.reason}. Until then trades here are simulated. {live ? 'Live index data.' : 'Index data is simulated.'}</span>
            </div>
          )}
          {!CONTRACTS_CONFIGURED && (
            <div className="banner info">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Info size={16} color="#FFFFFF" /> Preview mode — contracts not configured, trades are simulated locally. {live ? 'Live index data.' : 'Index data is simulated.'}</span>
            </div>
          )}
          {real && IS_LOCAL_CHAIN && (
            <div className="banner warn">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Info size={16} color="#7D7D7D" /> Local test chain ({TARGET_CHAIN.id}) — test USDT only. Dev trusted setup, not for real funds.</span>
            </div>
          )}
          {real && sh.scanError && unlocked && (
            <div className="banner warn"><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} color="#7D7D7D" /> {sh.scanError}</span></div>
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
                      markers={marginNum > 0 ? [{ value: liq, label: 'liq', color: '#7D7D7D' }] : undefined} />
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
                {real ? (
                  <RealPositions
                    positions={sh.scan?.positions ?? []}
                    statuses={sh.statuses}
                    markets={markets}
                    connected={isConnected}
                    unlocked={unlocked}
                    busy={busy}
                    closing={sh.busy === 'close'}
                    onClose={closeReal}
                  />
                ) : null}
                {real && sh.busy === 'close' && sh.step && <div className="step-line" role="status"><Loader2 size={14} className="spin" /> {sh.step}</div>}
                {real ? null : positions.length === 0 ? (
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
                <div className="panel-title">
                  Shielded balance
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {real && unlocked && (
                      <button aria-label="Rescan shielded notes" title="Rescan" onClick={() => void sh.refresh()} disabled={sh.scanning} style={{ display: 'flex' }}>
                        <RefreshCw size={13} className={sh.scanning ? 'spin' : undefined} />
                      </button>
                    )}
                    <ShieldCheck size={14} color="#FFFFFF" />
                  </span>
                </div>
                <div className="bal">
                  {unlocked || !isConnected
                    ? <span className="mono">{real && unlocked && !sh.scan ? '…' : shielded.toFixed(2)}</span>
                    : <span className="redact" style={{ width: 110, height: 26 }} />}
                  <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>USDT</span>
                </div>
                {real && isConnected && (
                  <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
                    Wallet: {walletUsdt !== undefined ? usdt(walletUsdt).toFixed(2) : '—'} USDT
                    {unlocked && sh.scan ? ` · ${sh.scan.notes.length} note${sh.scan.notes.length === 1 ? '' : 's'}` : ''}
                  </div>
                )}
                {isConnected && !unlocked && (
                  <button className="btn btn-ghost btn-sm wide" style={{ marginTop: 12 }} disabled={sh.busy === 'unlock'} onClick={() => void ensureKey()}>
                    <KeyRound size={14} /> {sh.busy === 'unlock' ? 'Sign in your wallet…' : 'Unlock shielded account'}
                  </button>
                )}
                <div className="bal-actions">
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => (isConnected ? setModal('deposit') : openConnectModal?.())}><ArrowDownToLine size={15} /> Deposit</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => (isConnected ? setModal('withdraw') : openConnectModal?.())}><ArrowUpFromLine size={15} /> Withdraw</button>
                </div>
                {real && IS_LOCAL_CHAIN && isConnected && !wrongNetwork && (
                  <button className="btn btn-ghost btn-sm wide" style={{ marginTop: 10 }} disabled={busy} onClick={() => void mint()}>
                    <Coins size={14} /> {sh.busy === 'mint' ? 'Minting…' : 'Mint 10k test USDT'}
                  </button>
                )}
              </section>

              <section className="glass panel">
                <div className="seg" role="tablist">
                  <button className={`long ${isLong ? 'on' : ''}`} onClick={() => setIsLong(true)}>Long</button>
                  <button className={`short ${!isLong ? 'on' : ''}`} onClick={() => setIsLong(false)}>Short</button>
                </div>
                <div className="field">
                  <label><span>Margin</span><span>Avail. {shielded.toFixed(2)}{real && largestNote < shielded ? ` (max ${largestNote.toFixed(2)}/note)` : ''}</span></label>
                  <div className="input-wrap">
                    <input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" aria-label="Margin in USDT" />
                    <button className="unit" style={{ marginRight: 10, color: 'var(--accent)' }} onClick={() => setMargin(String(largestNote))}>MAX</button>
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
                  style={!isLong && isConnected && !wrongNetwork ? { background: 'var(--down)', color: '#000000', boxShadow: '0 10px 40px -10px rgba(125,125,125,.6)' } : undefined}>
                  {sh.busy === 'open' ? <Loader2 size={16} className="spin" /> : <Lock size={16} />} {cta}
                </button>
                {real && sh.busy === 'open' && sh.step && <div className="step-line" role="status">{sh.step}</div>}
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
            real={real}
            max={modal === 'withdraw' ? shielded : undefined}
            defaultRecipient={address}
            step={real && (sh.busy === 'deposit' || sh.busy === 'withdraw') ? sh.step : null}
            onClose={() => setModal(null)}
            onConfirm={async (amt, recipient) => {
              if (wrongNetwork) { switchChain({ chainId: TARGET_CHAIN.id }); return null }
              if (!(await ensureKey())) return null
              if (real) {
                const wei = parseUnits(amt, 18)
                const hash = modal === 'deposit' ? await sh.deposit(wei) : await sh.withdraw(wei, recipient as Address)
                void refetchWalletUsdt()
                setToast(`${modal === 'deposit' ? 'Shielded' : 'Withdrew'} ${Number(amt).toFixed(2)} USDT · tx ${shortHash(hash)}`)
                return hash
              }
              await new Promise((r) => setTimeout(r, 1000))
              const n = Number(amt)
              setSimShielded((b) => +(modal === 'deposit' ? b + n : b - n).toFixed(2))
              setModal(null)
              setToast(`${modal === 'deposit' ? 'Shielded' : 'Withdrew'} ${n.toFixed(2)} USDT (simulated).`)
              return null
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

function BalanceModal({ kind, real, max, defaultRecipient, step, onClose, onConfirm }: {
  kind: 'deposit' | 'withdraw'
  real: boolean
  max?: number
  defaultRecipient?: string
  step: string | null
  onClose: () => void
  onConfirm: (amt: string, recipient?: string) => Promise<string | null>
}) {
  const [amt, setAmt] = useState('')
  const [recipient, setRecipient] = useState(defaultRecipient ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const n = Number(amt) || 0
  const badRecipient = kind === 'withdraw' && real && !isAddress(recipient)
  const invalid = n <= 0 || (max !== undefined && n > max + 1e-12) || badRecipient
  const close = () => { if (!busy) onClose() }
  return (
    <motion.div className="modal-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
      <motion.div className="glass modal" initial={{ y: 20, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.97 }} onClick={(e) => e.stopPropagation()} style={{ background: '#0A0A0A' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--display)', letterSpacing: '-0.02em' }}>{kind === 'deposit' ? 'Deposit to shielded balance' : 'Withdraw from shielded balance'}</h3>
          <button onClick={close} aria-label="Close" disabled={busy}><X size={18} /></button>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          {kind === 'deposit'
            ? 'USDT moves from your wallet into the private pool as an encrypted note. Your wallet approves the exact amount, then submits the deposit proof.'
            : 'A relayer submits the withdrawal proof and pays the gas, so your wallet never touches this transaction.'}
        </p>
        <div className="input-wrap">
          <input autoFocus inputMode="decimal" value={amt} disabled={busy} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" aria-label="Amount" />
          {max !== undefined && <button className="unit" style={{ marginRight: 10, color: 'var(--accent)' }} onClick={() => setAmt(String(max))}>MAX</button>}
          <span className="unit">USDT</span>
        </div>
        {kind === 'withdraw' && real && (
          <>
            <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
              <label><span>Recipient</span>{defaultRecipient && recipient.toLowerCase() !== defaultRecipient.toLowerCase() && <button className="muted" onClick={() => setRecipient(defaultRecipient)}>use my wallet</button>}</label>
              <div className="input-wrap">
                <input value={recipient} disabled={busy} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="0x…" aria-label="Recipient address" className="mono" style={{ fontSize: 14 }} />
              </div>
            </div>
            {recipient && badRecipient && <div className="err-line" style={{ marginTop: 8 }}>Not a valid address (check the checksum, or paste it in lowercase).</div>}
            <div className="note" style={{ marginTop: 8 }}><EyeOff size={13} style={{ flex: 'none', marginTop: 2 }} /> For privacy, withdraw to a fresh address that has never interacted with your depositing wallet. Withdrawing back to the same wallet links the two on-chain.</div>
          </>
        )}
        {step && busy && <div className="step-line" role="status"><Loader2 size={14} className="spin" /> {step}</div>}
        {error && <div className="err-line" role="alert">{error}</div>}
        {txHash ? (
          <>
            <div className="step-line">Confirmed · tx <span className="mono">{shortHash(txHash)}</span></div>
            <button className="btn btn-ghost wide" onClick={onClose}>Done</button>
          </>
        ) : (
          <button className="btn btn-primary wide" disabled={invalid || busy} onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const h = await onConfirm(amt, recipient)
              if (h) setTxHash(h)
            } catch (err) {
              setError(errorMessage(err))
            } finally {
              setBusy(false)
            }
          }}>
            {busy ? 'Working…' : kind === 'deposit' ? 'Deposit' : 'Withdraw'}
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}

function RealPositions({ positions, statuses, markets, connected, unlocked, busy, closing, onClose }: {
  positions: OwnedPosition[]
  statuses: Record<string, PositionStatus>
  markets: Market[]
  connected: boolean
  unlocked: boolean
  busy: boolean
  closing: boolean
  onClose: (p: OwnedPosition) => void
}) {
  if (!connected) return <div className="empty">Connect your wallet to see your shielded positions.</div>
  if (!unlocked) return <div className="empty">Unlock your shielded account to decrypt your positions.</div>
  if (!positions.length) return <div className="empty">No open positions yet.</div>
  const idx = (v: bigint | null) => (v === null ? null : Number(v) / INDEX_SCALE)
  return (
    <div className="table-wrap">
      <table className="pos">
        <thead><tr><th>Market</th><th>Side</th><th>Margin</th><th>Lev.</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>PnL</th><th>Status</th><th /></tr></thead>
        <tbody>
          {positions.map((p) => {
            const st = statuses[p.commitment.toString()]
            const sym = markets.find((m) => m.id === Number(p.marketId))?.symbol ?? `#${p.marketId}`
            const entry = idx(st?.entry ?? null)
            const mark = idx(st?.mark ?? null)
            const margin = usdt(p.margin)
            const est = st?.live ?? st?.settle ?? null
            const pnl = est ? usdt(est.payout) - margin : null
            const ko = !!(st?.settle?.knockedOut || st?.live?.knockedOut)
            const left = st ? Number(st.deadlineEpoch - st.currentEpoch) : null
            const status = !st
              ? '…'
              : st.expired
                ? 'expired'
                : ko
                  ? 'knocked out'
                  : !st.entry
                    ? 'pending entry'
                    : st.closeOffset < 1
                      ? 'opening'
                      : `${left} ep. left`
            const canClose = !!st && !st.expired && st.closeOffset >= 1 && !busy
            return (
              <tr key={p.commitment.toString()}>
                <td style={{ fontFamily: 'var(--sans)', fontWeight: 600 }}>{sym}</td>
                <td><span className={`side-pill ${p.isLong ? 'long' : 'short'}`}>{p.isLong ? 'LONG' : 'SHORT'}</span></td>
                <td>{margin.toFixed(2)}</td>
                <td>{p.leverage.toString()}x</td>
                <td>{entry === null ? <span className="muted">pending</span> : entry.toFixed(2)}</td>
                <td>{mark === null ? '—' : mark.toFixed(2)}</td>
                <td className="down">{entry === null ? '—' : liquidationLevel(entry, Number(p.leverage), p.isLong).toFixed(2)}</td>
                <td className={pnl === null ? 'muted' : pnl >= 0 ? 'up' : 'down'}>{pnl === null ? '—' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`}</td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }} title={st ? `Entry epoch ${p.entryEpoch}; must close before epoch ${st.deadlineEpoch}` : undefined}>{status}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" style={{ height: 30 }} disabled={!canClose} onClick={() => onClose(p)}
                    title={canClose ? 'Close with a zero-knowledge proof' : 'Closable once the entry epoch and one more epoch are finalized'}>
                    {closing ? 'Closing…' : 'Close'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
