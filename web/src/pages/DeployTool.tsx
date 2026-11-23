import { useEffect, useMemo, useState } from 'react'
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { bsc, foundry } from 'viem/chains'
import artifacts from '../deploy/artifacts.json'
import GoLive from './GoLive'

/**
 * Dev-only deploy tool: deploys Parlo from the user's own browser wallet (MetaMask / Trust / Binance
 * Wallet). Keys never leave the wallet. Mirrors contracts/script/Deploy.s.sol with deployer = company wallet.
 */

const COMPANY = getAddress('0xB34296465F18F55003100e925aBc70656E224035')
/** BNB Chain mainnet deployment (contracts/deployments/56.json). */
const MAINNET = {
  oracle: getAddress('0x39ca194a97e60f0fa45f2683c9de3d4d1ac0314a'),
  vault: getAddress('0x6c063cde3408d6075b3ddccbbcb79fc91d625c2b'),
  usdt: getAddress('0x55d398326f99059fF775485246999027B3197955'),
}
const BSC_USDT = getAddress('0x55d398326f99059fF775485246999027B3197955')
const EPOCH_LENGTH = 300n
const MARKETS: Array<[bigint, string]> = [
  [1n, '$BNB'],
  [2n, '$PEPE'],
  [3n, '#AIAgents'],
  [4n, '#Memecoins'],
  [5n, '@cz_binance'],
  [6n, '#RWA'],
]

type Art = { abi: readonly unknown[]; bytecode: Hex; linkReferences: Record<string, Record<string, { start: number; length: number }[]>> }
const A = artifacts as unknown as Record<string, Art>

type Target = { key: 'bsc' | 'local'; chain: typeof bsc | typeof foundry; rpc: string; usdt?: Address; gasPrice?: bigint; explorer?: string }
const TARGETS: Record<Target['key'], Target> = {
  bsc: { key: 'bsc', chain: bsc, rpc: 'https://bsc-dataseed.bnbchain.org', usdt: BSC_USDT, gasPrice: 50_000_000n, explorer: 'https://bscscan.com' },
  local: { key: 'local', chain: foundry, rpc: 'http://127.0.0.1:8545' },
}

type Progress = Record<string, string> // step id -> address or tx hash
type Step = { id: string; label: string }

const STEPS: Step[] = [
  { id: 'poseidon', label: 'Deploy PoseidonT3 hashing library' },
  { id: 'tv', label: 'Deploy TransactVerifier (ZK)' },
  { id: 'ov', label: 'Deploy OpenVerifier (ZK)' },
  { id: 'cv', label: 'Deploy CloseVerifier (ZK)' },
  { id: 'oracle', label: 'Deploy AttentionOracle (5-min epochs)' },
  ...MARKETS.map(([id, sym]) => ({ id: `market${id}`, label: `Add market ${sym}` })),
  { id: 'vault', label: 'Deploy LiquidityVault (treasury = company wallet)' },
  { id: 'pool', label: 'Deploy ParloPool' },
  { id: 'setPool', label: 'Connect vault → pool' },
]

const storeKey = (t: Target) => `parlo-deploy-${t.chain.id}`
function loadProgress(t: Target): Progress {
  try {
    return JSON.parse(localStorage.getItem(storeKey(t)) || '{}')
  } catch {
    return {}
  }
}
function saveProgress(t: Target, p: Progress) {
  try {
    localStorage.setItem(storeKey(t), JSON.stringify(p))
  } catch {
    /* storage unavailable: progress still shown on screen */
  }
}

function link(bytecode: Hex, refs: Art['linkReferences'], lib: Address): Hex {
  let code = bytecode.slice(2)
  for (const file of Object.values(refs)) {
    for (const spots of Object.values(file)) {
      for (const { start, length } of spots) {
        code = code.slice(0, start * 2) + lib.slice(2).toLowerCase() + code.slice((start + length) * 2)
      }
    }
  }
  return `0x${code}`
}

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
const eth = (): Eip1193 | undefined => (window as unknown as { ethereum?: Eip1193 }).ethereum

type DeployArgs = Parameters<typeof encodeDeployData>[0]
type CallArgs = Parameters<typeof encodeFunctionData>[0]
const deployData = (art: Art, args: unknown[], bytecode: Hex = art.bytecode) =>
  encodeDeployData({ abi: art.abi as Abi, bytecode, args } as unknown as DeployArgs)
const callData = (art: Art, functionName: string, args: unknown[]) =>
  encodeFunctionData({ abi: art.abi as Abi, functionName, args } as unknown as CallArgs)

