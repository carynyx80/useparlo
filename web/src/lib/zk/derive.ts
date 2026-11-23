// Deterministic blindings for outputs of open / close. Their ciphertexts are not bound by any proof
// (a relayer could garble or drop them), so these notes must be recoverable from chain data + privKey alone.
import { poseidon, toField } from './field.ts'

export const BLINDING_TAG = { openChange: 1n, openPosition: 2n, closePayout: 3n } as const

/** open: changeBlinding = Poseidon(privKey, inNullifier, 1); positionBlinding = Poseidon(privKey, inNullifier, 2) */
export function openBlindings(privKey: bigint, inNullifier: bigint) {
  return {
    change: poseidon([toField(privKey), toField(inNullifier), BLINDING_TAG.openChange]),
    position: poseidon([toField(privKey), toField(inNullifier), BLINDING_TAG.openPosition]),
  }
}

/** close: payoutBlinding = Poseidon(privKey, positionNullifier, 3) */
export function closeBlinding(privKey: bigint, positionNullifier: bigint): bigint {
  return poseidon([toField(privKey), toField(positionNullifier), BLINDING_TAG.closePayout])
}
