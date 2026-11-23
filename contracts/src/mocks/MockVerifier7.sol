// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier7} from "../interfaces/IVerifier7.sol";

/// @notice TEST ONLY. Accepts every proof unless `result` is set to false.
contract MockVerifier7 is IVerifier7 {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[7] calldata)
        external
        view
        returns (bool)
    {
        return result;
    }
}
