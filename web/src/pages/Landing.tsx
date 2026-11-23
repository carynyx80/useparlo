import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, ArrowUpRight, EyeOff, Fingerprint, Flame, Lock, Plus, Radar, Shield, ShieldCheck, Sparkles, Unlink, Vault, Zap,
} from 'lucide-react'
import Navbar, { Logo } from '../components/Navbar'
import Marquee from '../components/Marquee'
import { AreaChart, Sparkline } from '../components/Charts'
import { MOCK_MARKETS, fmtNum, fmtUsd, mockHistory } from '../lib/api'

const ease = [0.22, 1, 0.36, 1] as const

function Reveal({ children, delay = 0, y = 28 }: { children: ReactNode; delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, ease, delay }}
    >
      {children}
    </motion.div>
  )
}

function HeroChart() {
  const m = MOCK_MARKETS[1] // $PEPE
  const [series, setSeries] = useState(() => mockHistory(m.id, 90).map((p) => p.value))
  useEffect(() => {
    const t = setInterval(() => {
      setSeries((s) => {
        const last = s[s.length - 1]
        const next = +(last * (1 + (Math.random() - 0.46) * 0.018)).toFixed(2)
        return [...s.slice(1), next]
      })
    }, 1600)
    return () => clearInterval(t)
  }, [])
  const val = series[series.length - 1]
  const chg = ((val - series[0]) / series[0]) * 100
  const [animated, setAnimated] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setAnimated(false), 2000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="rise" style={{ position: 'relative', animationDelay: '200ms', animationDuration: '0.9s' }}>
      <div className="glass chart-card">
        <div className="chart-head">
          <div>
            <div className="chart-sym">
              {m.symbol} <span className="tag">ATTN-PERP</span>
            </div>
            <div className="chart-val mono">{val.toFixed(2)}</div>
            <div className={`chg ${chg >= 0 ? 'up' : 'down'}`}>
              {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}% <span className="muted">· 24h</span>
            </div>
          </div>
          <div className="pill" style={{ padding: '6px 12px' }}>
            <span className="live-dot" /> Live index
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <AreaChart values={series} height={200} animate={animated} />
        </div>
        <div className="chart-foot">
          <div className="mini-stat"><div className="l">Mentions</div><div className="v">{fmtNum(m.mentions24h)}</div></div>
          <div className="mini-stat"><div className="l">Volume</div><div className="v">{fmtUsd(m.volume24h)}</div></div>
          <div className="mini-stat"><div className="l">Max lev.</div><div className="v up">20x</div></div>
        </div>
      </div>
      <motion.div className="float-chip chip-a" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.6 }}>
        <span className="ic"><EyeOff size={15} /></span>
        <div><div style={{ fontWeight: 600 }}>Position opened</div><div className="muted" style={{ fontSize: 12 }}>Side & size hidden</div></div>
      </motion.div>
      <motion.div className="float-chip chip-b" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4, duration: 0.6 }}>
        <span className="ic"><Flame size={15} /></span>
        <div><div style={{ fontWeight: 600 }} className="mono">+312.40 USDT</div><div className="muted" style={{ fontSize: 12 }}>Shielded PnL · 12x</div></div>
      </motion.div>
    </div>
  )
}

