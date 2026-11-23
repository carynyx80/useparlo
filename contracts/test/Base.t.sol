// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AttentionOracle} from "../src/AttentionOracle.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";
import {ParloPool} from "../src/ParloPool.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {MockVerifier7} from "../src/mocks/MockVerifier7.sol";
import {MockVerifier56} from "../src/mocks/MockVerifier56.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IAttentionOracle} from "../src/interfaces/IAttentionOracle.sol";
import {ILiquidityVault} from "../src/interfaces/ILiquidityVault.sol";
import {IVerifier7} from "../src/interfaces/IVerifier7.sol";
import {IVerifier56} from "../src/interfaces/IVerifier56.sol";

abstract contract Base is Test {
    uint256 constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant EPOCH = 300;
    address constant COMPANY = 0xB34296465F18F55003100e925aBc70656E224035;

    address owner = COMPANY;
    address reporter = makeAddr("reporter");
    address lp = makeAddr("lp");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address relayer = makeAddr("relayer");

    MockUSDT usdt;
    AttentionOracle oracle;
    LiquidityVault vault;
    ParloPool pool;
    MockVerifier7 tv;
    MockVerifier7 ov;
    MockVerifier56 cv;

    uint256 nextFake = 1000;

    function setUp() public virtual {
        vm.warp(1_000_000 * EPOCH + 10);
        usdt = new MockUSDT();
        oracle = new AttentionOracle(owner, EPOCH);
        vault = new LiquidityVault(owner, IERC20(address(usdt)), IAttentionOracle(address(oracle)), COMPANY);
        tv = new MockVerifier7();
        ov = new MockVerifier7();
        cv = new MockVerifier56();
        pool = new ParloPool(
            owner,
            IERC20(address(usdt)),
            IAttentionOracle(address(oracle)),
            ILiquidityVault(address(vault)),
            IVerifier7(address(tv)),
            IVerifier7(address(ov)),
            IVerifier56(address(cv))
        );
        vm.startPrank(owner);
        vault.setPool(address(pool));
        oracle.setReporter(reporter, true);
        oracle.addMarket(1, "$BNB");
        oracle.addMarket(2, "$PEPE");
        vm.stopPrank();

        usdt.mint(lp, 1_000_000e18);
        usdt.mint(alice, 1_000_000e18);
        vm.prank(lp);
        usdt.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        usdt.approve(address(pool), type(uint256).max);
    }

    // ---------------------------------------------------------------- helpers

    function fake() internal returns (uint256) {
        return ++nextFake;
    }

    function proof() internal pure returns (ParloPool.Proof memory p) {}

    function push(uint256 market, uint256 v) internal {
        vm.prank(reporter);
        oracle.push(market, v);
    }

    function nextEpoch() internal {
        vm.warp(block.timestamp + EPOCH);
    }

    function cur() internal view returns (uint256) {
        return oracle.currentEpoch();
    }

    function ext(address recipient, int256 extAmount, address rel, uint256 fee)
        internal
        pure
        returns (ParloPool.ExtData memory e)
    {
        e = ParloPool.ExtData(recipient, extAmount, rel, fee, hex"aa01", hex"bb02");
    }

    function hashExt(ParloPool.ExtData memory e) internal pure returns (uint256) {
        return uint256(
            keccak256(abi.encode(e.recipient, e.extAmount, e.relayer, e.fee, e.encryptedOutput0, e.encryptedOutput1))
        ) % P;
    }

    function pubAmount(int256 extAmount, uint256 fee) internal pure returns (uint256) {
        int256 x = extAmount - int256(fee);
        return x >= 0 ? uint256(x) : P - uint256(-x);
    }

    function targs(ParloPool.ExtData memory e) internal returns (ParloPool.TransactArgs memory a) {
        a.root = pool.noteRoot();
        a.publicAmount = pubAmount(e.extAmount, e.fee);
        a.extDataHash = hashExt(e);
        a.inputNullifiers = [fake(), fake()];
        a.outputCommitments = [fake(), fake()];
    }

    function doDeposit(uint256 amount) internal returns (ParloPool.TransactArgs memory a) {
        ParloPool.ExtData memory e = ext(address(0), int256(amount), address(0), 0);
        a = targs(e);
        vm.prank(alice);
        pool.transact(proof(), a, e);
    }

    function lpDeposit(uint256 amount) internal {
        vm.prank(lp);
        vault.deposit(amount, lp);
    }

    function oargs(uint256 market, uint256 margin) internal returns (ParloPool.OpenArgs memory a) {
        a = ParloPool.OpenArgs({
            root: pool.noteRoot(),
            inNullifier: fake(),
            changeCommitment: fake(),
            positionCommitment: fake(),
            marketId: market,
            margin: margin,
            epoch: cur()
        });
    }

    function cargs(uint256 market, uint256 margin, uint256 entryEpoch, uint256 offset, uint256 payout)
        internal
        returns (ParloPool.CloseArgs memory a)
    {
        a = ParloPool.CloseArgs({
            positionRoot: pool.positionRoot(),
            positionNullifier: fake(),
            outCommitment: fake(),
            marketId: market,
            margin: margin,
            entryEpoch: entryEpoch,
            closeOffset: offset,
            payout: payout
        });
    }
}
