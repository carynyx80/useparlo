pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "lib/merkle.circom";

/*
  Parlo transact: 2-in / 2-out join-split over the balance-note tree.
  (deposit, withdraw, private transfer / self-transfer)

  Public inputs (SPEC order, N = 7):
    [root, publicAmount, extDataHash, inNullifier0, inNullifier1, outCommitment0, outCommitment1]

  pubKey        = Poseidon(privKey)
  commitment    = Poseidon(amount, pubKey, blinding)
  nullifier     = Poseidon(commitment, privKey)

  Rules:
    - sum(inAmount) + publicAmount == sum(outAmount)   (mod p)
    - every amount is range-checked to 128 bits
    - an input with amount 0 skips the Merkle root check (Tornado Nova trick)
    - the two input nullifiers must differ
    - both inputs are owned by the same privKey; outputs may go to any pubKey
*/
template Transact(levels, nIns, nOuts) {
    // ---- public (declaration order == public-signal order) ----
    signal input root;
    signal input publicAmount;
    signal input extDataHash;
    signal input inNullifier[nIns];
    signal input outCommitment[nOuts];

    // ---- private ----
    signal input privKey;
    signal input inAmount[nIns];
    signal input inBlinding[nIns];
    signal input inPathElements[nIns][levels];
    signal input inPathIndices[nIns][levels];

    signal input outAmount[nOuts];
    signal input outPubKey[nOuts];
    signal input outBlinding[nOuts];

    component pk = Poseidon(1);
    pk.inputs[0] <== privKey;
    signal pubKey <== pk.out;

    component inCommit[nIns];
    component inNull[nIns];
    component inRange[nIns];
    component inTree[nIns];
    component rootCheck[nIns];
    var sumIns = 0;

    for (var i = 0; i < nIns; i++) {
        inRange[i] = Num2Bits(128);
        inRange[i].in <== inAmount[i];

        inCommit[i] = Poseidon(3);
        inCommit[i].inputs[0] <== inAmount[i];
        inCommit[i].inputs[1] <== pubKey;
        inCommit[i].inputs[2] <== inBlinding[i];

        inNull[i] = Poseidon(2);
        inNull[i].inputs[0] <== inCommit[i].out;
        inNull[i].inputs[1] <== privKey;
        inNull[i].out === inNullifier[i];

        inTree[i] = MerkleProof(levels);
        inTree[i].leaf <== inCommit[i].out;
        for (var j = 0; j < levels; j++) {
            inTree[i].pathElements[j] <== inPathElements[i][j];
            inTree[i].pathIndices[j] <== inPathIndices[i][j];
        }

        // root must match unless amount == 0 (enabled is any non-zero value)
        rootCheck[i] = ForceEqualIfEnabled();
        rootCheck[i].in[0] <== root;
        rootCheck[i].in[1] <== inTree[i].root;
        rootCheck[i].enabled <== inAmount[i];

        sumIns += inAmount[i];
    }

    component outCommit[nOuts];
    component outRange[nOuts];
    var sumOuts = 0;

    for (var i = 0; i < nOuts; i++) {
        outRange[i] = Num2Bits(128);
        outRange[i].in <== outAmount[i];

        outCommit[i] = Poseidon(3);
        outCommit[i].inputs[0] <== outAmount[i];
        outCommit[i].inputs[1] <== outPubKey[i];
        outCommit[i].inputs[2] <== outBlinding[i];
        outCommit[i].out === outCommitment[i];

        sumOuts += outAmount[i];
    }

    // input nullifiers must be pairwise distinct
    component sameNull[nIns * (nIns - 1) / 2];
    var k = 0;
    for (var i = 0; i < nIns - 1; i++) {
        for (var j = i + 1; j < nIns; j++) {
            sameNull[k] = IsEqual();
            sameNull[k].in[0] <== inNullifier[i];
            sameNull[k].in[1] <== inNullifier[j];
            sameNull[k].out === 0;
            k++;
        }
    }

    // balance
    sumIns + publicAmount === sumOuts;

    // bind extDataHash into a constraint (defence in depth against malleability)
    signal extDataSquare <== extDataHash * extDataHash;
}

component main {public [root, publicAmount, extDataHash, inNullifier, outCommitment]} = Transact(20, 2, 2);
