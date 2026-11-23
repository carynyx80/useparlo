// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "./utils/Ownable.sol";
import {IAttentionOracle} from "./interfaces/IAttentionOracle.sol";

/// @title Parlo AttentionOracle
/// @notice Per-epoch OHLC-style (close/low/high) attention index per market, pushed by authorized reporters.
///         Values are uint scaled by 1e4. epoch = block.timestamp / epochLength.
/// @dev    Epochs without any push are "carried forward": once an epoch is in the past, an empty epoch
///         resolves to a flat bar at the last known close. This is deterministic and immutable (pushes only
///         ever write to the current epoch), and prevents positions from becoming un-closable if the
///         reporter misses an epoch.
contract AttentionOracle is Ownable, IAttentionOracle {
    uint256 public constant WINDOW = 16;
    uint256 public constant MAX_MOVE_BPS = 2000; // 20% per push
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_VALUE = type(uint64).max;
    uint256 public constant MAX_LOOKBACK = 64; // epochs searched backward when resolving an empty past epoch

    struct Market {
        bool exists;
        string symbol;
        uint256 lastValue;
        uint256 lastEpoch;
    }

    struct Bar {
        uint64 close;
        uint64 low;
        uint64 high;
    }

    uint256 public immutable epochLength;

    mapping(address => bool) public isReporter;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(uint256 => Bar)) internal _bars;
    uint256[] public marketIds;

    event MarketAdded(uint256 indexed marketId, string symbol);
    event ReporterSet(address indexed reporter, bool authorized);
    event ValuePushed(
        uint256 indexed marketId, uint256 indexed epoch, uint256 value, uint256 low, uint256 high, uint256 timestamp
    );

    error NotReporter();
    error MarketExists();
    error UnknownMarket();
    error InvalidMarketId();
    error InvalidValue();
    error MoveTooLarge(uint256 previous, uint256 value);
    error InvalidEpochLength();

    constructor(address initialOwner, uint256 epochLength_) Ownable(initialOwner) {
        if (epochLength_ == 0) revert InvalidEpochLength();
        epochLength = epochLength_;
    }

    modifier onlyReporter() {
        if (!isReporter[msg.sender] && msg.sender != owner) revert NotReporter();
        _;
    }

    // ------------------------------------------------------------------ admin

    function addMarket(uint256 id, string calldata symbol) external onlyOwner {
        if (id == 0 || id > type(uint32).max) revert InvalidMarketId();
        Market storage m = markets[id];
        if (m.exists) revert MarketExists();
        m.exists = true;
        m.symbol = symbol;
        marketIds.push(id);
        emit MarketAdded(id, symbol);
    }

    function setReporter(address reporter, bool authorized) external onlyOwner {
        if (reporter == address(0)) revert ZeroAddress();
        isReporter[reporter] = authorized;
        emit ReporterSet(reporter, authorized);
    }

    // ------------------------------------------------------------------ reporting

    /// @notice Push a new value for the current epoch. Rejects moves > 20% vs the previous pushed value.
    function push(uint256 marketId, uint256 value) public onlyReporter {
        Market storage m = markets[marketId];
        if (!m.exists) revert UnknownMarket();
        if (value == 0 || value > MAX_VALUE) revert InvalidValue();

        uint256 prev = m.lastValue;
        if (prev != 0) {
            uint256 diff = value > prev ? value - prev : prev - value;
            if (diff * BPS > prev * MAX_MOVE_BPS) revert MoveTooLarge(prev, value);
        }

        uint256 epoch = currentEpoch();
        Bar storage b = _bars[marketId][epoch];
        uint64 v = uint64(value);
        if (b.close == 0) {
            b.low = v;
            b.high = v;
        } else {
            if (v < b.low) b.low = v;
            if (v > b.high) b.high = v;
        }
        b.close = v;
        m.lastValue = value;
        m.lastEpoch = epoch;

        emit ValuePushed(marketId, epoch, value, b.low, b.high, block.timestamp);
    }

    function pushBatch(uint256[] calldata ids, uint256[] calldata values) external {
        if (ids.length != values.length) revert InvalidValue();
        for (uint256 i; i < ids.length; ++i) {
            push(ids[i], values[i]);
        }
    }

    // ------------------------------------------------------------------ views

    function currentEpoch() public view returns (uint256) {
        return block.timestamp / epochLength;
    }

    function marketExists(uint256 marketId) external view returns (bool) {
        return markets[marketId].exists;
    }

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    function latest(uint256 marketId) external view returns (uint256 value, uint256 epoch) {
        Market storage m = markets[marketId];
        return (m.lastValue, m.lastEpoch);
    }

    /// @notice Raw stored bar (no carry-forward).
    function rawBar(uint256 marketId, uint256 epoch) external view returns (uint256 close, uint256 low, uint256 high) {
        Bar memory b = _bars[marketId][epoch];
        return (b.close, b.low, b.high);
    }

    /// @notice (close, low, high, finalized) with finalized = epoch < currentEpoch && close != 0.
    ///         Past epochs with no push resolve to a flat bar at the previous close (carry-forward).
    function getEpoch(uint256 marketId, uint256 epoch)
        external
        view
        returns (uint256 close, uint256 low, uint256 high, bool finalized)
    {
        uint256 cur = currentEpoch();
        Bar memory b = _bars[marketId][epoch];
        if (epoch >= cur) return (b.close, b.low, b.high, false);
        if (b.close != 0) return (b.close, b.low, b.high, true);
        uint256 c = _carry(marketId, epoch);
        return (c, c, c, c != 0);
    }

    /// @notice Exactly the closes/lows/highs window the pool feeds to the close circuit for a position opened at
    ///         `entryEpoch`: slot i = epoch entryEpoch + i, finalized values only, zeros for unfinalized slots.
    function getWindow(uint256 marketId, uint256 entryEpoch)
        public
        view
        returns (uint256[16] memory closes, uint256[16] memory lows, uint256[16] memory highs)
    {
        uint256 cur = currentEpoch();
        uint256 prevClose;
        for (uint256 i; i < WINDOW; ++i) {
            uint256 e = entryEpoch + i;
            if (e >= cur) break; // unfinalized -> zeros (and every later slot too)
            Bar memory b = _bars[marketId][e];
            if (b.close != 0) {
                closes[i] = b.close;
                lows[i] = b.low;
                highs[i] = b.high;
            } else {
                uint256 c = i == 0 ? _carry(marketId, e) : prevClose;
                closes[i] = c;
                lows[i] = c;
                highs[i] = c;
            }
            prevClose = closes[i];
        }
    }

    /// @dev Last stored close strictly before `epoch` (epoch must be in the past and have no stored bar).
    function _carry(uint256 marketId, uint256 epoch) internal view returns (uint256) {
        Market storage m = markets[marketId];
        if (m.lastValue == 0) return 0;
        if (epoch > m.lastEpoch) return m.lastValue;
        uint256 steps;
        while (epoch > 0 && steps < MAX_LOOKBACK) {
            unchecked {
                --epoch;
                ++steps;
            }
            uint64 c = _bars[marketId][epoch].close;
            if (c != 0) return c;
        }
        return 0;
    }
}
