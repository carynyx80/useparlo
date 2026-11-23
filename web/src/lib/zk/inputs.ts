// Port of circuits/js/inputs.mjs. Witness-input builders (decimal strings, as snarkjs expects).
import { assertAmount, randomField, toField, toPublicAmount } from './field.ts'
import { derivePubKey } from './keys.ts'
import type { MerkleTree } from './merkle.ts'
import { noteCommitment, noteNullifier, positionCommitment, positionNullifier } from './note.ts'
import { computeClose, WINDOW } from './payout.ts'

type Nested = string | Nested[]
type Val = bigint | number | string | boolean | Val[]
const str = (v: Val): Nested => (Array.isArray(v) ? v.map(str) : BigInt(v as bigint).toString())
const strObj = (o: Record<string, Val>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, str(v)]))

export type CircuitInput = Record<string, Nested>

export type InNote = { amount: bigint; blinding: bigint; index?: number }
export type OutNote = { amount: bigint; pubKey?: bigint; blinding?: bigint }

export function buildTransactInput(p: {
  privKey: bigint
  tree: MerkleTree
  inputs?: InNote[]
  outputs?: OutNote[]
  extAmount?: bigint
  fee?: bigint
  extDataHash: bigint
}) {
  const { privKey, tree, inputs = [], outputs = [], extAmount = 0n, fee = 0n, extDataHash } = p
  if (inputs.length > 2 || outputs.length > 2) throw new Error('max 2 inputs / 2 outputs')
  if (extDataHash === undefined) throw new Error('extDataHash required')
  const pubKey = derivePubKey(privKey)
  const ins: InNote[] = [...inputs]
  while (ins.length < 2) ins.push({ amount: 0n, blinding: randomField() })
  const outs = outputs.map((o) => ({ amount: BigInt(o.amount), pubKey: o.pubKey ?? pubKey, blinding: o.blinding ?? randomField() }))
  while (outs.length < 2) outs.push({ amount: 0n, pubKey, blinding: randomField() })

  const inAmount: bigint[] = [], inBlinding: bigint[] = [], inPathElements: bigint[][] = [], inPathIndices: bigint[][] = [], inNullifier: bigint[] = []
  for (const n of ins) {
    const amount = assertAmount(n.amount)
    const commitment = noteCommitment({ amount, pubKey, blinding: n.blinding })
    let path
    if (amount === 0n && n.index === undefined) path = tree.emptyPath()
    else {
      const idx = n.index ?? tree.indexOf(commitment)
      if (idx < 0) throw new Error('input note not found in tree')
      path = tree.path(idx)
    }
    inAmount.push(amount)
    inBlinding.push(toField(n.blinding))
    inPathElements.push(path.pathElements)
    inPathIndices.push(path.pathIndices)
    inNullifier.push(noteNullifier(commitment, privKey))
  }
  const outCommitment = outs.map((o) => noteCommitment(o))
  const publicAmount = toPublicAmount(extAmount, fee)
  const sumIn = inAmount.reduce((a, b) => a + b, 0n)
  const sumOut = outs.reduce((a, o) => a + o.amount, 0n)
  if (sumIn + BigInt(extAmount) - BigInt(fee) !== sumOut) throw new Error('amounts do not balance')

  const input: CircuitInput = {
    root: str(tree.root()),
    publicAmount: str(publicAmount),
    extDataHash: str(extDataHash),
    inNullifier: str(inNullifier),
    outCommitment: str(outCommitment),
    privKey: str(toField(privKey)),
    inAmount: str(inAmount),
    inBlinding: str(inBlinding),
    inPathElements: str(inPathElements),
    inPathIndices: str(inPathIndices),
    outAmount: str(outs.map((o) => o.amount)),
    outPubKey: str(outs.map((o) => o.pubKey)),
    outBlinding: str(outs.map((o) => o.blinding)),
  }
  const outNotes = outs.map((o, i) => ({ ...o, commitment: outCommitment[i] }))
  return { input, inNullifier, outCommitment, outNotes, publicAmount }
}

