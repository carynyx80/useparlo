declare module "snarkjs" {
  export const groth16: {
    verify(vkey: unknown, publicSignals: string[], proof: unknown, logger?: unknown): Promise<boolean>;
  };
}
