import { test, after } from "node:test";
import assert from "node:assert/strict";
import { initPoseidon, MerkleTree, Keypair, newNote, buildOpenInput, positionCommitment } from "../js/index.mjs";
import { proveAndVerify, expectWitnessFail, shutdown, clone, E18 } from "./common.mjs";

await initPoseidon();
after(shutdown);

const kp = new Keypair(42424242n);
const tree = new MerkleTree(20);
tree.insert(111n); // unrelated leaf
const note = newNote(100n * E18, kp.pubKey);
const idx = tree.insert(note.commitment);
tree.insert(222n);

const mk = (over = {}) =>
  buildOpenInput({ privKey: kp.privKey, tree, note: { ...note, index: idx }, marketId: 3, margin: 25n * E18, epoch: 5000, isLong: true, leverage: 10, ...over });

/** Re-derive positionCommitment for a mutated input (to isolate range checks). */
const recommit = (i) => {
  i.positionCommitment = positionCommitment({
    marketId: BigInt(i.marketId), isLong: BigInt(i.isLong), margin: BigInt(i.margin), leverage: BigInt(i.leverage),
    entryEpoch: BigInt(i.epoch), pubKey: kp.pubKey, blinding: BigInt(i.positionBlinding),
  }).toString();
  return i;
};

test("open: valid long 10x", async () => {
  const { input, changeNote, position } = mk();
  const { publicSignals, ms } = await proveAndVerify("open", input);
  console.log(`  open prove: ${ms.toFixed(0)} ms`);
  assert.equal(publicSignals.length, 7);
  assert.deepEqual(publicSignals, [
    tree.root(), input.inNullifier, changeNote.commitment, position.commitment, 3n, 25n * E18, 5000n,
  ].map(String));
  assert.equal(changeNote.amount, 75n * E18);
});

test("open: valid short 1x and 20x, full-balance margin", async () => {
  await proveAndVerify("open", mk({ isLong: false, leverage: 1 }).input);
  await proveAndVerify("open", mk({ leverage: 20, margin: 100n * E18 }).input);
});

test("open: negative cases", async () => {
  const base = mk().input;
  // leverage 21 / 0 (commitment recomputed so only the range check can fail)
  for (const lev of ["21", "0", "32"]) {
    const i = clone(base); i.leverage = lev;
    await expectWitnessFail("open", recommit(i), `leverage ${lev}`);
  }
  // isLong = 2
  { const i = clone(base); i.isLong = "2"; await expectWitnessFail("open", recommit(i), "isLong 2"); }
  // margin > note amount (change would be negative)
  {
    const i = clone(base); i.margin = (101n * E18).toString();
    await expectWitnessFail("open", recommit(i), "margin > amount");
  }
  // wrong root
  { const i = clone(base); i.root = "7"; await expectWitnessFail("open", i, "bad root"); }
  // non-binary path index
  { const i = clone(base); i.pathIndices[0] = "2"; await expectWitnessFail("open", i, "pathIndex 2"); }
  // change amount mismatch (claim more change)
  { const i = clone(base); i.changeCommitment = "123"; await expectWitnessFail("open", i, "bad change"); }
});
