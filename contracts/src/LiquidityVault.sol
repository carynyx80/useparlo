// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "./utils/ERC20.sol";
import {Ownable} from "./utils/Ownable.sol";
import {ReentrancyGuard} from "./utils/ReentrancyGuard.sol";
import {SafeTransfer} from "./utils/SafeTransfer.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IAttentionOracle} from "./interfaces/IAttentionOracle.sol";
import {ILiquidityVault} from "./interfaces/ILiquidityVault.sol";

/// @title Parlo LiquidityVault ("Parlo LP", PLP)
/// @notice LPs deposit USDT and act as counterparty to all positions. Only the pool can move margin in / payouts out.
/// @dev Uses internal asset accounting (`totalAssets`) so direct token donations cannot manipulate the share price.
///      Liability is tracked per entry-epoch bucket as margin * 9 (max payout 10x margin, margin already held).
///      A bucket is active while currentEpoch < entryEpoch + W + 2 (the close deadline).
contract LiquidityVault is ERC20, Ownable, ReentrancyGuard, ILiquidityVault {
    using SafeTransfer for IERC20;

    uint256 public constant WINDOW = 16;
    uint256 public constant BUCKET_LIFETIME = WINDOW + 2; // bucket for entryEpoch e active while cur < e + 18
    uint256 public constant RESERVE_MULTIPLIER = 9;
    uint256 public constant MAX_RESERVE_BPS = 5000; // activeReserve <= 50% of assets on open
    uint256 public constant TREASURY_FEE_BPS = 10; // half of the leverage-independent minimum fee (see report)
    uint256 public constant BPS = 10_000;

    IERC20 public immutable asset;
    IAttentionOracle public immutable oracle;
    address public treasury;
    address public pool;

    uint256 public totalAssets;
    uint256 public tvlCap; // 0 = unlimited
    bool public paused;

    mapping(uint256 => uint256) public reserveOf; // entryEpoch => reserved liability

    event PoolSet(address indexed pool);
    event TreasurySet(address indexed treasury);
    event TvlCapSet(uint256 cap);
    event Paused(bool paused);
    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event MarginReceived(uint256 indexed entryEpoch, uint256 margin, uint256 treasuryFee, uint256 reserve);
    event PaidOut(uint256 indexed entryEpoch, uint256 amount, uint256 margin);

    error NotPool();
    error PoolAlreadySet();
    error IsPaused();
    error ZeroAmount();
    error CapExceeded();
    error ReserveExceeded();
    error InsufficientLiquidity();
    error FundsNotReceived();

    constructor(address initialOwner, IERC20 asset_, IAttentionOracle oracle_, address treasury_)
        ERC20("Parlo LP", "PLP", 18)
        Ownable(initialOwner)
    {
        if (address(asset_) == address(0) || address(oracle_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        asset = asset_;
        oracle = oracle_;
        treasury = treasury_;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    // ------------------------------------------------------------------ admin

    /// @notice One-time wiring of the pool. Cannot be changed afterwards (prevents owner redirecting payOut).
    function setPool(address pool_) external onlyOwner {
        if (pool != address(0)) revert PoolAlreadySet();
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
        emit PoolSet(pool_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setTvlCap(uint256 cap) external onlyOwner {
        tvlCap = cap;
        emit TvlCapSet(cap);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    // ------------------------------------------------------------------ views

    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets * (totalSupply + 1) / (totalAssets + 1);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares * (totalAssets + 1) / (totalSupply + 1);
    }

    /// @notice Sum of reserved liability for buckets still within their close deadline.
    function activeReserve() public view returns (uint256 sum) {
        uint256 cur = oracle.currentEpoch();
        uint256 start = cur >= BUCKET_LIFETIME - 1 ? cur - (BUCKET_LIFETIME - 1) : 0;
        for (uint256 e = start; e <= cur; ++e) {
            sum += reserveOf[e];
        }
    }

    /// @notice Assets that must stay in the vault to cover all open positions at max payout (reserve + margins).
    function lockedAssets() public view returns (uint256) {
        uint256 r = activeReserve();
        return r + r / RESERVE_MULTIPLIER;
    }

    function maxWithdrawAssets() public view returns (uint256) {
        uint256 locked = lockedAssets();
        return totalAssets > locked ? totalAssets - locked : 0;
    }

    // ------------------------------------------------------------------ LP

    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (paused) revert IsPaused();
        if (assets == 0) revert ZeroAmount();
        if (tvlCap != 0 && totalAssets + assets > tvlCap) revert CapExceeded();
        shares = convertToShares(assets);
        if (shares == 0) revert ZeroAmount();

        totalAssets += assets;
        _mint(receiver, shares);
        asset.safeTransferFrom(msg.sender, address(this), assets);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @notice Burn `shares` for USDT. Withdrawals are allowed while paused but limited by locked liability.
    function withdraw(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        assets = convertToAssets(shares);
        if (assets == 0) revert ZeroAmount();
        if (assets > maxWithdrawAssets()) revert InsufficientLiquidity();

        _burn(msg.sender, shares);
        totalAssets -= assets;
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, assets, shares);
    }

    // ------------------------------------------------------------------ pool hooks

    /// @notice Called by the pool right after it transferred `margin` USDT to this vault.
    function receiveMargin(uint256 margin, uint256 entryEpoch) external onlyPool nonReentrant {
        if (margin == 0) revert ZeroAmount();
        if (asset.balanceOf(address(this)) < totalAssets + margin) revert FundsNotReceived();

        uint256 fee = margin * TREASURY_FEE_BPS / BPS;
        uint256 reserve = margin * RESERVE_MULTIPLIER;

        totalAssets += margin - fee;
        reserveOf[entryEpoch] += reserve;
        if (activeReserve() * BPS > totalAssets * MAX_RESERVE_BPS) revert ReserveExceeded();

        if (fee != 0) asset.safeTransfer(treasury, fee);
        emit MarginReceived(entryEpoch, margin, fee, reserve);
    }

    /// @notice Pays `amount` USDT to the pool for a closed position and releases its reserve.
    function payOut(uint256 amount, uint256 margin, uint256 entryEpoch) external onlyPool nonReentrant {
        if (amount > totalAssets) revert InsufficientLiquidity();
        uint256 reserve = margin * RESERVE_MULTIPLIER;
        uint256 r = reserveOf[entryEpoch];
        reserveOf[entryEpoch] = r > reserve ? r - reserve : 0;
        totalAssets -= amount;
        if (amount != 0) asset.safeTransfer(pool, amount);
        emit PaidOut(entryEpoch, amount, margin);
    }
}
