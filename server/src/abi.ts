import type { Abi } from "viem";
import oracleAbiJson from "./abi/AttentionOracle.json" with { type: "json" };
import poolAbiJson from "./abi/ParloPool.json" with { type: "json" };

/**
 * Contract ABIs copied from contracts/abi/*.json (kept inside server/ so the Docker build is
 * self-contained). Re-copy them whenever the contracts change:
 *   cp ../contracts/abi/ParloPool.json ../contracts/abi/AttentionOracle.json src/abi/
 */
export const poolAbi = poolAbiJson as unknown as Abi;
export const ORACLE_ABI = oracleAbiJson as unknown as Abi;
