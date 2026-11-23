import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEther,
  parseUnits,
  type Address,
  type Chain,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

/**
 * Dev-only "go live" admin panel. Everything is signed by the connected company wallet in the user's
 * own browser wallet. Generated hot-wallet keys exist only in this page's memory and on the user's screen.
 */

export type GoLiveTarget = { chain: Chain; rpc: string; gasPrice?: bigint; explorer?: string; apiUrl?: string }
export type GoLiveAddrs = { oracle: Address; vault: Address; usdt: Address }

const oracleAbi = parseAbi(['function isReporter(address) view returns (bool)', 'function setReporter(address,bool)'])
const vaultAbi = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function tvlCap() view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
])
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
])

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
const eth = (): Eip1193 | undefined => (window as unknown as { ethereum?: Eip1193 }).ethereum

type Hot = { address: Address; key?: Hex }
type Status = {
  reporterBnb?: bigint
  relayerBnb?: bigint
  reporterAuthorized?: boolean
  vaultAssets?: bigint
  tvlCap?: bigint
  companyUsdt?: bigint
  companyBnb?: bigint
  backend?: { reporter: boolean; reporterRunning: boolean; relayer: boolean } | null
}

const field: React.CSSProperties = {
  background: '#0a0a0a', color: '#fff', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '10px 12px', width: '100%',
}

