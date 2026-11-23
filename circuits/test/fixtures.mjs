// Generates contracts/test/fixtures/{transact,open,close}.json: real Groth16 proofs in Solidity
// verifier argument order, forming one consistent flow:
//   deposit (transact) -> open position (spends deposit note 0) -> close position.
// Usage: node test/fixtures.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { initPoseidon, MerkleTree, Keypair, buildTransactInput, buildOpenInput, buildCloseInput, toSolidityProof } from "../js/index.mjs";
import { extDataHash } from "../js/extdata.mjs";
import { proveAndVerify, shutdown, CIRCUITS_DIR, E18 } from "./common.mjs";

await initPoseidon();
const OUT = path.resolve(CIRCUITS_DIR, "..", "contracts", "test", "fixtures");
mkdirSync(OUT, { recursive: true });

const kp = new Keypair(0x5a17ed5eedn); // deterministic DEV key
const noteTree = new MerkleTree(20);
const positionTree = new MerkleTree(20);

function write(name, circuit, proof, publicSignals, names, context) {
  const sol = toSolidityProof(proof, publicSignals);
  const named = {};
  names.forEach((n, i) => (named[n] = publicSignals[i]));
  const fixture = {
    circuit,
    note: "a, b, c are in Solidity verifier order (b coordinates already swapped). DEV trusted setup.",
    ...sol,
    publicSignalsNamed: named,
    context,
  };
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${path.join(OUT, name + ".json")}`);
}

// ---------- 1. deposit 100 USDT into two notes (100, 0) ----------
const extData = {
  recipient: "0x0000000000000000000000000000000000000000",
  extAmount: (100n * E18).toString(),
  relayer: "0x0000000000000000000000000000000000000000",
  fee: "0",
  encryptedOutput0: "0xaa",
  encryptedOutput1: "0xbb",
};
const dep = buildTransactInput({
  privKey: kp.privKey, tree: noteTree, extAmount: 100n * E18, fee: 0n,
  outputs: [{ amount: 100n * E18, blinding: 1111n }, { amount: 0n, blinding: 2222n }],
  extDataHash: extDataHash(extData),
});
const emptyRoot = noteTree.root();
let r = await proveAndVerify("transact", dep.input);
write("transact", "transact", r.proof, r.publicSignals,
  ["root", "publicAmount", "extDataHash", "inNullifier0", "inNullifier1", "outCommitment0", "outCommitment1"],
  {
    description: "Deposit of 100e18 into an EMPTY noteTree (root = zeros[20]); both inputs are zero-amount dummies.",
    extData,
    extDataHashFormula: "uint256(keccak256(abi.encode(recipient, int256 extAmount, relayer, fee, encryptedOutput0, encryptedOutput1))) % p",
    noteTreeRootBefore: emptyRoot.toString(),
    insertsIntoNoteTree: [dep.outCommitment[0].toString(), dep.outCommitment[1].toString()],
  });
dep.outCommitment.forEach((c) => noteTree.insert(c));

// ---------- 2. open: long 5x, margin 10 on market 1 at epoch 1000 ----------
const EPOCH = 1000;
const op = buildOpenInput({
  privKey: kp.privKey, tree: noteTree, note: { ...dep.outNotes[0], index: 0 },
  marketId: 1, margin: 10n * E18, epoch: EPOCH, isLong: true, leverage: 5,
  changeBlinding: 3333n, positionBlinding: 4444n,
});
r = await proveAndVerify("open", op.input);
write("open", "open", r.proof, r.publicSignals,
  ["root", "inNullifier", "changeCommitment", "positionCommitment", "marketId", "margin", "epoch"],
  {
    description: "Spends deposit note 0 (100e18) from noteTree after the transact fixture (leaves [out0, out1]); opens long 5x margin 10e18 market 1 at epoch 1000; change 90e18.",
    noteTreeLeavesBefore: noteTree.layers[0].map(String),
    insertsIntoNoteTree: [op.changeNote.commitment.toString()],
    insertsIntoPositionTree: [op.position.commitment.toString()],
    private: { isLong: 1, leverage: 5 },
  });
noteTree.insert(op.changeNote.commitment);
positionTree.insert(op.position.commitment);

// ---------- 3. close at offset 3 (epoch 1003), index +15% ----------
const series = [1_000_000n, 1_050_000n, 1_100_000n, 1_150_000n];
const pad = (a) => [...a, ...new Array(16 - a.length).fill(0n)];
const cl = buildCloseInput({
  privKey: kp.privKey, tree: positionTree, position: { ...op.position, index: 0 },
  closeOffset: 3, closes: pad(series), lows: pad(series), highs: pad(series), outBlinding: 5555n,
});
assert.equal(cl.payout, 174n * E18 / 10n);
r = await proveAndVerify("close", cl.input);
const idx = (p) => [...Array(16).keys()].map((i) => `${p}${i}`);
write("close", "close", r.proof, r.publicSignals,
  ["positionRoot", "positionNullifier", "outCommitment", "marketId", "margin", "entryEpoch", "closeOffset", "payout",
    ...idx("closes"), ...idx("lows"), ...idx("highs")],
  {
    description: "Closes the open fixture's position (positionTree leaves [positionCommitment]) at closeOffset 3. Oracle market 1, epochs 1000..1003 have close=low=high = 1000000, 1050000, 1100000, 1150000 (finalized); epochs 1004..1015 unfinalized (0). Long 5x: pnl = +7.5e18, fee = 0.1e18 -> payout 17.4e18.",
    oracle: { marketId: 1, epochs: [1000, 1001, 1002, 1003], values: series.map(String) },
    positionTreeLeavesBefore: positionTree.layers[0].map(String),
    insertsIntoNoteTree: [cl.outNote.commitment.toString()],
  });

await shutdown();
