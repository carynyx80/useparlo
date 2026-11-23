// Field + Poseidon primitives shared by all helpers. ES module, Node + browser.
import { buildPoseidon } from "circomlibjs";

export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const MAX_AMOUNT = (1n << 128n) - 1n;

let poseidonInstance = null;
let poseidonPromise = null;

/** Must be awaited once before calling any synchronous hash helper. */
export async function initPoseidon() {
  if (poseidonInstance) return poseidonInstance;
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  poseidonInstance = await poseidonPromise;
  return poseidonInstance;
}

/** Poseidon over field elements -> bigint. Requires initPoseidon(). */
export function poseidon(inputs) {
  if (!poseidonInstance) throw new Error("call await initPoseidon() first");
  const p = poseidonInstance;
  return p.F.toObject(p(inputs.map((x) => BigInt(x))));
}

/** Reduce any integer (bigint/number/decimal or hex string) into [0, p). */
export function toField(x) {
  const v = BigInt(x) % FIELD_SIZE;
  return v < 0n ? v + FIELD_SIZE : v;
}

/** Uniformly random field element (31 random bytes, always < p). */
export function randomField() {
  const bytes = new Uint8Array(31);
  globalThis.crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** publicAmount = (extAmount - fee) mod p   (extAmount < 0 for withdrawals). */
export function toPublicAmount(extAmount, fee = 0n) {
  return toField(BigInt(extAmount) - BigInt(fee));
}

export function assertAmount(x, name = "amount") {
  const v = BigInt(x);
  if (v < 0n || v > MAX_AMOUNT) throw new Error(`${name} out of 128-bit range: ${v}`);
  return v;
}
