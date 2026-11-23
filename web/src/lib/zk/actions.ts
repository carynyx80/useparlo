// High-level private-trading flows shared by the browser app and the Node e2e script.
import { zeroAddress, type Address, type Hex } from 'viem'
import { oracleAbi, poolAbi } from './abi.ts'
import { encryptNote, encryptPosition } from './encryption.ts'
import { extDataHash, type ExtData } from './extdata.ts'
import { randomField } from './field.ts'
import { buildCloseInput, buildOpenInput, buildTransactInput, type CircuitInput } from './inputs.ts'
import type { Keypair } from './keys.ts'
import { computeClose, WINDOW, type CloseResult } from './payout.ts'
import { proofToContract, prove, toSolidityProof, type CircuitName, type SolidityProof } from './prover.ts'
import type { OwnedNote, OwnedPosition, ScanResult, ZkContext } from './scan.ts'

export type StepFn = (message: string) => void

export const STEP = {
  prove: 'Generating zero-knowledge proof… (~2s)',
  wallet: 'Confirm in your wallet…',
  relay: 'Waiting for relayer…',
  mining: 'Waiting for confirmation…',
  index: 'Updating shielded balance…',
  epoch: 'Waiting for the next epoch (entries are epoch-aligned)…',
  done: 'Confirmed',
} as const

/** Seconds of the current epoch that must remain before we start a time-bound (open/close) proof. */
const EPOCH_GUARD_SEC = 5
export const CLOSE_DEADLINE_EPOCHS = 18n

export class RelayError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function proveCircuit(ctx: ZkContext, circuit: CircuitName, input: CircuitInput) {
  const { wasm, zkey } = ctx.artifacts(circuit)
  const { proof, publicSignals } = await prove(input, wasm, zkey)
  return { sol: toSolidityProof(proof), publicSignals }
}

export async function relay(apiUrl: string | undefined, circuit: CircuitName, body: { proof: SolidityProof; publicSignals: string[]; ext?: Record<string, string> }): Promise<Hex> {
  if (!apiUrl) throw new RelayError(0, 'Relayer URL not configured (VITE_API_URL)')
  let res: Response
  try {
    res = await fetch(`${apiUrl.replace(/\/$/, '')}/relay/${circuit}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new RelayError(0, `Relayer unreachable: ${String(err)}`)
  }
  const data = (await res.json().catch(() => ({}))) as { txHash?: Hex; error?: string; issues?: Array<{ path: string; message: string }> }
  if (!res.ok || !data.txHash) {
    const detail = data.issues?.length ? ` (${data.issues.map((i) => `${i.path}: ${i.message}`).join('; ')})` : ''
    throw new RelayError(res.status, `Relayer ${res.status}: ${data.error ?? 'unknown error'}${detail}`)
  }
  return data.txHash
}

export async function waitForSuccess(ctx: ZkContext, hash: Hex) {
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1000 })
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted`)
  return receipt
}

let epochLengthCache: bigint | undefined
export async function epochInfo(ctx: ZkContext) {
  if (epochLengthCache === undefined) {
    epochLengthCache = await ctx.publicClient.readContract({ address: ctx.oracle, abi: oracleAbi, functionName: 'epochLength' })
  }
  const block = await ctx.publicClient.getBlock()
  const len = epochLengthCache
  const ts = block.timestamp
  return { epoch: ts / len, epochLength: len, secondsLeft: Number(len - (ts % len)) - 1, timestamp: ts }
}

/** Wait until at least EPOCH_GUARD_SEC remain in the current epoch. */
async function epochWithRoom(ctx: ZkContext, onStep?: StepFn) {
  for (;;) {
    const e = await epochInfo(ctx)
    if (e.secondsLeft >= EPOCH_GUARD_SEC) return e
    onStep?.(STEP.epoch)
    await sleep((e.secondsLeft + 1.5) * 1000)
  }
}

async function currentEpoch(ctx: ZkContext) {
  return (await epochInfo(ctx)).epoch
}

// ------------------------------------------------------------------ deposit

/**
 * Build a deposit (0 real inputs, outputs [deposit note, zero note], extAmount = +amount, no relayer).
 * Returns the contract call; the depositor's own wallet must send it (the pool pulls USDT from msg.sender).
 */
export async function prepareDeposit(ctx: ZkContext, kp: Keypair, scan: ScanResult, amount: bigint, onStep?: StepFn) {
  if (amount <= 0n) throw new Error('Amount must be positive')
  const b0 = randomField()
  const b1 = randomField()
  const ext: ExtData = {
    recipient: zeroAddress,
    extAmount: amount,
    relayer: zeroAddress,
    fee: 0n,
    encryptedOutput0: await encryptNote(kp.privKey, { amount, blinding: b0 }),
    encryptedOutput1: await encryptNote(kp.privKey, { amount: 0n, blinding: b1 }),
  }
  const built = buildTransactInput({
    privKey: kp.privKey,
    tree: scan.noteTree,
    inputs: [],
    outputs: [{ amount, blinding: b0 }, { amount: 0n, blinding: b1 }],
    extAmount: amount,
    extDataHash: extDataHash(ext),
  })
  onStep?.(STEP.prove)
  const { sol, publicSignals } = await proveCircuit(ctx, 'transact', built.input)
  const ps = publicSignals.map(BigInt)
  const request = {
    address: ctx.pool,
    abi: poolAbi,
    functionName: 'transact' as const,
    args: [
      proofToContract(sol),
      { root: ps[0], publicAmount: ps[1], extDataHash: ps[2], inputNullifiers: [ps[3], ps[4]] as [bigint, bigint], outputCommitments: [ps[5], ps[6]] as [bigint, bigint] },
      ext,
    ] as const,
  }
  return { request, commitment: built.outCommitment[0] }
}

// ------------------------------------------------------------------ withdraw

/** Pick up to 2 notes covering `amount` (smallest single note that covers it, else the two largest). */
export function selectNotes(notes: OwnedNote[], amount: bigint): OwnedNote[] {
  const sorted = [...notes].sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0))
  const single = sorted.find((n) => n.amount >= amount)
  if (single) return [single]
  const top = sorted.slice(-2)
  if (top.length === 2 && top[0].amount + top[1].amount >= amount) return top
  const total = notes.reduce((a, n) => a + n.amount, 0n)
  if (total >= amount) throw new Error('Balance is split across more than 2 notes; withdraw a smaller amount first (max 2 notes per proof).')
  throw new Error('Insufficient shielded balance')
}

