// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {ParloPool} from "../src/ParloPool.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IAttentionOracle} from "../src/interfaces/IAttentionOracle.sol";
import {ILiquidityVault} from "../src/interfaces/ILiquidityVault.sol";
import {IVerifier7} from "../src/interfaces/IVerifier7.sol";
import {IVerifier56} from "../src/interfaces/IVerifier56.sol";
import {Ownable} from "../src/utils/Ownable.sol";

/// Verifier that only accepts one exact public-signal vector (to check what the pool builds).
contract ExpectingVerifier56 is IVerifier56 {
    bytes32 public expected;

    function expect(uint256[56] calldata pubs) external {
        expected = keccak256(abi.encode(pubs));
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[56] calldata pubs)
        external
        view
        returns (bool)
    {
        return keccak256(abi.encode(pubs)) == expected;
    }
}

contract ExpectingVerifier7 is IVerifier7 {
    bytes32 public expected;

    function expect(uint256[7] calldata pubs) external {
        expected = keccak256(abi.encode(pubs));
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[7] calldata pubs)
        external
        view
        returns (bool)
    {
        return keccak256(abi.encode(pubs)) == expected;
    }
}

contract ParloPoolTest is Base {
    event NewNote(uint256 commitment, uint256 index, bytes encryptedOutput);
    event NullifierSpent(uint256 nullifier);

    // ---------------------------------------------------------------- trees

    function test_initialTreeMatchesCircomlibZeros() public view {
        // Poseidon(0,0) from circomlibjs
        assertEq(pool.zeros(1), 14744269619966411208579211824598458697587494354926760081771325075741142829156);
        assertTrue(pool.noteRoot() != 0);
        assertEq(pool.noteRoot(), pool.positionRoot());
    }

    function test_rootHistory() public {
        uint256 r0 = pool.noteRoot();
        for (uint256 i; i < 15; ++i) {
            doDeposit(1e18); // 2 inserts each -> 30 roots
        }
        assertFalse(pool.isKnownNoteRoot(r0)); // pushed out of 30-root history
        assertTrue(pool.isKnownNoteRoot(pool.noteRoot()));
        assertFalse(pool.isKnownNoteRoot(0));
        assertEq(pool.nextNoteIndex(), 30);
    }

    // ---------------------------------------------------------------- transact

    function test_deposit() public {
        ParloPool.ExtData memory e = ext(address(0), int256(100e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        uint256 rootBefore = pool.noteRoot();
        vm.expectEmit(address(pool));
        emit NullifierSpent(a.inputNullifiers[0]);
        vm.expectEmit(address(pool));
        emit NullifierSpent(a.inputNullifiers[1]);
        vm.expectEmit(address(pool));
        emit NewNote(a.outputCommitments[0], 0, hex"aa01");
        vm.expectEmit(address(pool));
        emit NewNote(a.outputCommitments[1], 1, hex"bb02");
        vm.prank(alice);
        pool.transact(proof(), a, e);
        assertEq(usdt.balanceOf(address(pool)), 100e18);
        assertTrue(pool.noteRoot() != rootBefore);
        assertTrue(pool.isKnownNoteRoot(rootBefore));
        assertTrue(pool.nullifierSpent(a.inputNullifiers[0]));
    }

    function test_withdrawWithRelayerFee() public {
        doDeposit(100e18);
        ParloPool.ExtData memory e = ext(bob, -int256(40e18), relayer, 1e18);
        ParloPool.TransactArgs memory a = targs(e);
        assertEq(a.publicAmount, P - 41e18);
        vm.prank(relayer);
        pool.transact(proof(), a, e);
        assertEq(usdt.balanceOf(bob), 40e18);
        assertEq(usdt.balanceOf(relayer), 1e18);
        assertEq(usdt.balanceOf(address(pool)), 59e18);
    }

    function test_privateTransferPaysRelayer() public {
        doDeposit(10e18);
        ParloPool.ExtData memory e = ext(address(0), 0, relayer, 0.5e18);
        ParloPool.TransactArgs memory a = targs(e);
        pool.transact(proof(), a, e);
        assertEq(usdt.balanceOf(relayer), 0.5e18);
    }

    function test_doubleSpendReverts() public {
        ParloPool.TransactArgs memory a = doDeposit(10e18);
        ParloPool.ExtData memory e = ext(bob, -int256(5e18), address(0), 0);
        ParloPool.TransactArgs memory b = targs(e);
        b.inputNullifiers[0] = a.inputNullifiers[0];
        vm.expectRevert(ParloPool.AlreadySpent.selector);
        pool.transact(proof(), b, e);
    }

    function test_duplicateNullifierInSameTxReverts() public {
        ParloPool.ExtData memory e = ext(address(0), int256(1e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        a.inputNullifiers[1] = a.inputNullifiers[0];
        vm.prank(alice);
        vm.expectRevert(ParloPool.DuplicateNullifier.selector);
        pool.transact(proof(), a, e);
    }

    function test_nullifierAliasingAboveFieldReverts() public {
        ParloPool.TransactArgs memory a = doDeposit(10e18);
        ParloPool.ExtData memory e = ext(bob, -int256(5e18), address(0), 0);
        ParloPool.TransactArgs memory b = targs(e);
        b.inputNullifiers[0] = a.inputNullifiers[0] + P;
        vm.expectRevert(ParloPool.InputNotInField.selector);
        pool.transact(proof(), b, e);
    }

    function test_fieldChecksOnAllTransactInputs() public {
        ParloPool.ExtData memory e = ext(address(0), int256(1e18), address(0), 0);
        for (uint256 i; i < 7; ++i) {
            ParloPool.TransactArgs memory a = targs(e);
            if (i == 0) a.root = P;
            if (i == 1) a.publicAmount = P;
            if (i == 2) a.extDataHash = P;
            if (i == 3) a.inputNullifiers[0] = P;
            if (i == 4) a.inputNullifiers[1] = P;
            if (i == 5) a.outputCommitments[0] = P;
            if (i == 6) a.outputCommitments[1] = P;
            vm.prank(alice);
            vm.expectRevert(ParloPool.InputNotInField.selector);
            pool.transact(proof(), a, e);
        }
    }

    function test_unknownRootReverts() public {
        ParloPool.ExtData memory e = ext(address(0), int256(1e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        a.root = 12345;
        vm.prank(alice);
        vm.expectRevert(ParloPool.UnknownRoot.selector);
        pool.transact(proof(), a, e);
    }

    function test_extDataTamperingReverts() public {
        doDeposit(10e18);
        ParloPool.ExtData memory e = ext(bob, -int256(5e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        e.recipient = relayer; // front-runner swaps recipient
        vm.expectRevert(ParloPool.InvalidExtDataHash.selector);
        pool.transact(proof(), a, e);
    }

    function test_publicAmountMismatchReverts() public {
        doDeposit(10e18);
        ParloPool.ExtData memory e = ext(bob, -int256(5e18), relayer, 1e18);
        ParloPool.TransactArgs memory a = targs(e);
        a.publicAmount = P - 5e18; // ignores fee
        vm.expectRevert(ParloPool.InvalidPublicAmount.selector);
        pool.transact(proof(), a, e);
    }

    function test_feeRequiresRelayer() public {
        ParloPool.ExtData memory e = ext(address(0), int256(5e18), address(0), 1e18);
        ParloPool.TransactArgs memory a = targs(e);
        vm.prank(alice);
        vm.expectRevert(ParloPool.InvalidFee.selector);
        pool.transact(proof(), a, e);
    }

    function test_invalidProofReverts() public {
        tv.setResult(false);
        ParloPool.ExtData memory e = ext(address(0), int256(1e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        vm.prank(alice);
        vm.expectRevert(ParloPool.InvalidProof.selector);
        pool.transact(proof(), a, e);
    }

    function test_transactPublicSignalOrder() public {
        ExpectingVerifier7 ev = new ExpectingVerifier7();
        ParloPool p2 = new ParloPool(
            owner,
            IERC20(address(usdt)),
            IAttentionOracle(address(oracle)),
            ILiquidityVault(address(vault)),
            IVerifier7(address(ev)),
            IVerifier7(address(ov)),
            IVerifier56(address(cv))
        );
        ParloPool.ExtData memory e = ext(address(0), int256(1e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        a.root = p2.noteRoot();
        ev.expect(
            [
                a.root,
                a.publicAmount,
                a.extDataHash,
                a.inputNullifiers[0],
                a.inputNullifiers[1],
                a.outputCommitments[0],
                a.outputCommitments[1]
            ]
        );
        vm.startPrank(alice);
        usdt.approve(address(p2), type(uint256).max);
        p2.transact(proof(), a, e);
        vm.stopPrank();
    }

    function test_depositCapAndTvlCap() public {
        vm.prank(owner);
        pool.setLimits(50e18, 120e18, 1e18, 1);
        ParloPool.ExtData memory e = ext(address(0), int256(51e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        vm.prank(alice);
        vm.expectRevert(ParloPool.DepositCapExceeded.selector);
        pool.transact(proof(), a, e);
        doDeposit(50e18);
        doDeposit(50e18);
        e = ext(address(0), int256(21e18), address(0), 0);
        a = targs(e);
        vm.prank(alice);
        vm.expectRevert(ParloPool.TvlCapExceeded.selector);
        pool.transact(proof(), a, e);
    }

    function test_pauseBlocksDepositsAndOpensButNotWithdrawals() public {
        doDeposit(100e18);
        lpDeposit(10_000e18);
        push(1, 1_000_000);
        vm.prank(owner);
        pool.setPaused(true);

        ParloPool.ExtData memory e = ext(address(0), int256(1e18), address(0), 0);
        ParloPool.TransactArgs memory a = targs(e);
        vm.prank(alice);
        vm.expectRevert(ParloPool.IsPaused.selector);
        pool.transact(proof(), a, e);

        ParloPool.OpenArgs memory o = oargs(1, 10e18);
        vm.expectRevert(ParloPool.IsPaused.selector);
        pool.openPosition(proof(), o, "", "");

        e = ext(bob, -int256(10e18), address(0), 0);
        a = targs(e);
        pool.transact(proof(), a, e);
        assertEq(usdt.balanceOf(bob), 10e18);
    }

    function test_onlyOwnerAdmin() public {
        vm.prank(alice);
        vm.expectRevert(Ownable.NotOwner.selector);
        pool.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(Ownable.NotOwner.selector);
        pool.setLimits(1, 1, 1, 1);
    }

    // ---------------------------------------------------------------- open / close

    function _open(uint256 margin) internal returns (uint256 entry) {
        entry = cur();
        ParloPool.OpenArgs memory o = oargs(1, margin);
        pool.openPosition(proof(), o, hex"c0", hex"d0");
    }

    function _setupMarket() internal {
        doDeposit(1000e18);
        lpDeposit(10_000e18);
        push(1, 1_000_000);
    }

    function test_openMovesMarginToVault() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        assertEq(usdt.balanceOf(address(pool)), 900e18);
        assertEq(usdt.balanceOf(address(vault)), 10_100e18 - 0.1e18);
        assertEq(usdt.balanceOf(COMPANY), 0.1e18);
        assertEq(vault.reserveOf(entry), 900e18);
        assertEq(pool.nextPositionIndex(), 1);
        assertEq(pool.nextNoteIndex(), 3);
    }

    function test_openChecks() public {
        _setupMarket();
        ParloPool.OpenArgs memory o = oargs(1, 100e18);
        o.epoch = cur() - 1;
        vm.expectRevert(ParloPool.WrongEpoch.selector);
        pool.openPosition(proof(), o, "", "");

        o = oargs(2, 100e18); // market 2 has no value
        vm.expectRevert(ParloPool.StaleOracle.selector);
        pool.openPosition(proof(), o, "", "");

        o = oargs(9, 100e18);
        vm.expectRevert(ParloPool.UnknownMarket.selector);
        pool.openPosition(proof(), o, "", "");

        o = oargs(1, 0.5e18);
        vm.expectRevert(ParloPool.InvalidMargin.selector);
        pool.openPosition(proof(), o, "", "");

        o = oargs(1, 100e18);
        o.margin = P;
        vm.expectRevert(ParloPool.InputNotInField.selector);
        pool.openPosition(proof(), o, "", "");

        // stale oracle: 2 epochs without push
        nextEpoch();
        nextEpoch();
        o = oargs(1, 100e18);
        vm.expectRevert(ParloPool.StaleOracle.selector);
        pool.openPosition(proof(), o, "", "");
    }

    function test_openDoubleSpendReverts() public {
        _setupMarket();
        ParloPool.OpenArgs memory o = oargs(1, 10e18);
        pool.openPosition(proof(), o, "", "");
        ParloPool.OpenArgs memory o2 = oargs(1, 10e18);
        o2.inNullifier = o.inNullifier;
        vm.expectRevert(ParloPool.AlreadySpent.selector);
        pool.openPosition(proof(), o2, "", "");
    }

    function test_openRevertsWhenVaultReserveExceeded() public {
        doDeposit(1000e18);
        lpDeposit(1000e18);
        push(1, 1_000_000);
        ParloPool.OpenArgs memory o = oargs(1, 100e18); // reserve 900 > 50% of 1100
        vm.expectRevert(LiquidityVault.ReserveExceeded.selector);
        pool.openPosition(proof(), o, "", "");
    }

    function test_openCloseFlowMovesFunds() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        push(1, 1_050_000);
        nextEpoch();
        push(1, 1_100_000);
        nextEpoch(); // entry+2: offsets 1 finalized
        push(1, 1_150_000);

        uint256 poolBefore = usdt.balanceOf(address(pool));
        uint256 vaultAssetsBefore = vault.totalAssets();
        ParloPool.CloseArgs memory c = cargs(1, 100e18, entry, 1, 250e18);
        pool.closePosition(proof(), c, hex"e0");
        assertEq(usdt.balanceOf(address(pool)), poolBefore + 250e18);
        assertEq(vault.totalAssets(), vaultAssetsBefore - 250e18);
        assertEq(vault.reserveOf(entry), 0);
        assertTrue(pool.positionNullifierSpent(c.positionNullifier));
        assertEq(pool.nextNoteIndex(), 4);

        // position double-close
        ParloPool.CloseArgs memory c2 = cargs(1, 100e18, entry, 1, 250e18);
        c2.positionNullifier = c.positionNullifier;
        vm.expectRevert(ParloPool.AlreadySpent.selector);
        pool.closePosition(proof(), c2, "");
    }

    function test_zeroPayoutCloseReleasesReserve() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        nextEpoch();
        push(1, 1_000_000);
        nextEpoch();
        pool.closePosition(proof(), cargs(1, 100e18, entry, 1, 0), "");
        assertEq(vault.reserveOf(entry), 0);
    }

    function test_closePublicSignalsBuiltFromOracle() public {
        ExpectingVerifier56 ev = new ExpectingVerifier56();
        LiquidityVault v2 = new LiquidityVault(owner, IERC20(address(usdt)), IAttentionOracle(address(oracle)), COMPANY);
        ParloPool p2 = new ParloPool(
            owner,
            IERC20(address(usdt)),
            IAttentionOracle(address(oracle)),
            ILiquidityVault(address(v2)),
            IVerifier7(address(tv)),
            IVerifier7(address(ov)),
            IVerifier56(address(ev))
        );
        vm.prank(owner);
        v2.setPool(address(p2));
        vm.prank(lp);
        usdt.approve(address(v2), type(uint256).max);
        vm.prank(lp);
        v2.deposit(10_000e18, lp);

        push(1, 1_000_000);
        uint256 entry = cur();
        push(1, 1_010_000); // entry close 1_010_000, low 1_000_000, high 1_010_000
        usdt.mint(address(p2), 100e18);
        ParloPool.OpenArgs memory o = ParloPool.OpenArgs(p2.noteRoot(), 1, 2, 3, 1, 100e18, entry);
        p2.openPosition(proof(), o, "", "");
        nextEpoch();
        push(1, 1_100_000);
        push(1, 990_000);
        nextEpoch();
        push(1, 1_050_000); // entry+2 unfinalized

        ParloPool.CloseArgs memory c = ParloPool.CloseArgs(p2.positionRoot(), 7, 8, 1, 100e18, entry, 1, 150e18);
        uint256[56] memory pubs;
        pubs[0] = c.positionRoot;
        pubs[1] = 7;
        pubs[2] = 8;
        pubs[3] = 1;
        pubs[4] = 100e18;
        pubs[5] = entry;
        pubs[6] = 1;
        pubs[7] = 150e18;
        pubs[8] = 1_010_000; // closes[0]
        pubs[9] = 990_000; // closes[1]
        pubs[24] = 1_000_000; // lows[0]
        pubs[25] = 990_000; // lows[1]
        pubs[40] = 1_010_000; // highs[0]
        pubs[41] = 1_100_000; // highs[1]
        ev.expect(pubs);
        p2.closePosition(proof(), c, "");
        assertEq(usdt.balanceOf(address(p2)), 150e18);
    }

    function test_closeOffsetBounds() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        nextEpoch();
        push(1, 1_000_000);
        nextEpoch();
        // offset 0
        {
            ParloPool.CloseArgs memory ca = cargs(1, 100e18, entry, 0, 0);
            vm.expectRevert(ParloPool.InvalidCloseOffset.selector);
            pool.closePosition(proof(), ca, "");
        }
        // offset 16
        {
            ParloPool.CloseArgs memory ca = cargs(1, 100e18, entry, 16, 0);
            vm.expectRevert(ParloPool.InvalidCloseOffset.selector);
            pool.closePosition(proof(), ca, "");
        }
        // offset 2 not yet finalized (cur = entry + 2)
        {
            ParloPool.CloseArgs memory ca = cargs(1, 100e18, entry, 2, 0);
            vm.expectRevert(ParloPool.ExitNotFinalized.selector);
            pool.closePosition(proof(), ca, "");
        }
    }

    function test_closeRejectsHindsightOffset() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        for (uint256 i; i < 6; ++i) {
            nextEpoch();
            push(1, 1_000_000 + i * 10_000);
        }
        // cur = entry + 6, latest finalized offset = 5, grace 1 => offsets 4..5 allowed
        assertEq(pool.latestCloseOffset(entry), 5);
        {
            ParloPool.CloseArgs memory ca = cargs(1, 100e18, entry, 3, 0);
            vm.expectRevert(ParloPool.InvalidCloseOffset.selector);
            pool.closePosition(proof(), ca, "");
        }
        pool.closePosition(proof(), cargs(1, 100e18, entry, 4, 0), "");
    }

    function test_closeDeadline() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        // reporter keeps pushing; jump to entry + 17 (last valid epoch)
        vm.warp((entry + 17) * EPOCH);
        push(1, 1_000_000);
        uint256 snap = vm.snapshotState();
        pool.closePosition(proof(), cargs(1, 100e18, entry, 15, 0), "");
        vm.revertToState(snap);
        vm.warp((entry + 18) * EPOCH);
        {
            ParloPool.CloseArgs memory ca = cargs(1, 100e18, entry, 15, 0);
            vm.expectRevert(ParloPool.CloseDeadlinePassed.selector);
            pool.closePosition(proof(), ca, "");
        }
    }

    function test_closeChecks() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        nextEpoch();
        nextEpoch();
        ParloPool.CloseArgs memory c = cargs(1, 100e18, entry, 1, 1000e18 + 1);
        vm.expectRevert(ParloPool.PayoutTooLarge.selector);
        pool.closePosition(proof(), c, "");

        c = cargs(1, 100e18, entry, 1, 0);
        c.positionRoot = 42;
        vm.expectRevert(ParloPool.UnknownRoot.selector);
        pool.closePosition(proof(), c, "");

        c = cargs(1, 100e18, entry, 1, 0);
        c.payout = P;
        vm.expectRevert(ParloPool.InputNotInField.selector);
        pool.closePosition(proof(), c, "");

        c = cargs(1, 100e18, entry + 3, 1, 0);
        vm.expectRevert(ParloPool.CloseDeadlinePassed.selector);
        pool.closePosition(proof(), c, "");

        cv.setResult(false);
        {
            ParloPool.CloseArgs memory ca = cargs(1, 100e18, entry, 1, 0);
            vm.expectRevert(ParloPool.InvalidProof.selector);
            pool.closePosition(proof(), ca, "");
        }
    }

    function test_closeWorksWhilePaused() public {
        _setupMarket();
        uint256 entry = _open(100e18);
        nextEpoch();
        nextEpoch();
        vm.prank(owner);
        pool.setPaused(true);
        pool.closePosition(proof(), cargs(1, 100e18, entry, 1, 110e18), "");
    }

    function test_hashExtDataMatchesSpec() public view {
        ParloPool.ExtData memory e = ext(bob, -5, relayer, 3);
        assertEq(this.callHash(e), hashExt(e));
        assertEq(pool.calculatePublicAmount(-5, 3), P - 8);
        assertEq(pool.calculatePublicAmount(10, 3), 7);
    }

    function callHash(ParloPool.ExtData calldata e) external view returns (uint256) {
        return pool.hashExtData(e);
    }
}
