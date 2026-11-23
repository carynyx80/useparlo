// Witness-input builders for transact / open / close. Values are returned as decimal strings
// (what snarkjs expects); bigint metadata is returned alongside.
import { randomField, toField, toPublicAmount, assertAmount } from "./field.mjs";
import { derivePubKey } from "./keys.mjs";
import { noteCommitment, noteNullifier, positionCommitment, positionNullifier } from "./note.mjs";
import { computeClose, WINDOW } from "./payout.mjs";

const str = (v) => (Array.isArray(v) ? v.map(str) : BigInt(v).toString());
const strObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, str(v)]));

/**
 * transact (2-in / 2-out).
 * @param {object} p
 * @param {bigint} p.privKey
 * @param {MerkleTree} p.tree        noteTree mirror
 * @param {Array<{amount, blinding, index}>} p.inputs   0..2 notes owned by privKey (padded with dummies)
 * @param {Array<{amount, pubKey?, blinding?}>} p.outputs 0..2 outputs (padded with zero notes to self)
 * @param {bigint} [p.extAmount=0]   >0 deposit, <0 withdrawal
 * @param {bigint} [p.fee=0]         relayer fee
 * @param {bigint} p.extDataHash     see extdata.mjs
 */
export function buildTransactInput({ privKey, tree, inputs = [], outputs = [], extAmount = 0n, fee = 0n, extDataHash }) {
  if (inputs.length > 2 || outputs.length > 2) throw new Error("max 2 inputs / 2 outputs");
  if (extDataHash === undefined) throw new Error("extDataHash required");
  const pubKey = derivePubKey(privKey);
  const ins = [...inputs];
  while (ins.length < 2) ins.push({ amount: 0n, blinding: randomField() });
  const outs = outputs.map((o) => ({ amount: BigInt(o.amount), pubKey: o.pubKey ?? pubKey, blinding: o.blinding ?? randomField() }));
  while (outs.length < 2) outs.push({ amount: 0n, pubKey, blinding: randomField() });

  const inAmount = [], inBlinding = [], inPathElements = [], inPathIndices = [], inNullifier = [];
  for (const n of ins) {
    const amount = assertAmount(n.amount);
    const commitment = noteCommitment({ amount, pubKey, blinding: n.blinding });
    let path;
    if (amount === 0n && n.index === undefined) path = tree.emptyPath();
    else {
      const idx = n.index ?? tree.indexOf(commitment);
      if (idx < 0) throw new Error("input note not found in tree");
      path = tree.path(idx);
    }
    inAmount.push(amount);
    inBlinding.push(toField(n.blinding));
    inPathElements.push(path.pathElements);
    inPathIndices.push(path.pathIndices);
    inNullifier.push(noteNullifier(commitment, privKey));
  }
  const outCommitment = outs.map((o) => noteCommitment(o));
  const publicAmount = toPublicAmount(extAmount, fee);
  const sumIn = inAmount.reduce((a, b) => a + b, 0n);
  const sumOut = outs.reduce((a, o) => a + o.amount, 0n);
  if (sumIn + BigInt(extAmount) - BigInt(fee) !== sumOut) throw new Error("amounts do not balance");

  const input = {
    root: str(tree.root()),
    publicAmount: str(publicAmount),
    extDataHash: str(extDataHash),
    inNullifier: str(inNullifier),
    outCommitment: str(outCommitment),
    privKey: str(toField(privKey)),
    inAmount: str(inAmount),
    inBlinding: str(inBlinding),
    inPathElements: str(inPathElements),
    inPathIndices: str(inPathIndices),
    outAmount: str(outs.map((o) => o.amount)),
    outPubKey: str(outs.map((o) => o.pubKey)),
    outBlinding: str(outs.map((o) => o.blinding)),
  };
  const outNotes = outs.map((o, i) => ({ ...o, commitment: outCommitment[i] }));
  return { input, inNullifier, outCommitment, outNotes, publicAmount };
}

/**
 * open: spend one note, create change note + position note.
 */
export function buildOpenInput({
  privKey, tree, note, marketId, margin, epoch, isLong, leverage,
  changeBlinding = randomField(), positionBlinding = randomField(),
}) {
  const pubKey = derivePubKey(privKey);
  const amount = assertAmount(note.amount);
  const m = assertAmount(margin, "margin");
  if (m > amount) throw new Error("margin exceeds note amount");
  const L = BigInt(leverage);
  if (L < 1n || L > 20n) throw new Error("leverage must be in [1,20]");
  const commitment = noteCommitment({ amount, pubKey, blinding: note.blinding });
  const idx = note.index ?? tree.indexOf(commitment);
  if (idx < 0) throw new Error("note not found in tree");
  const path = tree.path(idx);
  const inNullifier = noteNullifier(commitment, privKey);
  const change = { amount: amount - m, pubKey, blinding: toField(changeBlinding) };
  change.commitment = noteCommitment(change);
  const position = {
    marketId: BigInt(marketId), isLong: isLong ? 1n : 0n, margin: m, leverage: L,
    entryEpoch: BigInt(epoch), pubKey, blinding: toField(positionBlinding),
  };
  position.commitment = positionCommitment(position);

  const input = strObj({
    root: tree.root(),
    inNullifier,
    changeCommitment: change.commitment,
    positionCommitment: position.commitment,
    marketId: position.marketId,
    margin: m,
    epoch: position.entryEpoch,
    privKey: toField(privKey),
    inAmount: amount,
    inBlinding: toField(note.blinding),
    changeBlinding: change.blinding,
    isLong: position.isLong,
    leverage: L,
    positionBlinding: position.blinding,
  });
  input.pathElements = str(path.pathElements);
  input.pathIndices = str(path.pathIndices);
  return { input, inNullifier, changeNote: change, position };
}

/**
 * close: settle a position. closes/lows/highs: 16 oracle values for epochs entryEpoch..entryEpoch+15
 * (unfinalized = 0, must be after closeOffset).
 */
export function buildCloseInput({ privKey, tree, position, closeOffset, closes, lows, highs, outBlinding = randomField() }) {
  if (closes.length !== WINDOW || lows.length !== WINDOW || highs.length !== WINDOW) throw new Error("need 16 closes/lows/highs");
  const pubKey = derivePubKey(privKey);
  const pos = { ...position, pubKey };
  const commitment = positionCommitment(pos);
  const idx = position.index ?? tree.indexOf(commitment);
  if (idx < 0) throw new Error("position not found in tree");
  const path = tree.path(idx);
  const nullifier = positionNullifier(commitment, privKey);
  const res = computeClose({ ...pos, closeOffset, closes, lows, highs });
  const outNote = { amount: res.payout, pubKey, blinding: toField(outBlinding) };
  outNote.commitment = noteCommitment(outNote);

  const input = {
    ...strObj({
      positionRoot: tree.root(),
      positionNullifier: nullifier,
      outCommitment: outNote.commitment,
      marketId: pos.marketId,
      margin: pos.margin,
      entryEpoch: pos.entryEpoch,
      closeOffset: BigInt(closeOffset),
      payout: res.payout,
    }),
    closes: str(closes),
    lows: str(lows),
    highs: str(highs),
    privKey: str(toField(privKey)),
    isLong: str(pos.isLong ? 1n : 0n),
    leverage: str(pos.leverage),
    positionBlinding: str(pos.blinding),
    pathElements: str(path.pathElements),
    pathIndices: str(path.pathIndices),
    outBlinding: str(outNote.blinding),
  };
  return { input, positionNullifier: nullifier, outNote, ...res };
}
