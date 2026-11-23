// Port of circuits/js/note.mjs
import { assertAmount, poseidon, toField } from './field.ts'

export type NoteData = { amount: bigint; pubKey: bigint; blinding: bigint }
export type PositionData = {
  marketId: bigint
  isLong: bigint | boolean | number
  margin: bigint
  leverage: bigint
  entryEpoch: bigint
  pubKey: bigint
  blinding: bigint
}

/** Balance note commitment = Poseidon(amount, pubKey, blinding) */
export function noteCommitment({ amount, pubKey, blinding }: NoteData): bigint {
  return poseidon([assertAmount(amount), toField(pubKey), toField(blinding)])
}

/** Balance note nullifier = Poseidon(commitment, privKey) */
export function noteNullifier(commitment: bigint, privKey: bigint): bigint {
  return poseidon([toField(commitment), toField(privKey)])
}

/** Position commitment = Poseidon(marketId, isLong, margin, leverage, entryEpoch, pubKey, blinding) */
export function positionCommitment(p: PositionData): bigint {
  return poseidon([
    toField(p.marketId),
    p.isLong ? 1n : 0n, // 0n / 0 / false are all falsy
    assertAmount(p.margin, 'margin'),
    BigInt(p.leverage),
    toField(p.entryEpoch),
    toField(p.pubKey),
    toField(p.blinding),
  ])
}

/** Position nullifier = Poseidon(positionCommitment, privKey) */
export function positionNullifier(commitment: bigint, privKey: bigint): bigint {
  return poseidon([toField(commitment), toField(privKey)])
}
