// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "../utils/ERC20.sol";

/// @notice TEST/LOCAL ONLY. 18-decimal USDT stand-in with open minting.
contract MockUSDT is ERC20 {
    constructor() ERC20("Tether USD (Mock)", "USDT", 18) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
