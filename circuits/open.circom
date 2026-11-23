pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "lib/merkle.circom";

/*
  Parlo open: spend one balance note, create a change note and a private position note.

  Public inputs (SPEC order, N = 7):
    [root, inNullifier, changeCommitment, positionCommitment, marketId, margin, epoch]

  inCommitment       = Poseidon(inAmount, pubKey, inBlinding)          (must be in noteTree @ root)
  inNullifier        = Poseidon(inCommitment, privKey)
  changeCommitment   = Poseidon(inAmount - margin, pubKey, changeBlinding)
  positionCommitment = Poseidon(marketId, isLong, margin, leverage, epoch, pubKey, positionBlinding)

  isLong in {0,1}, leverage in [1,20], inAmount / margin / change all < 2^128.
*/
template Open(levels) {
    // ---- public ----
    signal input root;
    signal input inNullifier;
    signal input changeCommitment;
    signal input positionCommitment;
    signal input marketId;
    signal input margin;
    signal input epoch;

    // ---- private ----
    signal input privKey;
    signal input inAmount;
    signal input inBlinding;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input changeBlinding;
    signal input isLong;
    signal input leverage;
    signal input positionBlinding;

    component pk = Poseidon(1);
    pk.inputs[0] <== privKey;
    signal pubKey <== pk.out;

    // range checks
    component inRange = Num2Bits(128);
    inRange.in <== inAmount;
    component marginRange = Num2Bits(128);
    marginRange.in <== margin;
    signal change <== inAmount - margin;
    component changeRange = Num2Bits(128);   // => margin <= inAmount
    changeRange.in <== change;

    // isLong boolean
    isLong * (1 - isLong) === 0;

    // leverage in [1, 20]
    component levBits = Num2Bits(5);
    levBits.in <== leverage;
    component levMax = LessThan(5);
    levMax.in[0] <== leverage;
    levMax.in[1] <== 21;
    levMax.out === 1;
    component levZero = IsZero();
    levZero.in <== leverage;
    levZero.out === 0;

    // input note
    component inCommit = Poseidon(3);
    inCommit.inputs[0] <== inAmount;
    inCommit.inputs[1] <== pubKey;
    inCommit.inputs[2] <== inBlinding;

    component inNull = Poseidon(2);
    inNull.inputs[0] <== inCommit.out;
    inNull.inputs[1] <== privKey;
    inNull.out === inNullifier;

    component tree = MerkleProof(levels);
    tree.leaf <== inCommit.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;

    // change note
    component changeCommit = Poseidon(3);
    changeCommit.inputs[0] <== change;
    changeCommit.inputs[1] <== pubKey;
    changeCommit.inputs[2] <== changeBlinding;
    changeCommit.out === changeCommitment;

    // position note
    component posCommit = Poseidon(7);
    posCommit.inputs[0] <== marketId;
    posCommit.inputs[1] <== isLong;
    posCommit.inputs[2] <== margin;
    posCommit.inputs[3] <== leverage;
    posCommit.inputs[4] <== epoch;
    posCommit.inputs[5] <== pubKey;
    posCommit.inputs[6] <== positionBlinding;
    posCommit.out === positionCommitment;
}

component main {public [root, inNullifier, changeCommitment, positionCommitment, marketId, margin, epoch]} = Open(20);
