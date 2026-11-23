import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  initPoseidon, MerkleTree, Keypair, newPosition, buildCloseInput, computeClose,
  positionCommitment, noteCommitment, poseidon,
} from "../js/index.mjs";
import { proveAndVerify, expectWitnessFail, shutdown, clone, E18 } from "./common.mjs";

await initPoseidon();
after(shutdown);

const kp = new Keypair(777n);
const tree = new MerkleTree(20);
const E = 1_000_000n; // index 100.0

/** series helper: values for slots 0..n, rest 0 (unfinalized) */
const pad = (arr) => [...arr.map(BigInt), ...new Array(16 - arr.length).fill(0n)];

function addPosition(isLong, leverage, margin = 10n * E18) {
  const pos = newPosition({ marketId: 2, isLong, margin, leverage, entryEpoch: 900, pubKey: kp.pubKey });
  pos.index = tree.insert(pos.commitment);
  return pos;
}
const LONG5 = addPosition(true, 5);
const SHORT5 = addPosition(false, 5);
const LONG20 = addPosition(true, 20);
const SHORT1 = addPosition(false, 1);
const LONG1 = addPosition(true, 1);

const close = (position, closeOffset, closes, lows = closes, highs = closes) =>
  buildCloseInput({ privKey: kp.privKey, tree, position, closeOffset, closes: pad(closes), lows: pad(lows), highs: pad(highs) });

test("close: long 5x +15% -> margin + 7.5 - 0.1 fee", async () => {
  const r = close(LONG5, 3, [E, 1_050_000n, 1_100_000n, 1_150_000n]);
  assert.equal(r.knockedOut, false);
  assert.equal(r.payout, 10n * E18 + 75n * E18 / 10n - E18 / 10n);
  const { publicSignals, ms } = await proveAndVerify("close", r.input);
  console.log(`  close prove: ${ms.toFixed(0)} ms`);
  assert.equal(publicSignals.length, 56);
  assert.equal(publicSignals[7], r.payout.toString());
  assert.equal(publicSignals[6], "3");
  assert.equal(publicSignals[8], E.toString());
  assert.equal(publicSignals[8 + 16 + 3], "1150000"); // lows[3]
});

test("close: short 5x, index falls 10% (non-integer pnl, rounding)", async () => {
  const r = close(SHORT5, 2, [E, 950_000n, 900_007n]);
  const expectedPnl = (50n * E18 * (E - 900_007n)) / E;
  assert.equal(r.pnl, expectedPnl);
  await proveAndVerify("close", r.input);
});

test("close: long 5x loses (pnl negative, payout > 0)", async () => {
  const r = close(LONG5, 1, [E, 900_000n]);
  assert.equal(r.payout, 10n * E18 - 5n * E18 - E18 / 10n);
  await proveAndVerify("close", r.input);
});

test("close: long 20x knocked out (low <= entry*(1-0.9/20)) -> payout 0", async () => {
  // threshold = 955000; low at slot 2 touches it, close recovers above entry
  const closes = [E, 990_000n, 1_010_000n, 1_200_000n];
  const lows = [E, 980_000n, 955_000n, 1_100_000n];
  const highs = [E, 1_000_000n, 1_020_000n, 1_200_000n];
  const r = close(LONG20, 3, closes, lows, highs);
  assert.equal(r.knockedOut, true);
  assert.equal(r.payout, 0n);
  await proveAndVerify("close", r.input);

  // negative: knocked-out long claiming the un-knocked payout
  const i = clone(r.input);
  const fake = computeClose({ ...LONG20, closeOffset: 3, closes: pad(closes), lows: pad(closes), highs: pad(closes) }).payout;
  assert.ok(fake > 0n);
  i.payout = fake.toString();
  i.outCommitment = noteCommitment({ amount: fake, pubKey: kp.pubKey, blinding: BigInt(i.outBlinding) }).toString();
  await expectWitnessFail("close", i, "knocked-out long paying > 0");
});

test("close: low just above threshold is NOT a knock-out; KO after closeOffset is ignored", async () => {
  const closes = [E, 1_000_000n, 1_050_000n, 0n, 0n];
  const lows = [E, 955_001n, 1_000_000n, 1n, 1n]; // slots 3,4 are beyond closeOffset=2
  const r = close(LONG20, 2, closes, lows, closes);
  assert.equal(r.knockedOut, false);
  await proveAndVerify("close", r.input);
});

test("close: short 1x knocked out at +90% (high >= entry*1.9)", async () => {
  const r = close(SHORT1, 2, [E, 1_200_000n, 1_100_000n], [E, 1_100_000n, 1_050_000n], [E, 1_900_000n, 1_200_000n]);
  assert.equal(r.knockedOut, true);
  assert.equal(r.payout, 0n);
  await proveAndVerify("close", r.input);
});