export async function withdraw(
  ctx: ZkContext, kp: Keypair, scan: ScanResult, amount: bigint, recipient: Address, onStep?: StepFn,
): Promise<{ txHash: Hex; changeCommitment: bigint }> {
  if (amount <= 0n) throw new Error('Amount must be positive')
  if (!recipient || recipient === zeroAddress) throw new Error('Recipient required')
  const inputs = selectNotes(scan.notes, amount)
  const change = inputs.reduce((a, n) => a + n.amount, 0n) - amount
  const b0 = randomField()
  const b1 = randomField()
  const ext: ExtData = {
    recipient,
    extAmount: -amount,
    relayer: zeroAddress,
    fee: 0n,
    encryptedOutput0: await encryptNote(kp.privKey, { amount: change, blinding: b0 }),
    encryptedOutput1: await encryptNote(kp.privKey, { amount: 0n, blinding: b1 }),
  }
  const built = buildTransactInput({
    privKey: kp.privKey,
    tree: scan.noteTree,
    inputs: inputs.map((n) => ({ amount: n.amount, blinding: n.blinding, index: n.index })),
    outputs: [{ amount: change, blinding: b0 }, { amount: 0n, blinding: b1 }],
    extAmount: -amount,
    extDataHash: extDataHash(ext),
  })
  onStep?.(STEP.prove)
  const { sol, publicSignals } = await proveCircuit(ctx, 'transact', built.input)
  onStep?.(STEP.relay)
  const txHash = await relay(ctx.apiUrl, 'transact', {
    proof: sol,
    publicSignals,
    ext: {
      recipient: ext.recipient,
      extAmount: ext.extAmount.toString(),
      relayer: ext.relayer,
      fee: ext.fee.toString(),
      encryptedOutput0: ext.encryptedOutput0,
      encryptedOutput1: ext.encryptedOutput1,
    },
  })
  onStep?.(STEP.mining)
  await waitForSuccess(ctx, txHash)
  return { txHash, changeCommitment: built.outCommitment[0] }
}

