import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { BaseError, ContractFunctionRevertedError, encodeAbiParameters, isAddress, isHex, keccak256, type Hex } from "viem";
import { z } from "zod";
import { ORACLE_ABI, poolAbi } from "./abi.js";
import { Mutex, publicClient, walletFor } from "./chain.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const FIELD_P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type Circuit = "transact" | "open" | "close";
export const N_PUBLIC: Record<Circuit, number> = { transact: 7, open: 7, close: 56 };

// ---------- request schema ----------
const fieldStr = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((v, ctx) => {
    try {
      const b = BigInt(v);
      if (b < 0n || b >= FIELD_P) throw new Error("out of field");
      return b;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a field element (decimal or 0x hex) < p" });
      return z.NEVER;
    }
  });

const pair = z.tuple([fieldStr, fieldStr]);
/** Solidity calldata order (as from snarkjs exportSolidityCallData): b is [[x1,x0],[y1,y0]]. */
const SolidityProof = z.object({ a: pair, b: z.tuple([pair, pair]), c: pair });
/** Raw snarkjs proof object. */
const SnarkjsProof = z.object({
  pi_a: z.array(fieldStr).min(2),
  pi_b: z.array(z.array(fieldStr).min(2)).min(2),
  pi_c: z.array(fieldStr).min(2),
});

const hexBytes = z.string().refine((v) => isHex(v), "must be 0x hex").default("0x");
const addr = z.string().refine((v) => isAddress(v), "must be an address");
const signedInt = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return BigInt(v);
  } catch {
    ctx.addIssue({ code: "custom", message: "must be an integer" });
    return z.NEVER;
  }
});

