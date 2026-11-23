import { poseidon, toField } from "./field.mjs";

/** pubKey = Poseidon(privKey) */
export function derivePubKey(privKey) {
  return poseidon([toField(privKey)]);
}

/**
 * privKey = keccak256(walletSignature("Parlo shielded account v1")) mod p.
 * Pass the keccak256 digest of the signature (hex string, e.g. viem `keccak256(sig)`).
 */
export function privKeyFromSignatureHash(keccakHex) {
  return toField(BigInt(keccakHex));
}

export const SHIELDED_ACCOUNT_MESSAGE = "Parlo shielded account v1";

export class Keypair {
  constructor(privKey) {
    this.privKey = toField(privKey);
    this.pubKey = derivePubKey(this.privKey);
  }
}
