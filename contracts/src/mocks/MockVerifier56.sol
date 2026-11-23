// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier56} from "../interfaces/IVerifier56.sol";

/// @notice TEST ONLY. Accepts every proof unless `result` is set to false. Records last public signals.
contract MockVerifier56 is IVerifier56 {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[56] calldata)
        external
        view
        returns (bool)
    {
        return result;
    }
}
