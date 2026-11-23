import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from 'wagmi'
import { BaseError, UserRejectedRequestError, parseUnits, type Address, type Hex, type PublicClient } from 'viem'
import { API_URL } from '../lib/api'
import { CONTRACTS_CONFIGURED, ORACLE_ADDRESS, POOL_ADDRESS, POOL_DEPLOY_BLOCK, USDT_ADDRESS } from '../lib/contracts'
import { TARGET_CHAIN } from '../lib/wagmi'
import {
  SHIELDED_ACCOUNT_MESSAGE, STEP, ShieldedScanner, closePosition, erc20Abi, keypairFromPrivKey, keypairFromSignature,
  openPosition, positionStatus, prepareDeposit, waitForCommitment, waitForSuccess, withdraw,
  type Keypair, type OpenParams, type OwnedPosition, type PositionStatus, type ScanResult, type ZkContext,
} from '../lib/zk'

export type BusyKind = 'deposit' | 'withdraw' | 'open' | 'close' | 'mint' | 'unlock'

const SESSION_KEY = 'parlo.shielded.v1'
const zkBase = ((import.meta.env.VITE_ZK_BASE as string | undefined) ?? '/zk').replace(/\/$/, '')

/** Human-readable message from viem / relayer / wallet errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return 'Request rejected in wallet.'
    return err.shortMessage || err.message
  }
  if (err instanceof Error) return err.message
  return String(err)
}

function loadSessionKey(addr: string): bigint | null {
  try {
    const hex = sessionStorage.getItem(`${SESSION_KEY}.${addr.toLowerCase()}`)
    return hex ? BigInt(hex) : null
  } catch {
    return null
  }
}
function saveSessionKey(addr: string, privKey: bigint) {
  try { sessionStorage.setItem(`${SESSION_KEY}.${addr.toLowerCase()}`, `0x${privKey.toString(16)}`) } catch { /* ignore */ }
}

/**
 * Shielded account: key derivation (session-only), note scanning, and the real deposit / withdraw /
 * open / close flows. Inert when contracts are not configured.
 */
