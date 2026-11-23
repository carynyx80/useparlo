import * as snarkjs from "snarkjs";

/** Generate a Groth16 proof. wasm/zkey: path (Node) or URL / Uint8Array (browser), e.g. "/zk/close.wasm". */
export async function prove(input, wasm, zkey) {
  return snarkjs.groth16.fullProve(input, wasm, zkey);
}

export async function verify(vkey, publicSignals, proof) {
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

/**
 * Convert a snarkjs proof into the argument order of the generated Solidity verifier:
 * verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[N] pubSignals).
 * NOTE: the G2 point b has its Fp2 coordinates swapped ([x1, x0], [y1, y0]).
 */
export function toSolidityProof(proof, publicSignals) {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]].map(String),
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]].map(String),
      [proof.pi_b[1][1], proof.pi_b[1][0]].map(String),
    ],
    c: [proof.pi_c[0], proof.pi_c[1]].map(String),
    publicSignals: publicSignals.map(String),
  };
}