function HotWallet({ label, envName, value, onChange }: { label: string; envName: string; value: Hot | null; onChange: (h: Hot | null) => void }) {
  const [reveal, setReveal] = useState(false)
  const [typed, setTyped] = useState(value?.address ?? '')
  useEffect(() => setTyped(value?.address ?? ''), [value?.address])
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <strong>{label}</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input style={{ ...field, flex: '1 1 320px' }} placeholder="Wallet address (0x…)" value={typed}
          onChange={(e) => { setTyped(e.target.value); onChange(isAddress(e.target.value) ? { address: getAddress(e.target.value) } : null) }} />
        <button className="btn btn-ghost" onClick={() => { const key = generatePrivateKey(); onChange({ address: privateKeyToAccount(key).address, key }); setReveal(false) }}>
          Generate new
        </button>
      </div>
      {value?.key && (
        <div style={{ border: '1px solid rgba(255,255,255,0.3)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 13 }}>
            Private key — save it in your password manager now, then paste it into Railway as <code className="mono">{envName}</code>.
            It is not stored anywhere and disappears when you leave this page. Never paste it into a chat.
          </span>
          <code className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{reveal ? value.key : '•'.repeat(66)}</code>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setReveal((r) => !r)}>{reveal ? 'Hide' : 'Show'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(value.key!)}>Copy key</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function GoLive({ target, account, addrs, company }: { target: GoLiveTarget; account: Address | null; addrs: GoLiveAddrs; company: Address }) {
  const pub = useMemo(() => createPublicClient({ chain: target.chain, transport: http(target.rpc) }), [target])
  const [reporter, setReporter] = useState<Hot | null>(null)
  const [relayer, setRelayer] = useState<Hot | null>(null)
  const [fundReporter, setFundReporter] = useState('0.01')
  const [fundRelayer, setFundRelayer] = useState('0.005')
  const [vaultAmount, setVaultAmount] = useState('100')
  const [status, setStatus] = useState<Status>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const isCompany = account?.toLowerCase() === company.toLowerCase()
  const sym = target.chain.nativeCurrency.symbol

  const refresh = useCallback(async () => {
    const s: Status = {}
    try {
      const [vaultAssets, tvlCap, companyUsdt, companyBnb] = await Promise.all([
        pub.readContract({ address: addrs.vault, abi: vaultAbi, functionName: 'totalAssets' }),
        pub.readContract({ address: addrs.vault, abi: vaultAbi, functionName: 'tvlCap' }),
        pub.readContract({ address: addrs.usdt, abi: erc20Abi, functionName: 'balanceOf', args: [company] }),
        pub.getBalance({ address: company }),
      ])
      Object.assign(s, { vaultAssets, tvlCap, companyUsdt, companyBnb })
      if (reporter) {
        s.reporterBnb = await pub.getBalance({ address: reporter.address })
        s.reporterAuthorized = await pub.readContract({ address: addrs.oracle, abi: oracleAbi, functionName: 'isReporter', args: [reporter.address] })
      }
      if (relayer) s.relayerBnb = await pub.getBalance({ address: relayer.address })
    } catch (e) {
      setErr(`Could not read chain state: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
    }
    if (target.apiUrl) {
      try {
        const h = await fetch(`${target.apiUrl}/health`).then((r) => r.json())
        const last = h?.reporter?.lastRunAt ?? 0
        s.backend = {
          reporter: !!h?.reporter?.configured,
          reporterRunning: !!h?.reporter?.configured && !h?.reporter?.error && Date.now() / 1000 - last < 15 * 60,
          relayer: !!h?.relayer?.configured,
        }
      } catch {
        s.backend = null
      }
    }
    setStatus(s)
  }, [pub, addrs, company, reporter, relayer, target.apiUrl])

  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 20_000)
    return () => clearInterval(t)
  }, [refresh])

  async function withWallet(label: string, fn: (send: (tx: { to: Address; data?: Hex; value?: bigint }, what: string) => Promise<Hex>) => Promise<void>) {
    if (!account || !eth()) return
    setBusy(label)
    setErr('')
    setMsg('')
    try {
      const hex = `0x${target.chain.id.toString(16)}`
      if (((await eth()!.request({ method: 'eth_chainId' })) as string).toLowerCase() !== hex) {
        await eth()!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
      }
      const wallet = createWalletClient({ account, chain: target.chain, transport: custom(eth()!) })
      const fee = target.gasPrice ? { gasPrice: target.gasPrice, type: 'legacy' as const } : {}
      const send = async (tx: { to: Address; data?: Hex; value?: bigint }, what: string) => {
        setMsg(`${what} — confirm in your wallet…`)
        const est = await pub.estimateGas({ account, ...tx })
        const hash = await wallet.sendTransaction({ ...tx, gas: (est * 12n) / 10n, ...fee } as never)
        setMsg(`${what} — waiting for the block…`)
        const rc = await pub.waitForTransactionReceipt({ hash })
        if (rc.status !== 'success') throw new Error(`${what} reverted (tx ${hash})`)
        return hash
      }
      await fn(send)
      setMsg(`${label}: done.`)
      await refresh()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setErr(/rejected|denied/i.test(m) ? 'You rejected the transaction in your wallet.' : m.split('\n')[0])
      setMsg('')
    } finally {
      setBusy(null)
    }
  }

  const fund = (who: Hot | null, amount: string, name: string) =>
    withWallet(`Fund ${name}`, async (send) => {
      if (!who) throw new Error(`Set the ${name} wallet address first.`)
      await send({ to: who.address, value: parseEther(amount) }, `Send ${amount} ${sym} to the ${name}`)
    })

  const authorize = () =>
    withWallet('Authorize reporter', async (send) => {
      if (!reporter) throw new Error('Set the reporter wallet address first.')
      await send({ to: addrs.oracle, data: encodeFunctionData({ abi: oracleAbi, functionName: 'setReporter', args: [reporter.address, true] }) }, 'Authorize the reporter on the oracle')
    })

  const seedVault = () =>
    withWallet('Seed vault', async (send) => {
      const amt = parseUnits(vaultAmount, 18)
      if (amt <= 0n) throw new Error('Enter a USDT amount.')
      const allowance = await pub.readContract({ address: addrs.usdt, abi: erc20Abi, functionName: 'allowance', args: [account!, addrs.vault] })
      if (allowance < amt) {
        await send({ to: addrs.usdt, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [addrs.vault, amt] }) }, `Approve ${vaultAmount} USDT for the vault`)
      }
      await send({ to: addrs.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [amt, company] }) }, `Deposit ${vaultAmount} USDT into the vault`)
    })

  const fmt = (v?: bigint, d = 18, dp = 4) => (v === undefined ? '…' : Number(formatUnits(v, d)).toFixed(dp))
  const tick = (ok?: boolean) => (ok ? '✓' : '○')
  const disabled = !account || !isCompany || !!busy

  return (
    <section style={{ marginTop: 36, display: 'grid', gap: 16 }}>
      <h2 className="display" style={{ fontSize: 'clamp(26px, 4.5vw, 38px)' }}>Go live</h2>
      <p className="muted">
        Real-money trading unlocks on the site once the oracle reporter and the relayer are running. Do these in order. Every
        transaction is signed by the company wallet in your browser wallet.
      </p>
      {account && !isCompany && <p role="alert">Connect the company wallet (0xB342…4035) to run these steps.</p>}

      <div className="glass" style={{ padding: 20, borderRadius: 20, display: 'grid', gap: 18 }}>
        <div><strong>1. Backend wallets</strong> <span className="muted">— two small hot wallets the backend uses to pay gas.</span></div>
        <HotWallet label="Reporter (pushes attention scores to the oracle)" envName="REPORTER_PRIVATE_KEY" value={reporter} onChange={setReporter} />
        <HotWallet label="Relayer (submits private trades so users stay unlinkable)" envName="RELAYER_PRIVATE_KEY" value={relayer} onChange={setRelayer} />
      </div>

      <div className="glass" style={{ padding: 20, borderRadius: 20, display: 'grid', gap: 12 }}>
        <strong>2. Fund them with {sym} from the company wallet</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...field, width: 120 }} value={fundReporter} onChange={(e) => setFundReporter(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={disabled || !reporter} onClick={() => fund(reporter, fundReporter, 'reporter')}>Send to reporter</button>
          <span className="muted" style={{ fontSize: 13 }}>≈ 0.004 {sym}/day</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...field, width: 120 }} value={fundRelayer} onChange={(e) => setFundRelayer(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={disabled || !relayer} onClick={() => fund(relayer, fundRelayer, 'relayer')}>Send to relayer</button>
          <span className="muted" style={{ fontSize: 13 }}>≈ 0.0001 {sym}/trade</span>
        </div>
      </div>

      <div className="glass" style={{ padding: 20, borderRadius: 20, display: 'grid', gap: 12 }}>
        <strong>3. Authorize the reporter on the oracle</strong>
        <button className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }} disabled={disabled || !reporter || status.reporterAuthorized} onClick={authorize}>
          {status.reporterAuthorized ? 'Reporter authorized' : 'Authorize reporter'}
        </button>
      </div>

      <div className="glass" style={{ padding: 20, borderRadius: 20, display: 'grid', gap: 10 }}>
        <strong>4. Add the two keys to Railway</strong>
        <span className="muted" style={{ fontSize: 14 }}>
          Railway → project <em>parlo</em> → service <em>parlo-api</em> → Variables → add <code className="mono">REPORTER_PRIVATE_KEY</code> and{' '}
          <code className="mono">RELAYER_PRIVATE_KEY</code>. The service restarts by itself.
        </span>
      </div>

      <div className="glass" style={{ padding: 20, borderRadius: 20, display: 'grid', gap: 12 }}>
        <strong>5. Seed the LP vault with USDT</strong>
        <span className="muted" style={{ fontSize: 14 }}>
          The vault pays winning traders. Each open position reserves 9× its margin and at most half the vault can be at risk, so
          100 USDT supports about 5 USDT of open margin. You keep PLP shares and can withdraw unlocked USDT later.
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...field, width: 140 }} value={vaultAmount} onChange={(e) => setVaultAmount(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={disabled} onClick={seedVault}>Approve &amp; deposit USDT</button>
        </div>
      </div>

      <div className="glass" style={{ padding: 20, borderRadius: 20, display: 'grid', gap: 6, fontSize: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Status</strong>
          <button className="btn btn-ghost btn-sm" onClick={() => void refresh()}>Refresh</button>
        </div>
        <span>Company wallet: {fmt(status.companyBnb, 18, 6)} {sym} · {fmt(status.companyUsdt, 18, 2)} USDT</span>
        <span>{tick((status.reporterBnb ?? 0n) > 0n)} Reporter funded: {reporter ? `${fmt(status.reporterBnb, 18, 6)} ${sym}` : 'not set'}</span>
        <span>{tick((status.relayerBnb ?? 0n) > 0n)} Relayer funded: {relayer ? `${fmt(status.relayerBnb, 18, 6)} ${sym}` : 'not set'}</span>
        <span>{tick(status.reporterAuthorized)} Reporter authorized on oracle</span>
        <span>{tick((status.vaultAssets ?? 0n) > 0n)} Vault: {fmt(status.vaultAssets, 18, 2)} USDT ({status.tvlCap === 0n ? 'no cap' : `cap ${fmt(status.tvlCap, 18, 0)}`})</span>
        {target.apiUrl && (
          <span>
            {tick(status.backend?.reporterRunning && status.backend?.relayer)} Backend:{' '}
            {status.backend === null ? 'unreachable' : status.backend
              ? `reporter ${status.backend.reporterRunning ? 'running' : status.backend.reporter ? 'configured, not pushing yet' : 'not configured'}, relayer ${status.backend.relayer ? 'configured' : 'not configured'}`
              : '…'}
          </span>
        )}
        {status.backend?.reporterRunning && status.backend?.relayer && <strong style={{ marginTop: 6 }}>Backend ready — real-money trading unlocks on the site within a minute.</strong>}
      </div>

      {msg && <p>{msg}</p>}
      {err && <p role="alert" style={{ border: '1px solid rgba(255,255,255,0.3)', borderRadius: 12, padding: 12 }}>{err}</p>}
      <span className="muted" style={{ fontSize: 12 }}>Status refreshes every 20 seconds.</span>
    </section>
  )
}