export function buildOpenInput(p: {
  privKey: bigint
  tree: MerkleTree
  note: InNote
  marketId: bigint | number
  margin: bigint
  epoch: bigint | number
  isLong: boolean
  leverage: bigint | number
  changeBlinding?: bigint
  positionBlinding?: bigint
}) {
  const { privKey, tree, note, marketId, margin, epoch, isLong, leverage } = p
  const changeBlinding = p.changeBlinding ?? randomField()
  const positionBlinding = p.positionBlinding ?? randomField()
  const pubKey = derivePubKey(privKey)
  const amount = assertAmount(note.amount)
  const m = assertAmount(margin, 'margin')
  if (m > amount) throw new Error('margin exceeds note amount')
  const L = BigInt(leverage)
  if (L < 1n || L > 20n) throw new Error('leverage must be in [1,20]')
  const commitment = noteCommitment({ amount, pubKey, blinding: note.blinding })
  const idx = note.index ?? tree.indexOf(commitment)
  if (idx < 0) throw new Error('note not found in tree')
  const path = tree.path(idx)
  const inNullifier = noteNullifier(commitment, privKey)
  const changeData = { amount: amount - m, pubKey, blinding: toField(changeBlinding) }
  const change = { ...changeData, commitment: noteCommitment(changeData) }
  const posData = {
    marketId: BigInt(marketId), isLong: isLong ? 1n : 0n, margin: m, leverage: L,
    entryEpoch: BigInt(epoch), pubKey, blinding: toField(positionBlinding),
  }
  const position = { ...posData, commitment: positionCommitment(posData) }

  const input: CircuitInput = strObj({
    root: tree.root(),
    inNullifier,
    changeCommitment: change.commitment,
    positionCommitment: position.commitment,
    marketId: position.marketId,
    margin: m,
    epoch: position.entryEpoch,
    privKey: toField(privKey),
    inAmount: amount,
    inBlinding: toField(note.blinding),
    changeBlinding: change.blinding,
    isLong: position.isLong,
    leverage: L,
    positionBlinding: position.blinding,
  })
  input.pathElements = str(path.pathElements)
  input.pathIndices = str(path.pathIndices)
  return { input, inNullifier, changeNote: change, position }
}

export type PositionIn = {
  marketId: bigint
  isLong: bigint | boolean
  margin: bigint
  leverage: bigint
  entryEpoch: bigint
  blinding: bigint
  index?: number
}

export function buildCloseInput(p: {
  privKey: bigint
  tree: MerkleTree
  position: PositionIn
  closeOffset: number | bigint
  closes: bigint[]
  lows: bigint[]
  highs: bigint[]
  outBlinding?: bigint
}) {
  const { privKey, tree, position, closeOffset, closes, lows, highs } = p
  const outBlinding = p.outBlinding ?? randomField()
  if (closes.length !== WINDOW || lows.length !== WINDOW || highs.length !== WINDOW) throw new Error('need 16 closes/lows/highs')
  const pubKey = derivePubKey(privKey)
  const pos = { ...position, pubKey }
  const commitment = positionCommitment(pos)
  const idx = position.index ?? tree.indexOf(commitment)
  if (idx < 0) throw new Error('position not found in tree')
  const path = tree.path(idx)
  const nullifier = positionNullifier(commitment, privKey)
  const res = computeClose({ ...pos, closeOffset, closes, lows, highs })
  const outData = { amount: res.payout, pubKey, blinding: toField(outBlinding) }
  const outNote = { ...outData, commitment: noteCommitment(outData) }

  const input: CircuitInput = {
    ...strObj({
      positionRoot: tree.root(),
      positionNullifier: nullifier,
      outCommitment: outNote.commitment,
      marketId: pos.marketId,
      margin: pos.margin,
      entryEpoch: pos.entryEpoch,
      closeOffset: BigInt(closeOffset),
      payout: res.payout,
    }),
    closes: str(closes),
    lows: str(lows),
    highs: str(highs),
    privKey: str(toField(privKey)),
    isLong: str(pos.isLong ? 1n : 0n),
    leverage: str(pos.leverage),
    positionBlinding: str(pos.blinding),
    pathElements: str(path.pathElements),
    pathIndices: str(path.pathIndices),
    outBlinding: str(outNote.blinding),
  }
  return { input, positionNullifier: nullifier, outNote, ...res }
}
