// Port of circuits/js/prover.mjs. snarkjs is imported lazily (large).
export type CircuitName = 'transact' | 'open' | 'close'

export type Groth16Proof = {
  pi_a: string[]
  pi_b: string[][]
  pi_c: string[]
}

/** wasm/zkey: file path (Node) or URL (browser). */
export type ArtifactResolver = (circuit: CircuitName) => { wasm: string; zkey: string }

export async function prove(input: Record<string, unknown>, wasm: string, zkey: string) {
  const snarkjs = await import('snarkjs')
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey)
  return { proof: proof as Groth16Proof, publicSignals: publicSignals.map(String) }
}

export type SolidityProof = { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] }

/**
 * Argument order of the generated Solidity verifier. NOTE: the G2 point b has its Fp2 coordinates
 * swapped ([x1, x0], [y1, y0]).
 */
export function toSolidityProof(proof: Groth16Proof): SolidityProof {
  return {
    a: [String(proof.pi_a[0]), String(proof.pi_a[1])],
    b: [
      [String(proof.pi_b[0][1]), String(proof.pi_b[0][0])],
      [String(proof.pi_b[1][1]), String(proof.pi_b[1][0])],
    ],
    c: [String(proof.pi_c[0]), String(proof.pi_c[1])],
  }
}

export const proofToContract = (p: SolidityProof) => ({
  a: p.a.map(BigInt) as [bigint, bigint],
  b: p.b.map((r) => r.map(BigInt)) as [[bigint, bigint], [bigint, bigint]],
  c: p.c.map(BigInt) as [bigint, bigint],
})
