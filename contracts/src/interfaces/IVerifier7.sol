// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice snarkjs Groth16 verifier with 7 public signals (transact, open).
interface IVerifier7 {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[7] calldata _pubSignals
    ) external view returns (bool);
}
