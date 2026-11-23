// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "./utils/Ownable.sol";
import {ReentrancyGuard} from "./utils/ReentrancyGuard.sol";
import {SafeTransfer} from "./utils/SafeTransfer.sol";
import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IVerifier7} from "./interfaces/IVerifier7.sol";
import {IVerifier56} from "./interfaces/IVerifier56.sol";
import {IAttentionOracle} from "./interfaces/IAttentionOracle.sol";
import {ILiquidityVault} from "./interfaces/ILiquidityVault.sol";

/// @title ParloPool
/// @notice Shielded USDT pool + private attention-perp positions. Holds trader USDT; margin of open positions lives in
///         the LiquidityVault. Public-input orders follow SPEC.md exactly.
contract ParloPool is Ownable, ReentrancyGuard {
    using SafeTransfer for IERC20;
    using MerkleTreeWithHistory for MerkleTreeWithHistory.Tree;

    // ------------------------------------------------------------------ constants

    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    int256 public constant MAX_EXT_AMOUNT = 2 ** 248;
    uint256 public constant MAX_FEE = 2 ** 248;
    uint256 public constant MAX_AMOUNT = 2 ** 128; // circuits range-check amounts to 128 bits
    uint256 public constant WINDOW = 16;
    uint256 public constant CLOSE_DEADLINE = WINDOW + 2; // close must happen while currentEpoch < entryEpoch + 18
    uint256 public constant MAX_CLOSE_OFFSET = 15;
    uint256 public constant MAX_PAYOUT_MULTIPLE = 10;
    uint256 public constant MAX_ORACLE_STALENESS = 1; // epochs

    // ------------------------------------------------------------------ types

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    struct ExtData {
        address recipient;
        int256 extAmount;
        address relayer;
        uint256 fee;
        bytes encryptedOutput0;
        bytes encryptedOutput1;
    }

    /// transact public inputs: [root, publicAmount, extDataHash, inNullifier0, inNullifier1, outCommitment0, outCommitment1]
    struct TransactArgs {
        uint256 root;
        uint256 publicAmount;
        uint256 extDataHash;
        uint256[2] inputNullifiers;
        uint256[2] outputCommitments;
    }

    /// open public inputs: [root, inNullifier, changeCommitment, positionCommitment, marketId, margin, epoch]
    struct OpenArgs {
        uint256 root;
        uint256 inNullifier;
        uint256 changeCommitment;
        uint256 positionCommitment;
        uint256 marketId;
        uint256 margin;
        uint256 epoch;
    }

    /// close public inputs: [positionRoot, positionNullifier, outCommitment, marketId, margin, entryEpoch, closeOffset,
    ///                       payout, closes[0..15], lows[0..15], highs[0..15]]
    struct CloseArgs {
        uint256 positionRoot;
        uint256 positionNullifier;
        uint256 outCommitment;
        uint256 marketId;
        uint256 margin;
        uint256 entryEpoch;
        uint256 closeOffset;
        uint256 payout;
    }

    // ------------------------------------------------------------------ storage

    IERC20 public immutable token;
    IAttentionOracle public immutable oracle;
    ILiquidityVault public immutable vault;
    IVerifier7 public immutable transactVerifier;
    IVerifier7 public immutable openVerifier;
    IVerifier56 public immutable closeVerifier;

    MerkleTreeWithHistory.Tree internal noteTree;
    MerkleTreeWithHistory.Tree internal positionTree;

    mapping(uint256 => bool) public nullifierSpent; // balance-note nullifiers
    mapping(uint256 => bool) public positionNullifierSpent; // position nullifiers

    bool public paused;
    uint256 public maxDepositPerTx; // 0 = unlimited
    uint256 public tvlCap; // 0 = unlimited; caps USDT held by the pool
    uint256 public minMargin;
    uint256 public closeGraceEpochs = 1; // closeOffset may lag the latest finalized offset by this many epochs

    // ------------------------------------------------------------------ events

    event NewNote(uint256 commitment, uint256 index, bytes encryptedOutput);
    event NewPosition(uint256 commitment, uint256 index, bytes encryptedOutput);
    event NullifierSpent(uint256 nullifier);
    event PositionOpened(uint256 indexed marketId, uint256 indexed epoch, uint256 margin, uint256 positionIndex);
    event PositionClosed(
        uint256 indexed marketId, uint256 indexed entryEpoch, uint256 margin, uint256 closeOffset, uint256 payout
    );
    event Paused(bool paused);
    event LimitsSet(uint256 maxDepositPerTx, uint256 tvlCap, uint256 minMargin, uint256 closeGraceEpochs);

    // ------------------------------------------------------------------ errors

    error IsPaused();
    error InputNotInField();
    error UnknownRoot();
    error AlreadySpent();
    error DuplicateNullifier();
    error InvalidProof();
    error InvalidExtAmount();
    error InvalidFee();
    error InvalidPublicAmount();
    error InvalidExtDataHash();
    error DepositCapExceeded();
    error TvlCapExceeded();
    error InvalidRecipient();
    error UnknownMarket();
    error StaleOracle();
    error WrongEpoch();
    error InvalidMargin();
    error InvalidCloseOffset();
    error CloseDeadlinePassed();
    error ExitNotFinalized();
    error PayoutTooLarge();
    error InvalidLimits();

    constructor(
        address initialOwner,
        IERC20 token_,
        IAttentionOracle oracle_,
        ILiquidityVault vault_,
        IVerifier7 transactVerifier_,
        IVerifier7 openVerifier_,
        IVerifier56 closeVerifier_
    ) Ownable(initialOwner) {
        if (
            address(token_) == address(0) || address(oracle_) == address(0) || address(vault_) == address(0)
                || address(transactVerifier_) == address(0) || address(openVerifier_) == address(0)
                || address(closeVerifier_) == address(0)
        ) revert ZeroAddress();
        token = token_;
        oracle = oracle_;
        vault = vault_;
        transactVerifier = transactVerifier_;
        openVerifier = openVerifier_;
        closeVerifier = closeVerifier_;

        noteTree.init();
        positionTree.init();

        // guarded-launch defaults (18-decimal USDT)
        maxDepositPerTx = 10_000e18;
        tvlCap = 250_000e18;
        minMargin = 1e18;
    }

    // ------------------------------------------------------------------ admin

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function setLimits(uint256 maxDepositPerTx_, uint256 tvlCap_, uint256 minMargin_, uint256 closeGraceEpochs_)
        external
        onlyOwner
    {
        if (minMargin_ == 0 || minMargin_ >= MAX_AMOUNT || closeGraceEpochs_ > 2) revert InvalidLimits();
        maxDepositPerTx = maxDepositPerTx_;
        tvlCap = tvlCap_;
        minMargin = minMargin_;
        closeGraceEpochs = closeGraceEpochs_;
        emit LimitsSet(maxDepositPerTx_, tvlCap_, minMargin_, closeGraceEpochs_);
    }

    // ------------------------------------------------------------------ transact

    /// @notice 2-in/2-out join-split: deposit (extAmount > 0), withdraw (extAmount < 0) or private transfer (0).
    function transact(Proof calldata proof, TransactArgs calldata args, ExtData calldata ext) external nonReentrant {
        // ---- checks
        _checkField(args.root);
        _checkField(args.publicAmount);
        _checkField(args.extDataHash);
        _checkField(args.inputNullifiers[0]);
        _checkField(args.inputNullifiers[1]);
        _checkField(args.outputCommitments[0]);
        _checkField(args.outputCommitments[1]);

        if (!noteTree.isKnownRoot(args.root)) revert UnknownRoot();
        if (args.inputNullifiers[0] == args.inputNullifiers[1]) revert DuplicateNullifier();
        if (nullifierSpent[args.inputNullifiers[0]] || nullifierSpent[args.inputNullifiers[1]]) revert AlreadySpent();

        if (ext.extAmount <= -MAX_EXT_AMOUNT || ext.extAmount >= MAX_EXT_AMOUNT) revert InvalidExtAmount();
        if (ext.fee >= MAX_FEE) revert InvalidFee();
        if (ext.fee != 0 && ext.relayer == address(0)) revert InvalidFee();
        if (args.extDataHash != hashExtData(ext)) revert InvalidExtDataHash();
        if (args.publicAmount != calculatePublicAmount(ext.extAmount, ext.fee)) revert InvalidPublicAmount();

        if (ext.extAmount > 0) {
            if (paused) revert IsPaused();
            uint256 dep = uint256(ext.extAmount);
            if (maxDepositPerTx != 0 && dep > maxDepositPerTx) revert DepositCapExceeded();
            if (tvlCap != 0 && token.balanceOf(address(this)) + dep > tvlCap) revert TvlCapExceeded();
        } else if (ext.extAmount < 0) {
            if (ext.recipient == address(0)) revert InvalidRecipient();
        }

        uint256[7] memory pubs = [
            args.root,
            args.publicAmount,
            args.extDataHash,
            args.inputNullifiers[0],
            args.inputNullifiers[1],
            args.outputCommitments[0],
            args.outputCommitments[1]
        ];
        if (!transactVerifier.verifyProof(proof.a, proof.b, proof.c, pubs)) revert InvalidProof();

        // ---- effects
        nullifierSpent[args.inputNullifiers[0]] = true;
        nullifierSpent[args.inputNullifiers[1]] = true;
        emit NullifierSpent(args.inputNullifiers[0]);
        emit NullifierSpent(args.inputNullifiers[1]);

        uint32 i0 = noteTree.insert(args.outputCommitments[0]);
        uint32 i1 = noteTree.insert(args.outputCommitments[1]);
        emit NewNote(args.outputCommitments[0], i0, ext.encryptedOutput0);
        emit NewNote(args.outputCommitments[1], i1, ext.encryptedOutput1);

        // ---- interactions
        if (ext.extAmount > 0) {
            token.safeTransferFrom(msg.sender, address(this), uint256(ext.extAmount));
        } else if (ext.extAmount < 0) {
            token.safeTransfer(ext.recipient, uint256(-ext.extAmount));
        }
        if (ext.fee != 0) {
            token.safeTransfer(ext.relayer, ext.fee);
        }
    }

    // ------------------------------------------------------------------ positions

    /// @notice Spend a balance note to open a private position. Margin USDT moves to the vault.
    function openPosition(
        Proof calldata proof,
        OpenArgs calldata args,
        bytes calldata encryptedChange,
        bytes calldata encryptedPosition
    ) external nonReentrant {
        if (paused) revert IsPaused();
        _checkField(args.root);
        _checkField(args.inNullifier);
        _checkField(args.changeCommitment);
        _checkField(args.positionCommitment);
        _checkField(args.marketId);
        _checkField(args.margin);
        _checkField(args.epoch);

        if (!noteTree.isKnownRoot(args.root)) revert UnknownRoot();
        if (nullifierSpent[args.inNullifier]) revert AlreadySpent();

        if (!oracle.marketExists(args.marketId)) revert UnknownMarket();
        uint256 cur = oracle.currentEpoch();
        if (args.epoch != cur) revert WrongEpoch();
        (uint256 lastValue, uint256 lastEpoch) = oracle.latest(args.marketId);
        if (lastValue == 0 || lastEpoch + MAX_ORACLE_STALENESS < cur) revert StaleOracle();
        if (args.margin < minMargin || args.margin >= MAX_AMOUNT) revert InvalidMargin();

        uint256[7] memory pubs = [
            args.root,
            args.inNullifier,
            args.changeCommitment,
            args.positionCommitment,
            args.marketId,
            args.margin,
            args.epoch
        ];
        if (!openVerifier.verifyProof(proof.a, proof.b, proof.c, pubs)) revert InvalidProof();

        // effects
        nullifierSpent[args.inNullifier] = true;
        emit NullifierSpent(args.inNullifier);
        uint32 ci = noteTree.insert(args.changeCommitment);
        emit NewNote(args.changeCommitment, ci, encryptedChange);
        uint32 pi = positionTree.insert(args.positionCommitment);
        emit NewPosition(args.positionCommitment, pi, encryptedPosition);
        emit PositionOpened(args.marketId, args.epoch, args.margin, pi);

        // interactions (vault enforces the reserve limit and reverts the whole tx if exceeded)
        token.safeTransfer(address(vault), args.margin);
        vault.receiveMargin(args.margin, args.epoch);
    }

    /// @notice Close a position against the oracle's finalized window. Payout USDT moves vault -> pool as a new note.
    function closePosition(Proof calldata proof, CloseArgs calldata args, bytes calldata encryptedOutput)
        external
        nonReentrant
    {
        _checkField(args.positionRoot);
        _checkField(args.positionNullifier);
        _checkField(args.outCommitment);
        _checkField(args.marketId);
        _checkField(args.margin);
        _checkField(args.entryEpoch);
        _checkField(args.closeOffset);
        _checkField(args.payout);

        if (!positionTree.isKnownRoot(args.positionRoot)) revert UnknownRoot();
        if (positionNullifierSpent[args.positionNullifier]) revert AlreadySpent();
        if (args.margin == 0 || args.margin >= MAX_AMOUNT) revert InvalidMargin();
        if (args.payout > args.margin * MAX_PAYOUT_MULTIPLE) revert PayoutTooLarge();

        uint256 cur = oracle.currentEpoch();
        if (args.entryEpoch > cur || cur >= args.entryEpoch + CLOSE_DEADLINE) revert CloseDeadlinePassed();
        if (args.closeOffset == 0 || args.closeOffset > MAX_CLOSE_OFFSET) revert InvalidCloseOffset();
        if (args.entryEpoch + args.closeOffset >= cur) revert ExitNotFinalized();
        // anti-hindsight: exit must be (close to) the latest finalized epoch, not a cherry-picked past one
        uint256 latestOffset = cur - args.entryEpoch - 1;
        if (latestOffset > MAX_CLOSE_OFFSET) latestOffset = MAX_CLOSE_OFFSET;
        if (args.closeOffset + closeGraceEpochs < latestOffset) revert InvalidCloseOffset();

        (uint256[16] memory closes, uint256[16] memory lows, uint256[16] memory highs) =
            oracle.getWindow(args.marketId, args.entryEpoch);
        if (closes[0] == 0 || closes[args.closeOffset] == 0) revert ExitNotFinalized();

        uint256[56] memory pubs;
        pubs[0] = args.positionRoot;
        pubs[1] = args.positionNullifier;
        pubs[2] = args.outCommitment;
        pubs[3] = args.marketId;
        pubs[4] = args.margin;
        pubs[5] = args.entryEpoch;
        pubs[6] = args.closeOffset;
        pubs[7] = args.payout;
        for (uint256 i; i < WINDOW; ++i) {
            pubs[8 + i] = closes[i];
            pubs[24 + i] = lows[i];
            pubs[40 + i] = highs[i];
        }
        if (!closeVerifier.verifyProof(proof.a, proof.b, proof.c, pubs)) revert InvalidProof();

        // effects
        positionNullifierSpent[args.positionNullifier] = true;
        emit NullifierSpent(args.positionNullifier);
        uint32 idx = noteTree.insert(args.outCommitment);
        emit NewNote(args.outCommitment, idx, encryptedOutput);
        emit PositionClosed(args.marketId, args.entryEpoch, args.margin, args.closeOffset, args.payout);

        // interactions: vault transfers payout to this pool (always called so the reserve is released)
        vault.payOut(args.payout, args.margin, args.entryEpoch);
    }

    // ------------------------------------------------------------------ views / helpers

    function hashExtData(ExtData calldata ext) public pure returns (uint256) {
        return uint256(
            keccak256(
                abi.encode(
                    ext.recipient, ext.extAmount, ext.relayer, ext.fee, ext.encryptedOutput0, ext.encryptedOutput1
                )
            )
        ) % FIELD_SIZE;
    }

    /// @notice publicAmount = (extAmount - fee) mod p
    function calculatePublicAmount(int256 extAmount, uint256 fee) public pure returns (uint256) {
        if (fee >= MAX_FEE || extAmount <= -MAX_EXT_AMOUNT || extAmount >= MAX_EXT_AMOUNT) revert InvalidExtAmount();
        int256 publicAmount = extAmount - int256(fee);
        return publicAmount >= 0 ? uint256(publicAmount) : FIELD_SIZE - uint256(-publicAmount);
    }

    function noteRoot() external view returns (uint256) {
        return noteTree.lastRoot();
    }

    function positionRoot() external view returns (uint256) {
        return positionTree.lastRoot();
    }

    function isKnownNoteRoot(uint256 root) external view returns (bool) {
        return noteTree.isKnownRoot(root);
    }

    function isKnownPositionRoot(uint256 root) external view returns (bool) {
        return positionTree.isKnownRoot(root);
    }

    function nextNoteIndex() external view returns (uint256) {
        return noteTree.nextIndex;
    }

    function nextPositionIndex() external view returns (uint256) {
        return positionTree.nextIndex;
    }

    /// @notice Empty-subtree value at height i (zeros[0] = 0).
    function zeros(uint256 i) external view returns (uint256) {
        return noteTree.zeros[i];
    }

    /// @notice The closeOffset the contract currently accepts as "latest" for a position opened at entryEpoch.
    function latestCloseOffset(uint256 entryEpoch) external view returns (uint256) {
        uint256 cur = oracle.currentEpoch();
        if (cur <= entryEpoch + 1) return 0;
        uint256 off = cur - entryEpoch - 1;
        return off > MAX_CLOSE_OFFSET ? MAX_CLOSE_OFFSET : off;
    }

    function _checkField(uint256 x) internal pure {
        if (x >= FIELD_SIZE) revert InputNotInField();
    }
}