export function useShielded() {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN.id })
  const { signMessageAsync } = useSignMessage()
  const { writeContractAsync } = useWriteContract()

  const ctx = useMemo<ZkContext | null>(() => {
    if (!CONTRACTS_CONFIGURED || !publicClient || !POOL_ADDRESS || !ORACLE_ADDRESS) return null
    return {
      publicClient: publicClient as unknown as PublicClient,
      apiUrl: API_URL || undefined,
      pool: POOL_ADDRESS,
      oracle: ORACLE_ADDRESS,
      fromBlock: POOL_DEPLOY_BLOCK,
      artifacts: (c) => ({ wasm: `${zkBase}/${c}.wasm`, zkey: `${zkBase}/${c}.zkey` }),
    }
  }, [publicClient])

  const [keypair, setKeypair] = useState<Keypair | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, PositionStatus>>({})
  const [busy, setBusy] = useState<BusyKind | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const scannerRef = useRef<ShieldedScanner | null>(null)
  const scanRef = useRef<ScanResult | null>(null)

  // restore / reset the session key when the wallet changes
  useEffect(() => {
    let alive = true
    setKeypair(null)
    setScan(null)
    scanRef.current = null
    setStatuses({})
    scannerRef.current = null
    if (!address || !ctx) return
    const pk = loadSessionKey(address)
    if (pk !== null) keypairFromPrivKey(pk).then((k) => alive && setKeypair(k))
    return () => { alive = false }
  }, [address, ctx])

  useEffect(() => {
    scannerRef.current = ctx && keypair ? new ShieldedScanner(ctx, keypair) : null
  }, [ctx, keypair])

  const refresh = useCallback(async (): Promise<ScanResult | null> => {
    const scanner = scannerRef.current
    if (!scanner) return null
    setScanning(true)
    try {
      const r = await scanner.scan()
      if (scannerRef.current !== scanner) return null
      scanRef.current = r
      setScan(r)
      setScanError(r.noteRootKnown && r.positionRootKnown ? null : 'Local Merkle tree does not match a recent on-chain root yet; retrying…')
      return r
    } catch (err) {
      setScanError(`Scan failed: ${errorMessage(err)}`)
      return null
    } finally {
      setScanning(false)
    }
  }, [])

  // initial scan + periodic refresh
  useEffect(() => {
    if (!ctx || !keypair) return
    void refresh()
    const t = setInterval(() => { void refresh() }, 15_000)
    return () => clearInterval(t)
  }, [ctx, keypair, refresh])

  // position status (entry, live PnL, closability) every 5s
  useEffect(() => {
    if (!ctx || !scan?.positions.length) { setStatuses({}); return }
    let alive = true
    const load = async () => {
      const entries = await Promise.all(
        scan.positions.map(async (p) => [p.commitment.toString(), await positionStatus(ctx, p).catch(() => null)] as const),
      )
      if (!alive) return
      setStatuses(Object.fromEntries(entries.filter((e): e is readonly [string, PositionStatus] => !!e[1])))
    }
    void load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [ctx, scan])

  const unlock = useCallback(async (): Promise<Keypair | null> => {
    if (keypair) return keypair
    if (!address) return null
    setBusy('unlock')
    try {
      const sig = await signMessageAsync({ message: SHIELDED_ACCOUNT_MESSAGE })
      const k = await keypairFromSignature(sig)
      saveSessionKey(address, k.privKey)
      setKeypair(k)
      return k
    } finally {
      setBusy(null)
    }
  }, [address, keypair, signMessageAsync])

  /** Run a flow with busy/step state; resolves with its result. Errors propagate (caller shows them). */
  const run = useCallback(async <T,>(kind: BusyKind, fn: (k: Keypair, s: ScanResult, z: ZkContext) => Promise<T>): Promise<T> => {
    if (!ctx) throw new Error('Contracts not configured')
    const k = keypair ?? (await unlock())
    if (!k) throw new Error('Shielded account locked')
    setBusy(kind)
    setStep(null)
    try {
      const s = scanRef.current ?? (await refresh())
      if (!s) throw new Error('Shielded balance not loaded yet')
      const out = await fn(k, s, ctx)
      setStep(STEP.done)
      return out
    } finally {
      setBusy(null)
      setTimeout(() => setStep((cur) => (cur === STEP.done ? null : cur)), 2500)
    }
  }, [ctx, keypair, unlock, refresh])

  const afterTx = useCallback(async (z: ZkContext, kind: 'notes' | 'positions', commitment: bigint) => {
    setStep(STEP.index)
    await waitForCommitment(z, kind, commitment).catch(() => undefined)
    await refresh()
  }, [refresh])

  const deposit = useCallback((amount: bigint) => run('deposit', async (k, s, z) => {
    if (!address) throw new Error('Connect a wallet')
    const allowance = await z.publicClient.readContract({ address: USDT_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [address, z.pool] })
    if (allowance < amount) {
      setStep('Approve USDT in your wallet…')
      const h = await writeContractAsync({ address: USDT_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [z.pool, amount], chainId: TARGET_CHAIN.id })
      setStep(STEP.mining)
      await waitForSuccess(z, h)
    }
    const { request, commitment } = await prepareDeposit(z, k, s, amount, setStep)
    setStep(STEP.wallet)
    const hash = await writeContractAsync({ ...request, chainId: TARGET_CHAIN.id })
    setStep(STEP.mining)
    await waitForSuccess(z, hash)
    await afterTx(z, 'notes', commitment)
    return hash
  }), [address, run, writeContractAsync, afterTx])

  const doWithdraw = useCallback((amount: bigint, recipient: Address) => run('withdraw', async (k, s, z) => {
    const { txHash, changeCommitment } = await withdraw(z, k, s, amount, recipient, setStep)
    await afterTx(z, 'notes', changeCommitment)
    return txHash
  }), [run, afterTx])

  const open = useCallback((params: OpenParams) => run('open', async (k, s, z) => {
    const r = await openPosition(z, k, s, params, setStep)
    await afterTx(z, 'positions', r.positionCommitment)
    return r.txHash
  }), [run, afterTx])

  const close = useCallback((pos: OwnedPosition) => run('close', async (k, s, z) => {
    const r = await closePosition(z, k, s, pos, setStep)
    await afterTx(z, 'notes', r.outCommitment)
    return r
  }), [run, afterTx])

  const mintTestUsdt = useCallback(async (): Promise<Hex> => {
    if (!ctx || !address) throw new Error('Connect a wallet')
    setBusy('mint')
    try {
      const h = await writeContractAsync({ address: USDT_ADDRESS, abi: erc20Abi, functionName: 'mint', args: [address, parseUnits('10000', 18)], chainId: TARGET_CHAIN.id })
      await waitForSuccess(ctx, h)
      return h
    } finally {
      setBusy(null)
    }
  }, [ctx, address, writeContractAsync])

  return {
    enabled: !!ctx,
    ctx,
    keypair,
    unlocked: !!keypair,
    scan,
    scanning,
    scanError,
    statuses,
    busy,
    step,
    unlock,
    refresh,
    deposit,
    withdraw: doWithdraw,
    open,
    close,
    mintTestUsdt,
  }
}
