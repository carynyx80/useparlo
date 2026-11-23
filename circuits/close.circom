pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "lib/merkle.circom";

/*
  Parlo close: settle a private position against the oracle's finalized index values.

  Public inputs (SPEC order, N = 56):
    [positionRoot, positionNullifier, outCommitment, marketId, margin, entryEpoch, closeOffset, payout,
     closes[0..15], lows[0..15], highs[0..15]]

  Math (all integer, exactly as in SPEC; JS mirror: js/payout.mjs):
    1 <= closeOffset <= 15, entry = closes[0], exit = closes[closeOffset]
    closes[0..closeOffset] must be non-zero (unfinalized slots are 0 and must lie after closeOffset)
    notional = margin * leverage
    long  knocked out  iff  exists i in 1..closeOffset: lows[i]  * 10L <= entry * (10L - 9)
                            (<=> lows[i]  <= entry * (1 - 0.9/L), evaluated exactly, no rounding)
    short knocked out  iff  exists i in 1..closeOffset: highs[i] * 10L >= entry * (10L + 9)
                            (<=> highs[i] >= entry * (1 + 0.9/L))
    |pnl| = floor(notional * |exit - entry| / entry); sign = + if (long and exit >= entry) or
            (short and exit < entry), else -           (i.e. pnl rounds toward zero)
    fee   = floor(notional * 20 / 10000)
    payout = knockedOut ? 0 : clamp(margin + pnl - fee, 0, 10 * margin)
    outCommitment = Poseidon(payout, pubKey, outBlinding)

  Bit widths: margin < 2^128, leverage <= 20 (notional < 2^133), index values < 2^64.
  If |pnl| >= 2^136 it is replaced by 2^136 (which always clamps to 0 or 10*margin) so that the
  division's quotient stays small enough to rule out field wrap-around (q*entry < 2^200 << p).
*/
template Close(levels, W) {
    // ---- public (declaration order == public-signal order) ----
    signal input positionRoot;
    signal input positionNullifier;
    signal input outCommitment;
    signal input marketId;
    signal input margin;
    signal input entryEpoch;
    signal input closeOffset;
    signal input payout;
    signal input closes[W];
    signal input lows[W];
    signal input highs[W];

    // ---- private ----
    signal input privKey;
    signal input isLong;
    signal input leverage;
    signal input positionBlinding;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input outBlinding;

    var BIG = 2 ** 136;

    component pk = Poseidon(1);
    pk.inputs[0] <== privKey;
    signal pubKey <== pk.out;

    // ---------------- range checks ----------------
    component marginRange = Num2Bits(128);
    marginRange.in <== margin;

    isLong * (1 - isLong) === 0;

    component levBits = Num2Bits(5);
    levBits.in <== leverage;
    component levMax = LessThan(5);
    levMax.in[0] <== leverage;
    levMax.in[1] <== 21;
    levMax.out === 1;
    component levZero = IsZero();
    levZero.in <== leverage;
    levZero.out === 0;

    // closeOffset in [1, 15]
    component offBits = Num2Bits(4);
    offBits.in <== closeOffset;
    component offZero = IsZero();
    offZero.in <== closeOffset;
    offZero.out === 0;

    component closeRange[W];
    component lowRange[W];
    component highRange[W];
    for (var i = 0; i < W; i++) {
        closeRange[i] = Num2Bits(64);
        closeRange[i].in <== closes[i];
        lowRange[i] = Num2Bits(64);
        lowRange[i].in <== lows[i];
        highRange[i] = Num2Bits(64);
        highRange[i].in <== highs[i];
    }

    // ---------------- position membership + nullifier ----------------
    component posCommit = Poseidon(7);
    posCommit.inputs[0] <== marketId;
    posCommit.inputs[1] <== isLong;
    posCommit.inputs[2] <== margin;
    posCommit.inputs[3] <== leverage;
    posCommit.inputs[4] <== entryEpoch;
    posCommit.inputs[5] <== pubKey;
    posCommit.inputs[6] <== positionBlinding;

    component tree = MerkleProof(levels);
    tree.leaf <== posCommit.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === positionRoot;

    component posNull = Poseidon(2);
    posNull.inputs[0] <== posCommit.out;
    posNull.inputs[1] <== privKey;
    posNull.out === positionNullifier;

    // ---------------- slot selection ----------------
    // active[i] = (i <= closeOffset), sel[i] = (i == closeOffset)
    component active[W];
    component sel[W];
    component closeZero[W];
    signal selClose[W];
    var exitAcc = 0;
    for (var i = 0; i < W; i++) {
        active[i] = LessThan(5);
        active[i].in[0] <== i;
        active[i].in[1] <== closeOffset + 1;

        sel[i] = IsEqual();
        sel[i].in[0] <== i;
        sel[i].in[1] <== closeOffset;
        selClose[i] <== sel[i].out * closes[i];
        exitAcc += selClose[i];

        // closes[0..closeOffset] must be finalized (non-zero)
        closeZero[i] = IsZero();
        closeZero[i].in <== closes[i];
        active[i].out * closeZero[i].out === 0;
    }
    signal entry <== closes[0];
    signal exit <== exitAcc;

    // ---------------- knock-out ----------------
    signal tenL <== 10 * leverage;
    signal longThresh <== entry * (tenL - 9);   // < 2^72
    signal shortThresh <== entry * (tenL + 9);  // < 2^72

    signal lowScaled[W];
    signal highScaled[W];
    signal hit[W];
    signal koTerm[W];
    component longHit[W];
    component shortHit[W];
    var koAcc = 0;
    for (var i = 1; i < W; i++) {
        lowScaled[i] <== lows[i] * tenL;
        longHit[i] = LessEqThan(80);
        longHit[i].in[0] <== lowScaled[i];
        longHit[i].in[1] <== longThresh;

        highScaled[i] <== highs[i] * tenL;
        shortHit[i] = GreaterEqThan(80);
        shortHit[i].in[0] <== highScaled[i];
        shortHit[i].in[1] <== shortThresh;

        hit[i] <== shortHit[i].out + isLong * (longHit[i].out - shortHit[i].out);
        koTerm[i] <== active[i].out * hit[i];
        koAcc += koTerm[i];
    }
    component koZero = IsZero();
    koZero.in <== koAcc;
    signal knockedOut <== 1 - koZero.out;

    // ---------------- pnl magnitude ----------------
    signal notional <== margin * leverage;      // < 2^133

    component up = GreaterEqThan(64);           // exit >= entry
    up.in[0] <== exit;
    up.in[1] <== entry;
    signal upDiff <== up.out * (exit - entry);
    signal absDiff <== 2 * upDiff - (exit - entry);   // |exit - entry| < 2^64

    signal prod <== notional * absDiff;         // < 2^197

    component isBig = GreaterEqThan(200);       // prod / entry >= 2^136 ?
    isBig.in[0] <== prod;
    isBig.in[1] <== BIG * entry;                // < 2^200
    signal big <== isBig.out;

    signal q;
    signal r;
    q <-- big == 1 ? 0 : prod \ entry;
    r <-- big == 1 ? 0 : prod % entry;
    component qBits = Num2Bits(136);
    qBits.in <== q;
    component rBits = Num2Bits(64);
    rBits.in <== r;
    component rLt = LessThan(64);               // r < entry
    rLt.in[0] <== r;
    rLt.in[1] <== entry;
    rLt.out === 1;
    signal qe <== q * entry;                    // < 2^200, no wrap
    (1 - big) * (qe + r - prod) === 0;
    signal absPnl <== q + big * (BIG - q);      // capped |pnl|, < 2^137

    // ---------------- fee ----------------
    signal feeQ;
    signal feeR;
    feeQ <-- notional \ 500;
    feeR <-- notional % 500;
    component feeQBits = Num2Bits(134);
    feeQBits.in <== feeQ;
    component feeRBits = Num2Bits(9);
    feeRBits.in <== feeR;
    component feeRLt = LessThan(9);
    feeRLt.in[0] <== feeR;
    feeRLt.in[1] <== 500;
    feeRLt.out === 1;
    feeQ * 500 + feeR === notional;
    signal fee <== feeQ;

    // ---------------- payout ----------------
    // win = (long && exit >= entry) || (short && exit < entry)
    signal upLong <== up.out * isLong;
    signal win <== 1 - up.out - isLong + 2 * upLong;
    signal winPnl <== win * absPnl;
    signal gross <== margin + winPnl;               // < 2^138
    signal debit <== absPnl - winPnl + fee;         // < 2^138

    component positive = GreaterThan(140);
    positive.in[0] <== gross;
    positive.in[1] <== debit;
    signal net <== positive.out * (gross - debit);  // max(gross - debit, 0)

    signal cap <== 10 * margin;
    component overCap = GreaterThan(140);
    overCap.in[0] <== net;
    overCap.in[1] <== cap;
    signal clamped <== net + overCap.out * (cap - net);

    signal finalPayout <== (1 - knockedOut) * clamped;
    payout === finalPayout;
    component payoutRange = Num2Bits(128);    // output note must be a valid (spendable) amount
    payoutRange.in <== payout;

    // ---------------- output note ----------------
    component outCommit = Poseidon(3);
    outCommit.inputs[0] <== payout;
    outCommit.inputs[1] <== pubKey;
    outCommit.inputs[2] <== outBlinding;
    outCommit.out === outCommitment;
}

component main {public [positionRoot, positionNullifier, outCommitment, marketId, margin, entryEpoch, closeOffset, payout, closes, lows, highs]} = Close(20, 16);
