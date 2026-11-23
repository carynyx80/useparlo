pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// H(left, right) = Poseidon(left, right)  -- matches on-chain PoseidonT3.
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;

    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    hash <== h.out;
}

// If s == 0 returns [in[0], in[1]], if s == 1 returns [in[1], in[0]].
// s is constrained to be binary.
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Computes the Merkle root for `leaf` given its authentication path.
// pathIndices[i] == 0  -> current node is the LEFT child at level i
// pathIndices[i] == 1  -> current node is the RIGHT child at level i
// i.e. pathIndices are the little-endian bits of the leaf index.
// Every pathIndices[i] is binary-constrained (inside DualMux).
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component selectors[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== i == 0 ? leaf : hashers[i - 1].hash;
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
    }

    root <== hashers[levels - 1].hash;
}
