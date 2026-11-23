import { test, after } from "node:test";
import assert from "node:assert/strict";
import { initPoseidon, MerkleTree, Keypair, buildTransactInput, FIELD_SIZE, noteCommitment } from "../js/index.mjs";
import { extDataHash } from "../js/extdata.mjs";
import { proveAndVerify, expectWitnessFail, verifyRaw, shutdown, clone, E18 } from "./common.mjs";

await initPoseidon();
after(shutdown);

const kp = new Keypair(1234567890123456789n);
const other = new Keypair(987654321n);
const ext = (extAmount, fee = 0n) =>
  extDataHash({
    recipient: "0x000000000000000000000000000000000000dEaD",
    extAmount, relayer: "0x0000000000000000000000000000000000000000", fee,
    encryptedOutput0: "0xaa", encryptedOutput1: "0xbb",
  });

const tree = new MerkleTree(20);
let depositNotes;

test("transact: deposit (2 dummy inputs, empty-tree root)", async () => {
  const { input, outNotes } = buildTransactInput({
    privKey: kp.privKey, tree, extAmount: 100n * E18,
    outputs: [{ amount: 60n * E18 }, { amount: 40n * E18 }], extDataHash: ext(100n * E18),
  });
  const { publicSignals, ms } = await proveAndVerify("transact", input);
  console.log(`  transact prove: ${ms.toFixed(0)} ms`);
  assert.equal(publicSignals.length, 7);
  assert.equal(publicSignals[0], tree.root().toString());
  assert.equal(publicSignals[1], (100n * E18).toString());
  outNotes.forEach((n) => tree.insert(n.commitment));
  depositNotes = outNotes;
});

test("transact: 2 real inputs -> partial withdraw + transfer to other key, with relayer fee", async () => {
  const extAmount = -30n * E18, fee = 1n * E18;
  const { input, publicSignals: _ } = buildTransactInput({
    privKey: kp.privKey, tree,
    inputs: depositNotes.map((n, i) => ({ ...n, index: i })),
    outputs: [{ amount: 50n * E18, pubKey: other.pubKey }, { amount: 19n * E18 }],
    extAmount, fee, extDataHash: ext(extAmount, fee),
  });
  const { publicSignals } = await proveAndVerify("transact", input);
  assert.equal(publicSignals[1], (FIELD_SIZE - 31n * E18).toString()); // (extAmount - fee) mod p
});

test("transact: 1 real input + 1 zero input (zero input skips root check)", async () => {
  const { input } = buildTransactInput({
    privKey: kp.privKey, tree, inputs: [{ ...depositNotes[0], index: 0 }],
    outputs: [{ amount: 60n * E18 }], extDataHash: ext(0n),
  });
  // corrupt the dummy's path: must still pass because its amount is 0
  input.inPathElements[1][0] = "12345";
  await proveAndVerify("transact", input);
});

test("transact: negative cases", async () => {
  const base = buildTransactInput({
    privKey: kp.privKey, tree, inputs: [{ ...depositNotes[0], index: 0 }],
    outputs: [{ amount: 60n * E18 }], extDataHash: ext(0n),
  }).input;

  // wrong amount balance: output 61 from input 60 (commitment recomputed so only balance fails)
  {
    const i = clone(base);
    i.outAmount[0] = (61n * E18).toString();
    i.outCommitment[0] = noteCommitment({ amount: 61n * E18, pubKey: kp.pubKey, blinding: BigInt(i.outBlinding[0]) }).toString();
    await expectWitnessFail("transact", i, "unbalanced");
  }
  // 128-bit range: outputs (60+1, -1 mod p) balance mod p but -1 is out of range
  {
    const i = clone(base);
    const neg = FIELD_SIZE - 1n;
    i.outAmount = [(60n * E18 + 1n).toString(), neg.toString()];
    i.outCommitment = [
      noteCommitment({ amount: 60n * E18 + 1n, pubKey: kp.pubKey, blinding: BigInt(i.outBlinding[0]) }),
      // noteCommitment() itself range-checks, so hash directly
      (await import("../js/field.mjs")).poseidon([neg, kp.pubKey, BigInt(i.outBlinding[1])]),
    ].map(String);
    await expectWitnessFail("transact", i, "negative output");
  }
  // non-zero input with wrong root
  {
    const i = clone(base);
    i.root = "1";
    await expectWitnessFail("transact", i, "bad root");
  }
  // same note used twice (identical nullifiers)
  {
    const { input } = buildTransactInput({
      privKey: kp.privKey, tree,
      inputs: [{ ...depositNotes[0], index: 0 }, { ...depositNotes[0], index: 0 }],
      outputs: [{ amount: 120n * E18 }], extDataHash: ext(0n),
    });
    await expectWitnessFail("transact", input, "duplicate nullifier");
  }
  // wrong private key for input note
  {
    const i = clone(base);
    i.privKey = other.privKey.toString();
    await expectWitnessFail("transact", i, "wrong key");
  }
});

test("transact: tampered public signal fails verification", async () => {
  const { input } = buildTransactInput({
    privKey: kp.privKey, tree, extAmount: 5n, outputs: [{ amount: 5n }], extDataHash: ext(5n),
  });
  const { proof, publicSignals } = await proveAndVerify("transact", input);
  const bad = [...publicSignals];
  bad[2] = (BigInt(bad[2]) + 1n).toString(); // extDataHash
  assert.equal(await verifyRaw("transact", bad, proof), false);
  const bad2 = [...publicSignals];
  bad2[1] = "6"; // publicAmount
  assert.equal(await verifyRaw("transact", bad2, proof), false);
});
