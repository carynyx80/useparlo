// Port of circuits/js/field.mjs. Field + Poseidon primitives (Node + browser).
// circomlibjs is loaded lazily so it never lands in the main bundle.

export const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const MAX_AMOUNT = (1n << 128n) - 1n

type PoseidonFn = ((inputs: bigint[]) => unknown) & { F: { toObject(x: unknown): bigint } }

let poseidonInstance: PoseidonFn | null = null
let poseidonPromise: Promise<PoseidonFn> | null = null

/** Must be awaited once before calling any synchronous hash helper. */
export async function initPoseidon(): Promise<PoseidonFn> {
  if (poseidonInstance) return poseidonInstance
  if (!poseidonPromise) {
    poseidonPromise = import('circomlibjs').then((m) => m.buildPoseidon() as Promise<PoseidonFn>)
  }
  poseidonInstance = await poseidonPromise
  return poseidonInstance
}

/** Poseidon over field elements -> bigint. Requires initPoseidon(). */
export function poseidon(inputs: Array<bigint | number | string>): bigint {
  if (!poseidonInstance) throw new Error('call await initPoseidon() first')
  const p = poseidonInstance
  return p.F.toObject(p(inputs.map((x) => BigInt(x))))
}

/** Reduce any integer (bigint/number/decimal or hex string) into [0, p). */
export function toField(x: bigint | number | string): bigint {
  const v = BigInt(x) % FIELD_SIZE
  return v < 0n ? v + FIELD_SIZE : v
}

/** Uniformly random field element (31 random bytes, always < p). */
export function randomField(): bigint {
  const bytes = new Uint8Array(31)
  globalThis.crypto.getRandomValues(bytes)
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v
}

/** publicAmount = (extAmount - fee) mod p   (extAmount < 0 for withdrawals). */
export function toPublicAmount(extAmount: bigint, fee = 0n): bigint {
  return toField(BigInt(extAmount) - BigInt(fee))
}

export function assertAmount(x: bigint | number | string, name = 'amount'): bigint {
  const v = BigInt(x)
  if (v < 0n || v > MAX_AMOUNT) throw new Error(`${name} out of 128-bit range: ${v}`)
  return v
}

export const toHex32 = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}` as `0x${string}`
