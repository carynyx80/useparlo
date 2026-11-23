// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {AttentionOracle} from "../src/AttentionOracle.sol";
import {Ownable} from "../src/utils/Ownable.sol";

contract AttentionOracleTest is Base {
    function test_pushSetsBarAndTracksLowHigh() public {
        uint256 e = cur();
        push(1, 1_000_000);
        push(1, 1_100_000);
        push(1, 950_000);
        push(1, 1_020_000);
        (uint256 c, uint256 l, uint256 h) = oracle.rawBar(1, e);
        assertEq(c, 1_020_000);
        assertEq(l, 950_000);
        assertEq(h, 1_100_000);
        (uint256 v, uint256 le) = oracle.latest(1);
        assertEq(v, 1_020_000);
        assertEq(le, e);
    }

    function test_finalizedOnlyAfterEpochEnds() public {
        uint256 e = cur();
        push(1, 1_000_000);
        (uint256 c,,, bool fin) = oracle.getEpoch(1, e);
        assertEq(c, 1_000_000);
        assertFalse(fin);
        nextEpoch();
        (c,,, fin) = oracle.getEpoch(1, e);
        assertTrue(fin);
        (c,,, fin) = oracle.getEpoch(1, e + 1); // current, no push
        assertFalse(fin);
        assertEq(c, 0);
    }

    function test_deviationLimit() public {
        push(1, 1_000_000);
        push(1, 1_200_000); // +20% exactly ok
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(AttentionOracle.MoveTooLarge.selector, 1_200_000, 1_440_001));
        oracle.push(1, 1_440_001);
        push(1, 960_000); // -20% ok
        vm.prank(reporter);
        vm.expectRevert();
        oracle.push(1, 767_999);
    }

    function test_deviationAppliesAcrossEpochs() public {
        push(1, 1_000_000);
        nextEpoch();
        nextEpoch();
        vm.prank(reporter);
        vm.expectRevert();
        oracle.push(1, 1_300_000);
    }

    function test_onlyReporter() public {
        vm.prank(alice);
        vm.expectRevert(AttentionOracle.NotReporter.selector);
        oracle.push(1, 1);
        vm.prank(owner);
        oracle.setReporter(reporter, false);
        vm.prank(reporter);
        vm.expectRevert(AttentionOracle.NotReporter.selector);
        oracle.push(1, 1);
    }

    function test_unknownMarketAndBadValue() public {
        vm.startPrank(reporter);
        vm.expectRevert(AttentionOracle.UnknownMarket.selector);
        oracle.push(99, 1);
        vm.expectRevert(AttentionOracle.InvalidValue.selector);
        oracle.push(1, 0);
        vm.expectRevert(AttentionOracle.InvalidValue.selector);
        oracle.push(1, uint256(type(uint64).max) + 1);
        vm.stopPrank();
    }

    function test_addMarketOnlyOwnerAndUnique() public {
        vm.prank(alice);
        vm.expectRevert(Ownable.NotOwner.selector);
        oracle.addMarket(3, "#AIAgents");
        vm.startPrank(owner);
        vm.expectRevert(AttentionOracle.MarketExists.selector);
        oracle.addMarket(1, "dup");
        vm.expectRevert(AttentionOracle.InvalidMarketId.selector);
        oracle.addMarket(0, "zero");
        oracle.addMarket(3, "#AIAgents");
        vm.stopPrank();
        assertEq(oracle.marketCount(), 3);
        assertTrue(oracle.marketExists(3));
    }

    function test_carryForwardForEmptyEpochs() public {
        uint256 e = cur();
        push(1, 1_000_000);
        nextEpoch(); // e+1 empty
        nextEpoch(); // e+2
        push(1, 1_100_000);
        nextEpoch(); // now e+3
        (uint256 c, uint256 l, uint256 h, bool fin) = oracle.getEpoch(1, e + 1);
        assertEq(c, 1_000_000);
        assertEq(l, 1_000_000);
        assertEq(h, 1_000_000);
        assertTrue(fin);
        (uint256[16] memory closes, uint256[16] memory lows, uint256[16] memory highs) = oracle.getWindow(1, e);
        assertEq(closes[0], 1_000_000);
        assertEq(closes[1], 1_000_000);
        assertEq(closes[2], 1_100_000);
        assertEq(closes[3], 0); // current epoch, unfinalized
        assertEq(lows[3], 0);
        assertEq(highs[15], 0);
        // reporter gone: everything after last push carries
        vm.warp(block.timestamp + 10 * EPOCH);
        (closes,,) = oracle.getWindow(1, e);
        assertEq(closes[12], 1_100_000);
    }

    function test_windowZeroBeforeMarketStarted() public {
        uint256 e = cur();
        nextEpoch();
        push(1, 1_000_000);
        nextEpoch();
        (uint256[16] memory closes,,) = oracle.getWindow(1, e);
        assertEq(closes[0], 0);
        assertEq(closes[1], 1_000_000);
    }
}