function Hero() {
  return (
    <section className="hero">
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <div className="grid-bg" />
      <div className="container hero-grid">
        <div>
          <div className="rise" style={{ animationDelay: '0ms' }}>
            <span className="pill"><span className="pill-tag">New</span> Attention perps, live on BNB Chain</span>
          </div>
          <h1 className="display">
            {['Trade', 'the'].map((w, i) => (
              <span key={w} className="rise-word" style={{ marginRight: '0.22em', animationDelay: `${60 + i * 80}ms` }}>{w}</span>
            ))}
            <br />
            <span className="accent rise-word" style={{ animationDelay: '220ms' }}>hype.</span>
          </h1>
          <p className="hero-sub rise" style={{ animationDelay: '340ms' }}>
            Go long or short on what Crypto Twitter is talking about. <strong>Up to 20x. Fully private.</strong>
          </p>
          <div className="hero-ctas rise" style={{ animationDelay: '440ms' }}>
            <Link to="/app" className="btn btn-primary">Launch app <ArrowRight size={17} /></Link>
            <a href="#how" className="btn btn-ghost">How it works</a>
          </div>
          <div className="hero-stats rise" style={{ animationDelay: '560ms' }}>
            <div><div className="v">20x</div><div className="l">Max leverage</div></div>
            <div><div className="v">0.1%</div><div className="l">Open fee</div></div>
            <div><div className="v">ZK</div><div className="l">Groth16 privacy</div></div>
          </div>
        </div>
        <HeroChart />
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    { icon: <Shield size={22} />, t: 'Shield USDT', d: 'Deposit BSC USDT into your shielded balance. A key derived from one wallet signature controls it — nobody else can link it to you.' },
    { icon: <Radar size={22} />, t: 'Pick a narrative', d: 'Every market tracks an attention index built from Reddit, Farcaster and CoinGecko trending — updated on-chain every epoch.' },
    { icon: <Zap size={22} />, t: 'Go long or short', d: 'Choose 1–20x. Your browser generates a zero-knowledge proof, so side and leverage never touch the chain in the clear.' },
  ]
  return (
    <section className="sec" id="how">
      <div className="container">
        <div className="sec-head">
          <Reveal><span className="eyebrow">How it works</span></Reveal>
          <Reveal delay={0.05}><h2 className="h2">Three steps. <span className="dim">Zero doxxing.</span></h2></Reveal>
          <Reveal delay={0.1}><p className="lead">If it trends, you can trade it. Parlo turns social mindshare into a price you can take a side on.</p></Reveal>
        </div>
        <div className="steps">
          {steps.map((s, i) => (
            <Reveal key={s.t} delay={i * 0.1}>
              <div className="glass step">
                <span className="step-n">0{i + 1}</span>
                <div className="step-ic">{s.icon}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function Privacy() {
  const feats = [
    { icon: <Lock size={18} />, t: 'ZK shielded balance', d: 'Funds live as encrypted notes in a Merkle tree. Deposits and withdrawals are verified with Groth16 proofs.' },
    { icon: <EyeOff size={18} />, t: 'Hidden side & leverage', d: 'Only the market and margin are public. Long or short, 2x or 20x — that stays between you and the circuit.' },
    { icon: <Unlink size={18} />, t: 'Unlinkable wallet', d: 'Positions are opened through a relayer from your shielded account, so your trading history can’t be traced to your address.' },
  ]
  const rows = [
    { m: '$PEPE', margin: '250.00' },
    { m: '#AIAgents', margin: '1,000.00' },
    { m: '@cz_binance', margin: '80.00' },
    { m: '#Memecoins', margin: '420.00' },
  ]
  return (
    <section className="sec" id="privacy">
      <div className="container privacy-grid">
        <div>
          <Reveal><span className="eyebrow">Privacy by default</span></Reveal>
          <Reveal delay={0.05}><h2 className="h2">Your alpha<br /><span className="dim">stays yours.</span></h2></Reveal>
          <Reveal delay={0.1}><p className="lead">On every other perp DEX, whales get front-run and copy-traded. On Parlo, the chain only sees that <em>someone</em> took a position.</p></Reveal>
          <div className="feat-list">
            {feats.map((f, i) => (
              <Reveal key={f.t} delay={0.1 + i * 0.08}>
                <div className="feat">
                  <span className="ic">{f.icon}</span>
                  <div><h4>{f.t}</h4><p>{f.d}</p></div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal delay={0.15}>
          <div className="glass ledger">
            <div className="ledger-top">
              <span style={{ fontWeight: 600 }}>What the chain sees</span>
              <span className="shield-badge"><ShieldCheck size={13} /> Proof verified</span>
            </div>
            <div className="ledger-row ledger-h"><span>Market · margin</span><span>Side</span><span>Leverage</span></div>
            {rows.map((r, i) => (
              <motion.div className="ledger-row" key={r.m} initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.12, duration: 0.6, ease }}>
                <span>{r.m}<br /><span className="muted">{r.margin} USDT</span></span>
                <span><span className="redact" style={{ width: 54 }} /></span>
                <span><span className="redact" style={{ width: 34 }} /></span>
              </motion.div>
            ))}
            <div className="ledger-row" style={{ gridTemplateColumns: '1fr' }}>
              <span className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Fingerprint size={14} /> Owner: <span className="redact" style={{ width: 120 }} /></span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Markets() {
  return (
    <section className="sec" id="markets">
      <div className="container">
        <div className="sec-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <Reveal><span className="eyebrow">Markets</span></Reveal>
            <Reveal delay={0.05}><h2 className="h2" style={{ marginBottom: 0 }}>What’s trending <span className="dim">right now.</span></h2></Reveal>
          </div>
          <Reveal delay={0.1}><Link to="/app" className="btn btn-ghost btn-sm">All markets <ArrowUpRight size={15} /></Link></Reveal>
        </div>
        <div className="mk-grid">
          {MOCK_MARKETS.map((m, i) => (
            <Reveal key={m.id} delay={(i % 3) * 0.08}>
              <Link to={`/app?m=${m.id}`} className="glass mk-card">
                <div className="mk-top">
                  <div><div className="mk-sym">{m.symbol}</div><div className="mk-name">{m.name}</div></div>
                  <span className={`chg ${m.change24h >= 0 ? 'up' : 'down'}`}>{m.change24h >= 0 ? '▲' : '▼'} {Math.abs(m.change24h).toFixed(1)}%</span>
                </div>
                <div className="mk-bottom">
                  <div>
                    <div className="mk-val mono">{m.value.toFixed(2)}</div>
                    <div className="mk-name">Vol {fmtUsd(m.volume24h)}</div>
                  </div>
                  <Sparkline values={m.sparkline} up={m.change24h >= 0} width={120} height={44} />
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function VaultSection() {
  return (
    <section className="sec" id="vault" style={{ paddingTop: 40 }}>
      <div className="container">
        <Reveal>
          <div className="glass vault">
            <div className="glow" style={{ width: 400, height: 400, bottom: -200, left: -100, background: 'radial-gradient(closest-side, rgba(255,255,255,.16), transparent)' }} />
            <div style={{ position: 'relative' }}>
              <span className="eyebrow">Liquidity vault</span>
              <h2 className="h2">Be the house.</h2>
              <p className="lead">Deposit USDT into the Parlo LP vault and earn from trader losses and half of all trading fees. PLP is a simple ERC-20 share — withdraw any time.</p>
              <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Link to="/app#vault" className="btn btn-primary"><Vault size={17} /> Provide liquidity</Link>
              </div>
            </div>
            <div className="vault-stats" style={{ position: 'relative' }}>
              <div className="vault-stat"><div className="v">$4.82M</div><div className="l">Vault TVL</div></div>
              <div className="vault-stat"><div className="v up">23.6%</div><div className="l">Trailing APR</div></div>
              <div className="vault-stat"><div className="v">50%</div><div className="l">Fee share to LPs</div></div>
              <div className="vault-stat"><div className="v">10×</div><div className="l">Payout cap / margin</div></div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

const FAQS = [
  { q: 'What is an attention perp?', a: 'A leveraged position on an attention index — a score measuring how much a token, topic or person is being talked about across Reddit, Farcaster and CoinGecko trending. If you think a narrative is about to blow up, go long. If you think it has peaked, go short.' },
  { q: 'How is my position private?', a: 'Your USDT sits in a shielded pool as encrypted notes. When you open a position your browser generates a Groth16 zero-knowledge proof that you own enough balance and that your hidden side and leverage are valid. The chain only sees the market id and margin.' },
  { q: 'What leverage and fees apply?', a: 'Leverage from 1x to 20x. A 0.1% fee on notional is charged on open and another 0.1% on close. Profits are capped at 10× your margin per position.' },
  { q: 'How do liquidations work?', a: 'A long is knocked out if the index trades at or below entry × (1 − 0.9 / leverage) during its lifetime; a short if it reaches entry × (1 + 0.9 / leverage). Positions run for up to 16 epochs.' },
  { q: 'Which wallets are supported?', a: 'Any EVM wallet on BNB Smart Chain: MetaMask, Trust Wallet, Binance Web3 Wallet, OKX, Coinbase Wallet and anything that supports WalletConnect.' },
  { q: 'Where does the index data come from?', a: 'An open indexer samples social and market sources every minute. Authorised reporters push the score on-chain each epoch, and the oracle rejects any single move larger than 20%.' },
]

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="sec" id="faq">
      <div className="container">
        <div className="sec-head center">
          <Reveal><span className="eyebrow">FAQ</span></Reveal>
          <Reveal delay={0.05}><h2 className="h2">Questions, <span className="dim">answered.</span></h2></Reveal>
        </div>
        <div className="faq">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 0.04} y={16}>
              <div className={`faq-item ${open === i ? 'open' : ''}`}>
                <button className="faq-q" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  {f.q}
                  <span className="pm"><Plus size={16} /></span>
                </button>
                <AnimatePresence initial={false}>
                  {open === i && (
                    <motion.div className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease }}>
                      <p>{f.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function CtaBand() {
  return (
    <section style={{ padding: '40px 0 120px' }}>
      <div className="container">
        <Reveal>
          <div className="glass cta-band">
            <div className="glow glow-a" style={{ top: -260 }} />
            <div style={{ position: 'relative' }}>
              <span className="pill"><Sparkles size={14} color="#FFFFFF" /> The timeline is the chart</span>
              <h2 className="h2" style={{ marginTop: 24 }}>Front-run the <span style={{ color: 'var(--accent)' }}>narrative.</span></h2>
              <p className="lead" style={{ margin: '0 auto 32px' }}>Open your first private position in under a minute.</p>
              <Link to="/app" className="btn btn-primary">Launch app <ArrowRight size={17} /></Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div style={{ maxWidth: 320 }}>
            <Logo />
            <p style={{ marginTop: 14 }}>Private, leveraged attention perpetuals on BNB Chain.</p>
          </div>
          <div className="footer-cols">
            <div><h5>Product</h5><Link to="/app">Trade</Link><a href="#vault">Vault</a><a href="#markets">Markets</a></div>
            <div><h5>Learn</h5><a href="#how">How it works</a><a href="#privacy">Privacy</a><a href="#faq">FAQ</a></div>
            <div><h5>Community</h5><a href="https://x.com" target="_blank" rel="noreferrer">X / Twitter</a><a href="https://t.me" target="_blank" rel="noreferrer">Telegram</a><a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a></div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Parlo · useparlo.xyz</span>
          <span>Trading leveraged products carries significant risk. Not available in restricted jurisdictions.</span>
        </div>
      </div>
    </footer>
  )
}

export default function Landing() {
  useEffect(() => {
    document.title = 'Parlo — Trade the hype'
  }, [])
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Marquee />
        <HowItWorks />
        <Privacy />
        <Markets />
        <VaultSection />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
    </>
  )
}