export const RelayBody = z.object({
  proof: z.union([SolidityProof, SnarkjsProof]),
  publicSignals: z.array(fieldStr).min(1).max(64),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export type RelayBodyT = z.infer<typeof RelayBody>;

const TransactExt = z.object({
  recipient: addr,
  extAmount: signedInt,
  relayer: addr,
  fee: signedInt.refine((v) => v >= 0n, "fee must be >= 0"),
  encryptedOutput0: hexBytes,
  encryptedOutput1: hexBytes,
});
const OpenExt = z.object({ encryptedChange: hexBytes, encryptedPosition: hexBytes }).default({ encryptedChange: "0x", encryptedPosition: "0x" });
const CloseExt = z.object({ encryptedOutput: hexBytes }).default({ encryptedOutput: "0x" });

export class RelayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------- verification keys ----------
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function vkeyCandidates(c: Circuit): string[] {
  const dirs = [config.VKEY_DIR, path.join(serverRoot, "vkeys"), path.join(serverRoot, "..", "circuits", "build")].filter(
    (d): d is string => !!d,
  );
  return dirs.flatMap((d) => [
    path.join(d, `${c}_vkey.json`),
    path.join(d, `${c}.vkey.json`),
    path.join(d, `${c}_verification_key.json`),
    path.join(d, c, "verification_key.json"),
  ]);
}

const vkeys = new Map<Circuit, { vk: { nPublic: number }; file: string }>();
export function loadVkeys(): Record<Circuit, string | null> {
  const out = {} as Record<Circuit, string | null>;
  for (const c of Object.keys(N_PUBLIC) as Circuit[]) {
    const file = vkeyCandidates(c).find((f) => existsSync(f));
    if (!file) {
      out[c] = null;
      continue;
    }
    try {
      const vk = JSON.parse(readFileSync(file, "utf8"));
      if (vk.nPublic !== N_PUBLIC[c]) {
        logger.error({ circuit: c, file, nPublic: vk.nPublic, expected: N_PUBLIC[c] }, "vkey nPublic mismatch; ignoring");
        out[c] = null;
        continue;
      }
      vkeys.set(c, { vk, file });
      out[c] = file;
    } catch (err) {
      logger.error({ circuit: c, file, err: String(err) }, "failed to parse vkey");
      out[c] = null;
    }
  }
  return out;
}

// ---------- relayer ----------
function toSnarkjsProof(p: RelayBodyT["proof"]) {
  const s = (x: bigint) => x.toString();
  if ("a" in p) {
    return {
      pi_a: [s(p.a[0]), s(p.a[1]), "1"],
      pi_b: [
        [s(p.b[0][1]), s(p.b[0][0])],
        [s(p.b[1][1]), s(p.b[1][0])],
        ["1", "0"],
      ],
      pi_c: [s(p.c[0]), s(p.c[1]), "1"],
      protocol: "groth16",
      curve: "bn128",
    };
  }
  return {
    pi_a: [s(p.pi_a[0]), s(p.pi_a[1]), "1"],
    pi_b: [
      [s(p.pi_b[0][0]), s(p.pi_b[0][1])],
      [s(p.pi_b[1][0]), s(p.pi_b[1][1])],
      ["1", "0"],
    ],
    pi_c: [s(p.pi_c[0]), s(p.pi_c[1]), "1"],
    protocol: "groth16",
    curve: "bn128",
  };
}

function toSolidityProof(p: RelayBodyT["proof"]) {
  if ("a" in p) return { a: p.a, b: p.b, c: p.c };
  return {
    a: [p.pi_a[0], p.pi_a[1]] as const,
    b: [
      [p.pi_b[0][1], p.pi_b[0][0]],
      [p.pi_b[1][1], p.pi_b[1][0]],
    ] as const,
    c: [p.pi_c[0], p.pi_c[1]] as const,
  };
}

export function extDataHash(e: z.infer<typeof TransactExt>): bigint {
  const enc = encodeAbiParameters(
    [{ type: "address" }, { type: "int256" }, { type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes" }],
    [e.recipient as Hex, e.extAmount, e.relayer as Hex, e.fee, e.encryptedOutput0 as Hex, e.encryptedOutput1 as Hex],
  );
  return BigInt(keccak256(enc)) % FIELD_P;
}

export class Relayer {
  readonly configured = !!(config.RELAYER_PRIVATE_KEY && config.POOL_ADDRESS);
  private signer = config.RELAYER_PRIVATE_KEY ? walletFor(config.RELAYER_PRIVATE_KEY) : undefined;
  private mutex = new Mutex();

  get address(): string | undefined {
    return this.signer?.account.address;
  }

  /** closes[16] ++ lows[16] ++ highs[16] for the position window, from the oracle. */
  private async oracleWindow(marketId: bigint, entryEpoch: bigint): Promise<bigint[]> {
    if (!config.ORACLE_ADDRESS) throw new RelayError(503, "ORACLE_ADDRESS not configured (needed to verify close proofs)");
    try {
      const [closes, lows, highs] = (await publicClient.readContract({
        address: config.ORACLE_ADDRESS as Hex,
        abi: ORACLE_ABI,
        functionName: "getWindow",
        args: [marketId, entryEpoch],
      })) as readonly [readonly bigint[], readonly bigint[], readonly bigint[]];
      return [...closes, ...lows, ...highs];
    } catch (err) {
      throw new RelayError(502, `oracle.getWindow failed: ${err instanceof BaseError ? err.shortMessage : String(err)}`);
    }
  }

  async relay(circuit: Circuit, body: RelayBodyT): Promise<{ txHash: Hex }> {
    if (!this.configured || !this.signer) throw new RelayError(503, "relayer not configured");
    const vk = vkeys.get(circuit);
    if (!vk) throw new RelayError(503, `verification key for ${circuit} not available`);
    const n = N_PUBLIC[circuit];
    let pub = body.publicSignals;
    // close: clients may send the 8 head signals or all 56; the 48 window values are always
    // rebuilt from oracle.getWindow (same source the contract uses).
    if (circuit === "close") {
      if (pub.length !== 8 && pub.length !== n) throw new RelayError(400, `expected 8 or ${n} public signals, got ${pub.length}`);
      pub = [...pub.slice(0, 8), ...(await this.oracleWindow(pub[3], pub[5]))];
    } else if (pub.length !== n) {
      throw new RelayError(400, `expected ${n} public signals, got ${pub.length}`);
    }

    let args: unknown[];
    const proof = toSolidityProof(body.proof);
    if (circuit === "transact") {
      const parsed = TransactExt.safeParse(body.ext ?? {});
      if (!parsed.success) throw new RelayError(400, `invalid ext: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      const ext = parsed.data;
      if (extDataHash(ext) !== pub[2]) throw new RelayError(400, "extDataHash does not match publicSignals[2]");
      if (config.MIN_RELAYER_FEE > 0n) {
        if (ext.relayer.toLowerCase() !== this.signer.account.address.toLowerCase())
          throw new RelayError(400, `ext.relayer must be ${this.signer.account.address}`);
        if (ext.fee < config.MIN_RELAYER_FEE) throw new RelayError(400, `fee below minimum ${config.MIN_RELAYER_FEE}`);
      }
      const txArgs = {
        root: pub[0],
        publicAmount: pub[1],
        extDataHash: pub[2],
        inputNullifiers: [pub[3], pub[4]],
        outputCommitments: [pub[5], pub[6]],
      };
      args = [proof, txArgs, ext];
    } else if (circuit === "open") {
      const parsed = OpenExt.safeParse(body.ext);
      if (!parsed.success) throw new RelayError(400, "invalid ext for open");
      const openArgs = {
        root: pub[0],
        inNullifier: pub[1],
        changeCommitment: pub[2],
        positionCommitment: pub[3],
        marketId: pub[4],
        margin: pub[5],
        epoch: pub[6],
      };
      args = [proof, openArgs, parsed.data.encryptedChange, parsed.data.encryptedPosition];
    } else {
      const parsed = CloseExt.safeParse(body.ext);
      if (!parsed.success) throw new RelayError(400, "invalid ext for close");
      const closeArgs = {
        positionRoot: pub[0],
        positionNullifier: pub[1],
        outCommitment: pub[2],
        marketId: pub[3],
        margin: pub[4],
        entryEpoch: pub[5],
        closeOffset: pub[6],
        payout: pub[7],
      };
      args = [proof, closeArgs, parsed.data.encryptedOutput];
    }

    const ok = await snarkjs.groth16.verify(vk.vk, pub.map((x) => x.toString()), toSnarkjsProof(body.proof));
    if (!ok) throw new RelayError(400, "invalid proof");

    const functionName = circuit === "transact" ? "transact" : circuit === "open" ? "openPosition" : "closePosition";
    return this.mutex.run(async () => {
      try {
        const { request } = await publicClient.simulateContract({
          account: this.signer!.account,
          address: config.POOL_ADDRESS as Hex,
          abi: poolAbi,
          functionName,
          args,
        });
        const txHash = await this.signer!.wallet.writeContract(request);
        logger.info({ circuit, txHash }, "relayed transaction");
        return { txHash };
      } catch (err) {
        if (err instanceof BaseError) {
          const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
          if (revert instanceof ContractFunctionRevertedError) {
            throw new RelayError(422, `simulation reverted: ${revert.reason ?? revert.data?.errorName ?? revert.shortMessage}`);
          }
          logger.warn({ circuit, err: err.shortMessage }, "relay failed");
          throw new RelayError(502, err.shortMessage);
        }
        throw err;
      }
    });
  }
}