// ------------------------------------------------------------------ open

export type OpenParams = { marketId: number | bigint; isLong: boolean; margin: bigint; leverage: number | bigint }

export async function openPosition(
  ctx: ZkContext, kp: Keypair, scan: ScanResult, params: OpenParams, onStep?: StepFn,
): Promise<{ txHash: Hex; positionCommitment: bigint; changeCommitment: bigint; epoch: bigint }> {
  const { marketId, isLong, margin, leverage } = params
  const L = BigInt(leverage)
  if (L < 1n || L > 20n) throw new Error('Leverage must be 1–20')
  const minMargin = await ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: 'minMargin' })
  if (margin < minMargin) throw new Error(`Minimum margin is ${Number(minMargin) / 1e18} USDT`)
  const note = [...scan.notes].sort((a, b) => (a.amount < b.amount ? -1 : 1)).find((n) => n.amount >= margin)
  if (!note) {
    throw new Error(scan.balance >= margin ? 'No single note covers this margin. Withdraw/redeposit to merge notes, or lower the margin.' : 'Insufficient shielded balance — deposit USDT first.')
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { epoch } = await epochWithRoom(ctx, onStep)
    // mirror the pool's pre-checks so the user gets a clear message instead of a relayer 422
    const [exists, [lastValue, lastEpoch]] = await Promise.all([
      ctx.publicClient.readContract({ address: ctx.oracle, abi: oracleAbi, functionName: 'marketExists', args: [BigInt(marketId)] }),
      ctx.publicClient.readContract({ address: ctx.oracle, abi: oracleAbi, functionName: 'latest', args: [BigInt(marketId)] }),
    ])
    if (!exists) throw new Error(`Market ${marketId} is not listed on-chain`)
    if (lastValue === 0n || lastEpoch + 1n < epoch) {
      throw new Error('The on-chain index for this market is stale (no oracle update in the last epoch). Try again in a moment.')
    }
    const changeBlinding = randomField()
    const positionBlinding = randomField()
    const built = buildOpenInput({
      privKey: kp.privKey, tree: scan.noteTree, note: { amount: note.amount, blinding: note.blinding, index: note.index },
      marketId, margin, epoch, isLong, leverage: L, changeBlinding, positionBlinding,
    })
    const encryptedChange = await encryptNote(kp.privKey, { amount: built.changeNote.amount, blinding: changeBlinding })
    const encryptedPosition = await encryptPosition(kp.privKey, {
      marketId: BigInt(marketId), isLong, margin, leverage: L, entryEpoch: epoch, blinding: positionBlinding,
    })
    onStep?.(STEP.prove)
    const { sol, publicSignals } = await proveCircuit(ctx, 'open', built.input)
    if ((await currentEpoch(ctx)) !== epoch) continue // crossed the boundary while proving: redo for the new epoch
    onStep?.(STEP.relay)
    const txHash = await relay(ctx.apiUrl, 'open', { proof: sol, publicSignals, ext: { encryptedChange, encryptedPosition } })
    onStep?.(STEP.mining)
    await waitForSuccess(ctx, txHash)
    return { txHash, positionCommitment: built.position.commitment, changeCommitment: built.changeNote.commitment, epoch }
  }
  throw new Error('Epoch boundary kept moving while proving; please retry.')
}

// ------------------------------------------------------------------ position status / close

export type PositionStatus = {
  currentEpoch: bigint
  entry: bigint | null // closes[0] once the entry epoch is finalized
  closeOffset: number // pool.latestCloseOffset(entryEpoch); 0 = not closable yet
  deadlineEpoch: bigint // close must be included while currentEpoch < deadlineEpoch
  expired: boolean
  mark: bigint | null // latest pushed index value
  settle: CloseResult | null // exact payout if closed now (finalized window)
  live: CloseResult | null // estimate against the latest (unfinalized) index value
}

