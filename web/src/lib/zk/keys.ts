// Port of circuits/js/keys.mjs + extdata.mjs#privKeyFromSignature (viem instead of ethers).
import { keccak256, type Hex } from 'viem'
import { initPoseidon, poseidon, toField } from './field.ts'

export const SHIELDED_ACCOUNT_MESSAGE = 'Parlo shielded account v1'

/** pubKey = Poseidon(privKey) */
export function derivePubKey(privKey: bigint): bigint {
  return poseidon([toField(privKey)])
}

/** privKey = keccak256(signature) mod p */
export function privKeyFromSignature(signatureHex: Hex): bigint {
  return toField(BigInt(keccak256(signatureHex)))
}

export type Keypair = { privKey: bigint; pubKey: bigint }

export async function keypairFromPrivKey(privKey: bigint): Promise<Keypair> {
  await initPoseidon()
  const k = toField(privKey)
  return { privKey: k, pubKey: derivePubKey(k) }
}

export async function keypairFromSignature(signatureHex: Hex): Promise<Keypair> {
  return keypairFromPrivKey(privKeyFromSignature(signatureHex))
}
