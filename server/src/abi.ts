import { readFileSync } from "node:fs";
import type { Abi } from "viem";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Default ParloPool ABI fragment the server relies on. If the deployed contract differs, point
 * POOL_ABI_PATH at its ABI JSON (a bare ABI array or a Foundry artifact with an `abi` field);
 * function/event names below must still exist: transact, openPosition, closePosition, NewNote, NewPosition.
 */
const PROOF = {
  name: "proof",
  type: "tuple",
  components: [
    { name: "a", type: "uint256[2]" },
    { name: "b", type: "uint256[2][2]" },
    { name: "c", type: "uint256[2]" },
  ],
} as const;

export const DEFAULT_POOL_ABI = [
  {
    type: "function",
    name: "transact",
    stateMutability: "nonpayable",
    inputs: [
      PROOF,
      { name: "pub", type: "uint256[7]" },
      {
        name: "ext",
        type: "tuple",
        components: [
          { name: "recipient", type: "address" },
          { name: "extAmount", type: "int256" },
          { name: "relayer", type: "address" },
          { name: "fee", type: "uint256" },
          { name: "encryptedOutput1", type: "bytes" },
          { name: "encryptedOutput2", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "openPosition",
    stateMutability: "nonpayable",
    inputs: [
      PROOF,
      { name: "pub", type: "uint256[7]" },
      { name: "encryptedChange", type: "bytes" },
      { name: "encryptedPosition", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "closePosition",
    stateMutability: "nonpayable",
    inputs: [PROOF, { name: "pub", type: "uint256[8]" }, { name: "encryptedOutput", type: "bytes" }],
    outputs: [],
  },
  {
    type: "event",
    name: "NewNote",
    anonymous: false,
    inputs: [
      { name: "commitment", type: "bytes32", indexed: false },
      { name: "index", type: "uint256", indexed: false },
      { name: "encryptedOutput", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "NewPosition",
    anonymous: false,
    inputs: [
      { name: "commitment", type: "bytes32", indexed: false },
      { name: "index", type: "uint256", indexed: false },
      { name: "encryptedOutput", type: "bytes", indexed: false },
    ],
  },
] as const satisfies Abi;

function loadPoolAbi(): Abi {
  if (!config.POOL_ABI_PATH) return DEFAULT_POOL_ABI;
  try {
    const json = JSON.parse(readFileSync(config.POOL_ABI_PATH, "utf8"));
    const abi = (Array.isArray(json) ? json : json.abi) as Abi;
    logger.info({ path: config.POOL_ABI_PATH, entries: abi.length }, "loaded pool ABI override");
    return abi;
  } catch (err) {
    logger.error({ err: String(err) }, "failed to load POOL_ABI_PATH; using default ABI");
    return DEFAULT_POOL_ABI;
  }
}

export const poolAbi: Abi = loadPoolAbi();

export const ORACLE_ABI = [
  {
    type: "function",
    name: "push",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getEpoch",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "epoch", type: "uint256" },
    ],
    outputs: [
      { name: "close", type: "uint256" },
      { name: "low", type: "uint256" },
      { name: "high", type: "uint256" },
      { name: "finalized", type: "bool" },
    ],
  },
] as const satisfies Abi;