export default function DeployTool() {
  const [targetKey, setTargetKey] = useState<Target['key']>('bsc')
  const t = TARGETS[targetKey]
  const [account, setAccount] = useState<Address | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [progress, setProgress] = useState<Progress>(() => loadProgress(t))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [usdt, setUsdt] = useState<string>('')

  const pub = useMemo(() => createPublicClient({ chain: t.chain, transport: http(t.rpc) }), [t])

  useEffect(() => {
    setProgress(loadProgress(t))
  }, [t])

  useEffect(() => {
    if (!account) return
    pub.getBalance({ address: account }).then(setBalance).catch(() => setBalance(null))
  }, [account, pub, progress])

  const isCompany = account?.toLowerCase() === COMPANY.toLowerCase()
  const doneCount = STEPS.filter((s) => progress[s.id]).length
  const allDone = doneCount === STEPS.length

  async function connect() {
    setError('')
    if (!eth()) {
      setError('No browser wallet found. Open this page in Chrome/Brave with MetaMask, Trust Wallet or Binance Wallet installed.')
      return
    }
    const accs = (await eth()!.request({ method: 'eth_requestAccounts' })) as string[]
    setAccount(getAddress(accs[0]))
  }

  async function ensureChain() {
    const hex = `0x${t.chain.id.toString(16)}`
    const current = (await eth()!.request({ method: 'eth_chainId' })) as string
    if (current.toLowerCase() === hex) return
    try {
      await eth()!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
    } catch {
      await eth()!.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, chainName: t.chain.name, nativeCurrency: t.chain.nativeCurrency, rpcUrls: [t.rpc] }],
      })
    }
  }

  async function run() {
    if (!account) return
    setBusy(true)
    setError('')
    const p: Progress = { ...progress }
    const commit = (id: string, v: string) => {
      p[id] = v
      saveProgress(t, p)
      setProgress({ ...p })
    }
    try {
      await ensureChain()
      const wallet = createWalletClient({ account, chain: t.chain, transport: custom(eth()!) })
      const fee = t.gasPrice ? { gasPrice: t.gasPrice, type: 'legacy' as const } : {}

      const send = async (label: string, data: Hex, to?: Address) => {
        setStatus(`${label} — confirm in your wallet…`)
        const est = await pub.estimateGas({ account, to, data })
        const hash = await wallet.sendTransaction({ to, data, gas: (est * 12n) / 10n, ...fee } as never)
        setStatus(`${label} — waiting for the block…`)
        const rc = await pub.waitForTransactionReceipt({ hash })
        if (rc.status !== 'success') throw new Error(`${label} reverted (tx ${hash})`)
        return rc
      }
      const deploy = async (id: string, label: string, data: Hex) => {
        if (p[id]) return getAddress(p[id])
        const rc = await send(label, data)
        if (!rc.contractAddress) throw new Error(`${label}: no contract address in receipt`)
        commit(id, rc.contractAddress)
        return getAddress(rc.contractAddress)
      }
      const call = async (id: string, label: string, to: Address, data: Hex) => {
        if (p[id]) return
        const rc = await send(label, data, to)
        commit(id, rc.transactionHash)
      }

      // USDT: BSC mainnet uses the real token; local chain needs an existing MockUSDT address.
      const usdtAddr = t.usdt ?? (usdt ? getAddress(usdt) : null)
      if (!usdtAddr) throw new Error('Enter the MockUSDT address for the local chain.')
      if (!p.startBlock) commit('startBlock', (await pub.getBlockNumber()).toString())

      const poseidon = await deploy('poseidon', STEPS[0].label, A.PoseidonT3.bytecode)
      const tv = await deploy('tv', STEPS[1].label, A.TransactVerifier.bytecode)
      const ov = await deploy('ov', STEPS[2].label, A.OpenVerifier.bytecode)
      const cv = await deploy('cv', STEPS[3].label, A.CloseVerifier.bytecode)
      const oracle = await deploy(
        'oracle',
        STEPS[4].label,
        deployData(A.AttentionOracle, [account, EPOCH_LENGTH]),
      )
      for (const [id, sym] of MARKETS) {
        await call(`market${id}`, `Add market ${sym}`, oracle, callData(A.AttentionOracle, 'addMarket', [id, sym]))
      }
      const vault = await deploy(
        'vault',
        'Deploy LiquidityVault',
        deployData(A.LiquidityVault, [account, usdtAddr, oracle, COMPANY]),
      )
      const poolCode = link(A.ParloPool.bytecode, A.ParloPool.linkReferences, poseidon)
      const pool = await deploy(
        'pool',
        'Deploy ParloPool',
        deployData(A.ParloPool, [account, usdtAddr, oracle, vault, tv, ov, cv], poolCode),
      )
      await call('setPool', 'Connect vault → pool', vault, callData(A.LiquidityVault, 'setPool', [pool]))
      commit('usdt', usdtAddr)
      setStatus('Deployment complete.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/rejected|denied/i.test(msg) ? 'You rejected the transaction in your wallet. Press Deploy again to continue from this step.' : msg.split('\n')[0])
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const deploymentJson = allDone
    ? JSON.stringify(
        {
          chainId: t.chain.id,
          startBlock: Number(progress.startBlock),
          epochLength: Number(EPOCH_LENGTH),
          owner: COMPANY,
          treasury: COMPANY,
          usdt: progress.usdt,
          transactVerifier: progress.tv,
          openVerifier: progress.ov,
          closeVerifier: progress.cv,
          oracle: progress.oracle,
          vault: progress.vault,
          pool: progress.pool,
          poseidonT3: progress.poseidon,
        },
        null,
        2,
      )
    : ''

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 16px 96px' }}>
      <h1 className="display" style={{ fontSize: 'clamp(32px, 6vw, 52px)', marginBottom: 8 }}>Deploy Parlo</h1>
      <p className="muted" style={{ marginBottom: 28 }}>
        Deploys the Parlo contracts from your own browser wallet. Your private key never leaves the wallet — you just confirm each
        transaction. Progress is saved after every step, so you can close this page and continue later without paying twice.
      </p>

      <div className="glass" style={{ padding: 20, borderRadius: 20, marginBottom: 20, display: 'grid', gap: 12 }}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">Network</span>
          <select value={targetKey} onChange={(e) => setTargetKey(e.target.value as Target['key'])} disabled={busy}
            style={{ background: '#0a0a0a', color: '#fff', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '8px 10px' }}>
            <option value="bsc">BNB Smart Chain mainnet (56)</option>
            <option value="local">Local test chain (31337)</option>
          </select>
        </label>
        {targetKey === 'local' && (
          <input placeholder="MockUSDT address on the local chain" value={usdt} onChange={(e) => setUsdt(e.target.value)}
            style={{ background: '#0a0a0a', color: '#fff', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '10px 12px' }} />
        )}
        {!account ? (
          <button className="btn btn-primary" onClick={connect}>Connect wallet</button>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>{account}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {balance !== null ? `${Number(formatEther(balance)).toFixed(6)} ${t.chain.nativeCurrency.symbol}` : '…'}
              {targetKey === 'bsc' && !isCompany && ' · This is not the company wallet (0xB342…4035). Switch accounts in your wallet so the company wallet owns the contracts.'}
            </div>
          </div>
        )}
      </div>

      <ol className="glass" style={{ padding: '16px 20px 16px 40px', borderRadius: 20, display: 'grid', gap: 8, marginBottom: 20 }}>
        {STEPS.map((s) => (
          <li key={s.id} style={{ color: progress[s.id] ? '#fff' : 'rgba(255,255,255,0.55)' }}>
            {progress[s.id] ? '✓ ' : ''}{s.label}
            {progress[s.id] && t.explorer && (
              <a href={`${t.explorer}/${progress[s.id].length === 42 ? 'address' : 'tx'}/${progress[s.id]}`} target="_blank" rel="noreferrer"
                className="mono muted" style={{ fontSize: 12, marginLeft: 8 }}>{progress[s.id].slice(0, 10)}…</a>
            )}
          </li>
        ))}
      </ol>

      {!allDone && (
        <button className="btn btn-primary" disabled={!account || busy || (targetKey === 'bsc' && !isCompany)} onClick={run} style={{ width: '100%' }}>
          {busy ? 'Deploying…' : doneCount ? `Continue (${doneCount}/${STEPS.length} done)` : `Deploy (${STEPS.length} wallet confirmations)`}
        </button>
      )}
      {status && <p style={{ marginTop: 14 }}>{status}</p>}
      {error && <p role="alert" style={{ marginTop: 14, color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 12, padding: 12 }}>{error}</p>}

      {(targetKey === 'bsc' || allDone) && (
        <GoLive
          target={{ chain: t.chain, rpc: t.rpc, gasPrice: t.gasPrice, explorer: t.explorer, apiUrl: targetKey === 'bsc' ? 'https://api.useparlo.xyz' : 'http://127.0.0.1:8090' }}
          account={account}
          company={targetKey === 'bsc' ? COMPANY : (account ?? COMPANY)}
          addrs={targetKey === 'bsc' ? MAINNET : { oracle: getAddress(progress.oracle), vault: getAddress(progress.vault), usdt: getAddress(progress.usdt) }}
        />
      )}

      {allDone && (
        <div className="glass" style={{ padding: 20, borderRadius: 20, marginTop: 20 }}>
          <p style={{ marginBottom: 10 }}><strong>Done.</strong> Copy this and paste it into the chat:</p>
          <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{deploymentJson}</pre>
          <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(deploymentJson)}>Copy</button>
        </div>
      )}
    </main>
  )
}
