// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAttentionOracle {
    function epochLength() external view returns (uint256);
    function currentEpoch() external view returns (uint256);
    function marketExists(uint256 marketId) external view returns (bool);
    function latest(uint256 marketId) external view returns (uint256 value, uint256 epoch);
    function getEpoch(uint256 marketId, uint256 epoch)
        external
        view
        returns (uint256 close, uint256 low, uint256 high, bool finalized);
    function getWindow(uint256 marketId, uint256 entryEpoch)
        external
        view
        returns (uint256[16] memory closes, uint256[16] memory lows, uint256[16] memory highs);
}
