import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

export const CIRCUITS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BUILD = path.join(CIRCUITS_DIR, "build");

export const art = (c) => ({
  wasm: path.join(BUILD, `${c}_js`, `${c}.wasm`),
  zkey: path.join(BUILD, `${c}.zkey`),
  vkey: JSON.parse(readFileSync(path.join(BUILD, `${c}_vkey.json`), "utf8")),
});

/** fullProve + verify; returns { proof, publicSignals, ms }. */
export async function proveAndVerify(circuit, input) {
  const a = art(circuit);
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, a.wasm, a.zkey);
  const ms = performance.now() - t0;
  const ok = await snarkjs.groth16.verify(a.vkey, publicSignals, proof);
  assert.equal(ok, true, `${circuit}: proof did not verify`);
  return { proof, publicSignals, ms };
}

/** Witness generation must fail (constraint / assert violation). */
export async function expectWitnessFail(circuit, input, label = "") {
  const a = art(circuit);
  let failed = false;
  try {
    await snarkjs.wtns.calculate(input, a.wasm, { type: "mem" });
  } catch (e) {
    failed = true;
  }
  assert.equal(failed, true, `${circuit}: expected witness failure ${label}`);
}

export async function verifyRaw(circuit, publicSignals, proof) {
  return snarkjs.groth16.verify(art(circuit).vkey, publicSignals, proof);
}

export async function shutdown() {
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const E18 = 10n ** 18n;