test("close: profit cap 10x margin (long 20x, +100%) and huge-pnl branch", async () => {
  const r = close(LONG20, 15, [E, 1_100_000n, 1_200_000n, 1_300_000n, 1_400_000n, 1_500_000n, 1_600_000n, 1_700_000n,
    1_800_000n, 1_900_000n, 2_000_000n, 2_000_000n, 2_000_000n, 2_000_000n, 2_000_000n, 2_000_000n]);
  assert.equal(r.payout, 100n * E18);
  await proveAndVerify("close", r.input);
  // |pnl| >= 2^136 path: tiny entry, huge exit, big margin
  const whale = addPosition(true, 20, (1n << 124n));
  const r2 = close(whale, 1, [1n, (1n << 63n)]);
  assert.equal(r2.payout, 10n * (1n << 124n));
  await proveAndVerify("close", r2.input);
  const whaleS = addPosition(false, 20, (1n << 124n));
  const r3 = close(whaleS, 1, [1n, (1n << 63n)], [1n, 1n], [1n, 1n]);
  assert.equal(r3.payout, 0n);
  await proveAndVerify("close", r3.input);
});

test("close: loss clamps at 0 without knock-out (long 1x, -95%... via -85%)", async () => {
  // long 1x KO threshold is entry*0.1, so -85% is not a KO: payout = 10 - 8.5 - 0.02
  const r = close(LONG1, 1, [E, 150_000n]);
  assert.equal(r.knockedOut, false);
  assert.equal(r.payout, 10n * E18 - 85n * E18 / 10n - 2n * E18 / 100n);
  await proveAndVerify("close", r.input);
});

test("close: negative cases", async () => {
  const good = close(LONG5, 3, [E, 1_050_000n, 1_100_000n, 1_150_000n]);
  const base = good.input;
  const setPayout = (i, v) => {
    i.payout = v.toString();
    i.outCommitment = noteCommitment({ amount: v, pubKey: kp.pubKey, blinding: BigInt(i.outBlinding) }).toString();
    return i;
  };
  // payout off by one
  await expectWitnessFail("close", setPayout(clone(base), good.payout + 1n), "payout+1");
  await expectWitnessFail("close", setPayout(clone(base), good.payout - 1n), "payout-1");
  // closeOffset 0 and 16
  for (const off of ["0", "16"]) {
    const i = clone(base); i.closeOffset = off;
    await expectWitnessFail("close", i, `closeOffset ${off}`);
  }
  // exit slot unfinalized (0)
  {
    const i = clone(base); i.closes[3] = "0";
    await expectWitnessFail("close", i, "unfinalized exit");
  }
  // intermediate slot unfinalized
  {
    const i = clone(base); i.closes[2] = "0";
    await expectWitnessFail("close", i, "unfinalized slot <= closeOffset");
  }
  // index value >= 2^64
  {
    const i = clone(base); i.highs[10] = (1n << 64n).toString();
    await expectWitnessFail("close", i, "index out of range");
  }
  // wrong root / wrong key / wrong nullifier
  { const i = clone(base); i.positionRoot = "5"; await expectWitnessFail("close", i, "bad root"); }
  { const i = clone(base); i.positionNullifier = "5"; await expectWitnessFail("close", i, "bad nullifier"); }
  // flip side privately (long -> short) : commitment no longer in tree
  { const i = clone(base); i.isLong = "0"; await expectWitnessFail("close", i, "flip side"); }

  // leverage 21 position actually in the tree (bypassing open): must still fail
  {
    const pos = { marketId: 2n, isLong: 1n, margin: 10n * E18, leverage: 21n, entryEpoch: 900n, pubKey: kp.pubKey, blinding: 99n };
    pos.commitment = positionCommitment(pos);
    const t = new MerkleTree(20, [pos.commitment]);
    const path = t.path(0);
    const notional = 210n * E18;
    const payout = 10n * E18 - notional / 500n; // flat index, no KO
    const i = clone(base);
    Object.assign(i, {
      positionRoot: t.root().toString(),
      positionNullifier: poseidon([pos.commitment, kp.privKey]).toString(),
      leverage: "21", positionBlinding: "99",
      pathElements: path.pathElements.map(String), pathIndices: path.pathIndices.map(String),
      closes: new Array(16).fill(E.toString()), lows: new Array(16).fill(E.toString()), highs: new Array(16).fill(E.toString()),
    });
    setPayout(i, payout);
    await expectWitnessFail("close", i, "leverage 21");
  }
});