export async function positionStatus(ctx: ZkContext, pos: OwnedPosition): Promise<PositionStatus> {
  const [cur, offRaw, window, latest] = await Promise.all([
    ctx.publicClient.readContract({ address: ctx.oracle, abi: oracleAbi, functionName: 'currentEpoch' }),
    ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: 'latestCloseOffset', args: [pos.entryEpoch] }),
    ctx.publicClient.readContract({ address: ctx.oracle, abi: oracleAbi, functionName: 'getWindow', args: [pos.marketId, pos.entryEpoch] }),
    ctx.publicClient.readContract({ address: ctx.oracle, abi: oracleAbi, functionName: 'latest', args: [pos.marketId] }),
  ])
  const [closes, lows, highs] = window.map((a) => [...a])
  const deadlineEpoch = pos.entryEpoch + CLOSE_DEADLINE_EPOCHS
  const closeOffset = Number(offRaw)
  const entry = closes[0] !== 0n ? closes[0] : null
  const mark = latest[0] !== 0n ? latest[0] : null
  const base = { isLong: pos.isLong, margin: pos.margin, leverage: pos.leverage }
  let settle: CloseResult | null = null
  if (entry && closeOffset >= 1 && closes[closeOffset] !== 0n) {
    try { settle = computeClose({ ...base, closeOffset, closes, lows, highs }) } catch { settle = null }
  }
  let live: CloseResult | null = null
  if (entry && mark) {
    // slot right after the last finalized one, filled with the latest index value
    let lastFinal = 0
    while (lastFinal + 1 < WINDOW && closes[lastFinal + 1] !== 0n) lastFinal++
    const s = Math.min(lastFinal + 1, 15)
    const c = [...closes], lo = [...lows], hi = [...highs]
    c[s] = mark
    lo[s] = lo[s] && lo[s] < mark ? lo[s] : mark
    hi[s] = hi[s] > mark ? hi[s] : mark
    try { live = computeClose({ ...base, closeOffset: s, closes: c, lows: lo, highs: hi }) } catch { live = null }
  }
  return { currentEpoch: cur, entry, closeOffset, deadlineEpoch, expired: cur >= deadlineEpoch, mark, settle, live }
}

export async function closePosition(
  ctx: ZkContext, kp: Keypair, scan: ScanResult, pos: OwnedPosition, onStep?: StepFn,
): Promise<{ txHash: Hex; payout: bigint; outCommitment: bigint; knockedOut: boolean; closeOffset: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { epoch } = await epochWithRoom(ctx, onStep)
    if (epoch >= pos.entryEpoch + CLOSE_DEADLINE_EPOCHS) throw new Error('Close deadline passed (entry epoch + 18).')
    const closeOffset = Number(
      await ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: 'latestCloseOffset', args: [pos.entryEpoch] }),
    )
    if (closeOffset < 1) throw new Error('Not closable yet: the entry epoch and at least one later epoch must be finalized.')
    const [closesR, lowsR, highsR] = await ctx.publicClient.readContract({
      address: ctx.oracle, abi: oracleAbi, functionName: 'getWindow', args: [pos.marketId, pos.entryEpoch],
    })
    const outBlinding = randomField()
    const built = buildCloseInput({
      privKey: kp.privKey,
      tree: scan.positionTree,
      position: { marketId: pos.marketId, isLong: pos.isLong, margin: pos.margin, leverage: pos.leverage, entryEpoch: pos.entryEpoch, blinding: pos.blinding, index: pos.index },
      closeOffset,
      closes: [...closesR],
      lows: [...lowsR],
      highs: [...highsR],
      outBlinding,
    })
    const encryptedOutput = await encryptNote(kp.privKey, { amount: built.payout, blinding: outBlinding })
    onStep?.(STEP.prove)
    const { sol, publicSignals } = await proveCircuit(ctx, 'close', built.input)
    // the window (public signals) changes when an epoch finalizes: redo if we crossed a boundary
    if ((await currentEpoch(ctx)) !== epoch) continue
    onStep?.(STEP.relay)
    const txHash = await relay(ctx.apiUrl, 'close', { proof: sol, publicSignals, ext: { encryptedOutput } })
    onStep?.(STEP.mining)
    await waitForSuccess(ctx, txHash)
    return { txHash, payout: built.payout, outCommitment: built.outNote.commitment, knockedOut: built.knockedOut, closeOffset }
  }
  throw new Error('Epoch boundary kept moving while proving; please retry.')
}
