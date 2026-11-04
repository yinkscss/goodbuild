// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RTX — 50 million fixed-supply token with a G$ swap pool
/// @notice 50,000,000 RTX are minted once to the deployer. The owner seeds the pool with RTX and
///         GoodDollar (G$). After that anyone can buy RTX with G$ or sell RTX back for G$.
///         Pricing follows the constant-product rule with a 0.30% fee that stays in the pool.
///         G$ is always the ERC-20 token here, never native CELO.
contract RTX is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Total RTX created at deploy: 50 million (18 decimals).
    uint256 public constant INITIAL_SUPPLY = 50_000_000 * 1e18;
    /// @notice Fee taken from the input of each swap, in basis points (30 = 0.30%).
    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS = 10_000;

    /// @notice The G$ token used to buy and sell RTX.
    IERC20 public immutable gd;

    /// @notice RTX tokens currently held by the pool.
    uint256 public rtxReserve;
    /// @notice G$ tokens currently held by the pool.
    uint256 public gdReserve;

    event LiquidityAdded(address indexed by, uint256 rtxAmount, uint256 gdAmount);
    event Bought(address indexed buyer, uint256 gdIn, uint256 rtxOut);
    event Sold(address indexed seller, uint256 rtxIn, uint256 gdOut);

    error ZeroAddress();
    error ZeroAmount();
    error NotGoodDollar();
    error NoLiquidity();
    error InsufficientOutput();
    error InsufficientGdLiquidity();
    error TransferFailed();

    constructor(IERC20 gd_) ERC20("RTX Token", "RTX") Ownable(msg.sender) {
        if (address(gd_) == address(0)) revert ZeroAddress();
        gd = gd_;
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    // ---------------------------------------------------------------------
    // Owner: seed the pool (one-way, the owner cannot withdraw user funds)
    // ---------------------------------------------------------------------

    /// @notice Add RTX and G$ to the pool so people can trade. Callable repeatedly by the owner.
    /// @dev Both amounts are pulled from the caller, so approve this contract first.
    function addLiquidity(uint256 rtxAmount, uint256 gdAmount) external onlyOwner {
        if (rtxAmount == 0 || gdAmount == 0) revert ZeroAmount();
        _transferFrom(msg.sender, address(this), rtxAmount);
        gd.safeTransferFrom(msg.sender, address(this), gdAmount);
        rtxReserve += rtxAmount;
        gdReserve += gdAmount;
        emit LiquidityAdded(msg.sender, rtxAmount, gdAmount);
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    /// @notice Buy RTX by paying G$. Requires a G$ approval to this contract first.
    /// @param gdIn Amount of G$ to spend.
    /// @param minRtxOut Lowest acceptable RTX out (slippage guard, use 0 to accept any).
    /// @return rtxOut RTX sent to the caller.
    function buyRTX(uint256 gdIn, uint256 minRtxOut) external nonReentrant returns (uint256 rtxOut) {
        if (gdIn == 0) revert ZeroAmount();
        gd.safeTransferFrom(msg.sender, address(this), gdIn);
        rtxOut = _buy(msg.sender, gdIn, minRtxOut);
    }

    /// @notice ERC-677 hook: buy RTX in one transaction with G$.transferAndCall(this, amount, data).
    /// @dev `data` may be an abi-encoded uint256 minimum RTX out; empty data accepts any amount.
    function onTokenTransfer(address from, uint256 amount, bytes calldata data) external nonReentrant returns (bool) {
        if (msg.sender != address(gd)) revert NotGoodDollar();
        if (amount == 0) revert ZeroAmount();
        if (rtxReserve == 0 || gdReserve == 0) revert NoLiquidity();
        uint256 minOut = data.length == 32 ? abi.decode(data, (uint256)) : 0;
        _buy(from, amount, minOut);
        return true;
    }

    /// @notice Sell RTX back to the pool and receive G$.
    /// @param rtxIn Amount of RTX to sell.
    /// @param minGdOut Lowest acceptable G$ out (slippage guard, use 0 to accept any).
    /// @return gdOut G$ sent to the caller.
    function sellRTX(uint256 rtxIn, uint256 minGdOut) external nonReentrant returns (uint256 gdOut) {
        if (rtxIn == 0) revert ZeroAmount();
        if (rtxReserve == 0 || gdReserve == 0) revert NoLiquidity();
        _transferFrom(msg.sender, address(this), rtxIn);
        gdOut = _quoteSell(rtxIn);
        if (gdOut == 0) revert ZeroAmount();
        if (gdOut < minGdOut) revert InsufficientOutput();
        if (gdOut > gdReserve) revert InsufficientGdLiquidity();
        rtxReserve += rtxIn;
        gdReserve -= gdOut;
        gd.safeTransfer(msg.sender, gdOut);
        emit Sold(msg.sender, rtxIn, gdOut);
    }

    // ---------------------------------------------------------------------
    // Quotes and pool information (everything the UI shows)
    // ---------------------------------------------------------------------

    /// @notice RTX you would receive for `gdIn` G$.
    function quoteBuy(uint256 gdIn) public view returns (uint256) {
        uint256 effectiveIn = (gdIn * (BPS - FEE_BPS)) / BPS;
        if (effectiveIn == 0 || rtxReserve == 0 || gdReserve == 0) return 0;
        return (rtxReserve * effectiveIn) / (gdReserve + effectiveIn);
    }

    /// @notice G$ you would receive for `rtxIn` RTX.
    function quoteSell(uint256 rtxIn) public view returns (uint256) {
        uint256 effectiveIn = (rtxIn * (BPS - FEE_BPS)) / BPS;
        if (effectiveIn == 0 || rtxReserve == 0 || gdReserve == 0) return 0;
        return (gdReserve * effectiveIn) / (rtxReserve + effectiveIn);
    }

    /// @notice Current price of 1 RTX in G$, scaled by 1e18 (0 when the pool is empty).
    function priceGdPerRtx() external view returns (uint256) {
        if (rtxReserve == 0) return 0;
        return (gdReserve * 1e18) / rtxReserve;
    }

    /// @notice True once the owner has added RTX and G$ liquidity.
    function hasLiquidity() external view returns (bool) {
        return rtxReserve > 0 && gdReserve > 0;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _buy(address buyer, uint256 gdIn, uint256 minRtxOut) private returns (uint256 rtxOut) {
        if (rtxReserve == 0 || gdReserve == 0) revert NoLiquidity();
        rtxOut = _quoteBuy(gdIn);
        if (rtxOut == 0 || rtxOut > rtxReserve) revert InsufficientOutput();
        if (rtxOut < minRtxOut) revert InsufficientOutput();
        rtxReserve -= rtxOut;
        gdReserve += gdIn;
        _transfer(address(this), buyer, rtxOut);
        emit Bought(buyer, gdIn, rtxOut);
    }

    function _quoteBuy(uint256 gdIn) private view returns (uint256) {
        uint256 effectiveIn = (gdIn * (BPS - FEE_BPS)) / BPS;
        if (effectiveIn == 0) return 0;
        return (rtxReserve * effectiveIn) / (gdReserve + effectiveIn);
    }

    function _quoteSell(uint256 rtxIn) private view returns (uint256) {
        uint256 effectiveIn = (rtxIn * (BPS - FEE_BPS)) / BPS;
        if (effectiveIn == 0) return 0;
        return (gdReserve * effectiveIn) / (rtxReserve + effectiveIn);
    }

    function _transferFrom(address from, address to, uint256 amount) private {
        bool ok = transferFrom(from, to, amount);
        if (!ok) revert TransferFailed();
    }
}
