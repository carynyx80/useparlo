// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";

contract LiquidityVaultTest is Base {
    function test_depositWithdraw() public {
        lpDeposit(1000e18);
        assertEq(vault.balanceOf(lp), 1000e18);
        assertEq(vault.totalAssets(), 1000e18);
        vm.prank(lp);
        uint256 out = vault.withdraw(400e18, lp);
        assertEq(out, 400e18);
        assertEq(vault.totalAssets(), 600e18);
        assertEq(usdt.balanceOf(lp), 1_000_000e18 - 600e18);
    }

    function test_donationDoesNotChangeSharePrice() public {
        lpDeposit(1000e18);
        usdt.mint(address(vault), 1_000_000e18);
        assertEq(vault.convertToAssets(1e18), 1e18);
    }

    function test_onlyPoolHooks() public {
        vm.expectRevert(LiquidityVault.NotPool.selector);
        vault.receiveMargin(1, 1);
        vm.expectRevert(LiquidityVault.NotPool.selector);
        vault.payOut(1, 1, 1);
    }

    function test_setPoolOnce() public {
        vm.prank(owner);
        vm.expectRevert(LiquidityVault.PoolAlreadySet.selector);
        vault.setPool(alice);
    }

    function test_reserveLimitOnReceiveMargin() public {
        lpDeposit(1000e18);
        // margin 50 -> reserve 450; assets 1050 - 0.05 fee; 450 <= 524.97 ok
        usdt.mint(address(pool), 1000e18);
        vm.startPrank(address(pool));
        usdt.transfer(address(vault), 50e18);
        vault.receiveMargin(50e18, cur());
        assertEq(vault.activeReserve(), 450e18);
        assertEq(usdt.balanceOf(COMPANY), 0.05e18);
        // another 10 -> reserve 540 > 50% of ~1059.94
        usdt.transfer(address(vault), 10e18);
        uint256 e = cur();
        vm.expectRevert(LiquidityVault.ReserveExceeded.selector);
        vault.receiveMargin(10e18, e);
        vm.stopPrank();
    }

    function test_receiveMarginRequiresFunds() public {
        lpDeposit(1000e18);
        uint256 e = cur();
        vm.prank(address(pool));
        vm.expectRevert(LiquidityVault.FundsNotReceived.selector);
        vault.receiveMargin(10e18, e);
    }

    function test_withdrawLimitedByLockedAndReserveExpires() public {
        lpDeposit(1000e18);
        usdt.mint(address(pool), 100e18);
        uint256 e = cur();
        vm.startPrank(address(pool));
        usdt.transfer(address(vault), 50e18);
        vault.receiveMargin(50e18, e);
        vm.stopPrank();
        // locked = 450 + 50 = 500; assets = 1049.95
        assertEq(vault.lockedAssets(), 500e18);
        vm.prank(lp);
        vm.expectRevert(LiquidityVault.InsufficientLiquidity.selector);
        vault.withdraw(600e18, lp);
        vm.prank(lp);
        vault.withdraw(500e18, lp);

        // bucket active through epoch e+17, expired at e+18
        vm.warp((e + 17) * EPOCH);
        assertEq(vault.activeReserve(), 450e18);
        vm.warp((e + 18) * EPOCH);
        assertEq(vault.activeReserve(), 0);
        uint256 rest = vault.balanceOf(lp);
        vm.prank(lp);
        vault.withdraw(rest, lp);
        assertEq(vault.totalSupply(), 0);
    }

    function test_payOutReleasesReserve() public {
        lpDeposit(1000e18);
        usdt.mint(address(pool), 100e18);
        uint256 e = cur();
        vm.startPrank(address(pool));
        usdt.transfer(address(vault), 50e18);
        vault.receiveMargin(50e18, e);
        vault.payOut(120e18, 50e18, e);
        vm.stopPrank();
        assertEq(vault.activeReserve(), 0);
        assertEq(usdt.balanceOf(address(pool)), 170e18);
    }

    function test_tvlCapAndPause() public {
        vm.prank(owner);
        vault.setTvlCap(500e18);
        vm.prank(lp);
        vm.expectRevert(LiquidityVault.CapExceeded.selector);
        vault.deposit(501e18, lp);
        lpDeposit(500e18);
        vm.prank(owner);
        vault.setPaused(true);
        vm.prank(lp);
        vm.expectRevert(LiquidityVault.IsPaused.selector);
        vault.deposit(1, lp);
        vm.prank(lp);
        vault.withdraw(100e18, lp); // withdrawals still work while paused
    }

    function test_metadata() public view {
        assertEq(vault.name(), "Parlo LP");
        assertEq(vault.symbol(), "PLP");
        assertEq(vault.treasury(), COMPANY);
    }
}
