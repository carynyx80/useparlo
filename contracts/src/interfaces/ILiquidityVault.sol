// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiquidityVault {
    function receiveMargin(uint256 margin, uint256 entryEpoch) external;
    function payOut(uint256 amount, uint256 margin, uint256 entryEpoch) external;
    function activeReserve() external view returns (uint256);
    function totalAssets() external view returns (uint256);
}
