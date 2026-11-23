import { poseidon, randomField, toField, assertAmount } from "./field.mjs";

/** Balance note commitment = Poseidon(amount, pubKey, blinding) */
export function noteCommitment({ amount, pubKey, blinding }) {
  return poseidon([assertAmount(amount), toField(pubKey), toField(blinding)]);
}

/** Balance note nullifier = Poseidon(commitment, privKey) */
export function noteNullifier(commitment, privKey) {
  return poseidon([toField(commitment), toField(privKey)]);
}

/** Position commitment = Poseidon(marketId, isLong, margin, leverage, entryEpoch, pubKey, blinding) */
export function positionCommitment({ marketId, isLong, margin, leverage, entryEpoch, pubKey, blinding }) {
  return poseidon([
    toField(marketId),
    isLong ? 1n : 0n,
    assertAmount(margin, "margin"),
    BigInt(leverage),
    toField(entryEpoch),
    toField(pubKey),
    toField(blinding),
  ]);
}

/** Position nullifier = Poseidon(positionCommitment, privKey) */
export function positionNullifier(commitment, privKey) {
  return poseidon([toField(commitment), toField(privKey)]);
}

export function newNote(amount, pubKey, blinding = randomField()) {
  const note = { amount: BigInt(amount), pubKey: toField(pubKey), blinding: toField(blinding) };
  note.commitment = noteCommitment(note);
  return note;
}

export function newPosition({ marketId, isLong, margin, leverage, entryEpoch, pubKey, blinding = randomField() }) {
  const pos = {
    marketId: BigInt(marketId),
    isLong: isLong ? 1n : 0n,
    margin: BigInt(margin),
    leverage: BigInt(leverage),
    entryEpoch: BigInt(entryEpoch),
    pubKey: toField(pubKey),
    blinding: toField(blinding),
  };
  pos.commitment = positionCommitment(pos);
  return pos;
}
