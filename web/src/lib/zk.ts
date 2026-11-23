/**
 * Parlo ZK interface.
 *
 * - Shielded key: privKey = keccak256(signature("Parlo shielded account v1")) mod p (BN254 scalar field).
 * - Proofs: snarkjs.groth16.fullProve with /zk/<circuit>.wasm and /zk/<circuit>_final.zkey
 *   (falls back to /zk/<circuit>.zkey) served from web/public/zk/.
 *
 * Poseidon hashing (pubKey, commitments, nullifiers) is computed inside the circuits / via circomlibjs;
 * the witness builders that produce `CircuitInput` for each circuit live with the note-scanning code.
 */
import { keccak256, type Hex } from 'viem'

export const SHIELDED_SIGN_MESSAGE = 'Parlo shielded account v1'

/** BN254 scalar field modulus. */
export const FIELD_P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

export type CircuitName = 'transact' | 'open' | 'close'

export type ShieldedKey = { privKey: bigint; privKeyHex: Hex }

export type Groth16Proof = {
  pi_a: [string, string, string]
  pi_b: [[string, string], [string, string], [string, string]]
  pi_c: [string, string, string]
  protocol: 'groth16'
  curve: 'bn128'
}

export type ProofResult = { proof: Groth16Proof; publicSignals: string[] }

/** Solidity calldata form (a, b, c) for Groth16 verifiers. Note b's inner pairs are swapped. */
export type SolidityProof = {
  a: [bigint, bigint]
  b: [[bigint, bigint], [bigint, bigint]]
  c: [bigint, bigint]
  publicSignals: bigint[]
}

export type CircuitInput = Record<string, string | bigint | number | Array<string | bigint | number | Array<string | bigint | number>>>

type SignMessage = (args: { message: string }) => Promise<Hex>

/** Derive the shielded private key from a deterministic wallet signature. */
export async function deriveShieldedKey(signMessageAsync: SignMessage): Promise<ShieldedKey> {
  const sig = await signMessageAsync({ message: SHIELDED_SIGN_MESSAGE })
  const privKey = BigInt(keccak256(sig)) % FIELD_P
  return { privKey, privKeyHex: `0x${privKey.toString(16).padStart(64, '0')}` as Hex }
}

const SESSION_KEY = 'parlo.shielded.v1'
/** Session-only cache so the user isn't asked to sign on every reload. Never persisted to localStorage. */
export function cacheShieldedKey(addr: string, k: ShieldedKey) {
  try { sessionStorage.setItem(`${SESSION_KEY}.${addr.toLowerCase()}`, k.privKeyHex) } catch { /* ignore */ }
}
export function loadShieldedKey(addr: string): ShieldedKey | null {
  try {
    const hex = sessionStorage.getItem(`${SESSION_KEY}.${addr.toLowerCase()}`) as Hex | null
    return hex ? { privKey: BigInt(hex), privKeyHex: hex } : null
  } catch { return null }
}

export function circuitArtifacts(circuit: CircuitName) {
  const base = (import.meta.env.VITE_ZK_BASE as string | undefined) ?? '/zk'
  return { wasm: `${base}/${circuit}.wasm`, zkey: `${base}/${circuit}.zkey` }
}

/** Returns true when the proving artifacts for a circuit are actually being served. */
export async function circuitAvailable(circuit: CircuitName): Promise<boolean> {
  const { wasm, zkey } = circuitArtifacts(circuit)
  try {
    const [a, b] = await Promise.all([fetch(wasm, { method: 'HEAD' }), fetch(zkey, { method: 'HEAD' })])
    const okType = (r: Response) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')
    return okType(a) && okType(b)
  } catch {
    return false
  }
}

/** Generate a Groth16 proof in the browser. snarkjs is loaded lazily (large bundle). */
export async function generateProof(circuit: CircuitName, input: CircuitInput): Promise<ProofResult> {
  const snarkjs = await import('snarkjs')
  const { wasm, zkey } = circuitArtifacts(circuit)
  const norm = JSON.parse(JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(norm, wasm, zkey)
  return { proof: proof as unknown as Groth16Proof, publicSignals: publicSignals as string[] }
}

export function toSolidityProof({ proof, publicSignals }: ProofResult): SolidityProof {
  const b = (x: string) => BigInt(x)
  return {
    a: [b(proof.pi_a[0]), b(proof.pi_a[1])],
    b: [
      [b(proof.pi_b[0][1]), b(proof.pi_b[0][0])],
      [b(proof.pi_b[1][1]), b(proof.pi_b[1][0])],
    ],
    c: [b(proof.pi_c[0]), b(proof.pi_c[1])],
    publicSignals: publicSignals.map(b),
  }
}

/** Random field element for blindings. */
export function randomField(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let x = 0n
  for (const v of bytes) x = (x << 8n) | BigInt(v)
  return x % FIELD_P
}
