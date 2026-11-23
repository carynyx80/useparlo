// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "./lib/PoseidonT3.sol";

/// @title MerkleTreeWithHistory
/// @notice Incremental depth-20 Poseidon Merkle tree with a 30-root history, as a storage-struct library so a single
///         contract can host several trees. zero leaf = 0, zeros[i+1] = H(zeros[i], zeros[i]).
library MerkleTreeWithHistory {
    uint256 internal constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 internal constant LEVELS = 20;
    uint32 internal constant ROOT_HISTORY_SIZE = 30;

    struct Tree {
        uint256[20] zeros; // zeros[i] = empty subtree root at height i
        uint256[20] filledSubtrees;
        uint256[30] roots;
        uint32 currentRootIndex;
        uint32 nextIndex;
        bool initialized;
    }

    error AlreadyInitialized();
    error TreeFull();
    error LeafOutOfField();

    function hashLeftRight(uint256 left, uint256 right) internal pure returns (uint256) {
        if (left >= FIELD_SIZE || right >= FIELD_SIZE) revert LeafOutOfField();
        return PoseidonT3.hash([left, right]);
    }

    function init(Tree storage t) internal {
        if (t.initialized) revert AlreadyInitialized();
        uint256 z = 0;
        for (uint32 i; i < LEVELS; ++i) {
            t.zeros[i] = z;
            t.filledSubtrees[i] = z;
            z = hashLeftRight(z, z);
        }
        t.roots[0] = z; // root of the empty tree = zeros[20]
        t.initialized = true;
    }

    /// @return index position of the inserted leaf
    function insert(Tree storage t, uint256 leaf) internal returns (uint32 index) {
        uint32 _nextIndex = t.nextIndex;
        if (_nextIndex == uint32(1) << LEVELS) revert TreeFull();
        uint32 currentIndex = _nextIndex;
        uint256 currentLevelHash = leaf;
        uint256 left;
        uint256 right;
        for (uint32 i; i < LEVELS; ++i) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = t.zeros[i];
                t.filledSubtrees[i] = currentLevelHash;
            } else {
                left = t.filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(left, right);
            currentIndex /= 2;
        }
        uint32 newRootIndex = (t.currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        t.currentRootIndex = newRootIndex;
        t.roots[newRootIndex] = currentLevelHash;
        t.nextIndex = _nextIndex + 1;
        return _nextIndex;
    }

    function isKnownRoot(Tree storage t, uint256 root) internal view returns (bool) {
        if (root == 0) return false;
        uint32 current = t.currentRootIndex;
        uint32 i = current;
        do {
            if (root == t.roots[i]) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            unchecked {
                --i;
            }
        } while (i != current);
        return false;
    }

    function lastRoot(Tree storage t) internal view returns (uint256) {
        return t.roots[t.currentRootIndex];
    }
}
