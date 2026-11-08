// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * GoodBuild Credits (GBC) on Celo (D51, D56).
 *
 * A credit is worth $1 of GoodBuild AI builds. The token has 6 decimals, so 1 GBC unit is 1 micro-USD, the
 * same unit as GoodBuild's ledger. The supply is fixed: 10,000,000 credits are minted once, to this
 * contract, and every sale burns credits out of that inventory. Nobody can mint more.
 *
 * Buying: a user pays G$ for a quote that GoodBuild's server signed (EIP-712). The quote names the buyer,
 * the exact G$ amount, the credits and any verification bonus, a unique ref and a deadline. The contract
 * checks the signature, takes the G$, burns the credits from inventory and emits `Redeemed`, which the
 * backend turns into ledger credit exactly once. The price lives in the server's quote (G$ moves, so a
 * fixed on-chain rate would go stale); the signer can be replaced by the owner at any time.
 *
 * Credits are never held by users and cannot be transferred. The owner (admin) can pause buying, replace
 * the quote signer, grant credits to a wallet, and withdraw the G$ (or any token or CELO) held here.
 * Not audited.
 */
contract GoodBuildCredits is ERC20, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// 10,000,000 credits, 6 decimals.
    uint256 public constant SUPPLY = 10_000_000 * 1e6;

    struct Quote {
        address buyer;
        uint256 gdAmount; // G$ (18 decimals) the buyer pays
        uint256 credits; // paid credits, GBC units
        uint256 bonus; // extra credits for a GoodDollar-verified person, GBC units
        bytes32 ref; // unique per quote
        uint256 deadline; // unix seconds
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256("Quote(address buyer,uint256 gdAmount,uint256 credits,uint256 bonus,bytes32 ref,uint256 deadline)");

    IERC20 public immutable goodDollar;
    address public quoteSigner;
    /// The most credits (paid plus bonus) one quote or grant may release, GBC units.
    uint256 public maxPerQuote;
    /// Credits sold or granted so far, GBC units.
    uint256 public totalReleased;
    mapping(bytes32 => bool) public used;

    event Purchased(address indexed account, uint256 gdPaid, uint256 credits, uint256 bonus, bytes32 ref);
    event Redeemed(address indexed account, uint256 credits, bytes32 ref);
    event Granted(address indexed account, uint256 credits, bytes32 ref);
    event QuoteSignerChanged(address signer);
    event MaxPerQuoteChanged(uint256 maxPerQuote);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error TransfersDisabled();
    error ZeroAmount();
    error OverLimit();
    error BadAddress();
    error BadQuote();
    error QuoteExpired();
    error QuoteUsed();
    error BadSignature();
    error NotGoodDollar();
    error WrongAmount();
    error SoldOut();
    error WithdrawFailed();

    constructor(address admin, address goodDollar_, address quoteSigner_, uint256 maxPerQuote_)
        ERC20("GoodBuild Credits", "GBC")
        Ownable(admin)
        EIP712("GoodBuild Credits", "1")
    {
        if (admin == address(0) || goodDollar_ == address(0) || quoteSigner_ == address(0)) revert BadAddress();
        if (maxPerQuote_ == 0) revert ZeroAmount();
        goodDollar = IERC20(goodDollar_);
        quoteSigner = quoteSigner_;
        maxPerQuote = maxPerQuote_;
        _mint(address(this), SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// Credits still for sale.
    function remaining() external view returns (uint256) {
        return balanceOf(address(this));
    }

    function quoteHash(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q.buyer, q.gdAmount, q.credits, q.bonus, q.ref, q.deadline)));
    }

    /// Pay with an allowance: approve G$ to this contract, then call. The sender must be the quote's buyer.
    function buy(Quote calldata q, bytes calldata signature) external whenNotPaused nonReentrant {
        if (q.buyer != msg.sender) revert BadQuote();
        _checkAndRelease(q, signature);
        goodDollar.safeTransferFrom(msg.sender, address(this), q.gdAmount);
    }

    /// Pay in one signature with G$'s `transferAndCall(this, gdAmount, abi.encode(quote, signature))` (ERC-677).
    function onTokenTransfer(address from, uint256 amount, bytes calldata data) external whenNotPaused nonReentrant returns (bool) {
        if (msg.sender != address(goodDollar)) revert NotGoodDollar();
        (Quote memory q, bytes memory signature) = abi.decode(data, (Quote, bytes));
        if (q.buyer != from) revert BadQuote();
        if (amount != q.gdAmount) revert WrongAmount();
        _checkAndRelease(q, signature);
        return true;
    }

    function _checkAndRelease(Quote memory q, bytes memory signature) private {
        if (q.gdAmount == 0 || q.credits == 0) revert ZeroAmount();
        if (block.timestamp > q.deadline) revert QuoteExpired();
        if (used[q.ref]) revert QuoteUsed();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q.buyer, q.gdAmount, q.credits, q.bonus, q.ref, q.deadline)));
        if (ECDSA.recover(digest, signature) != quoteSigner) revert BadSignature();
        used[q.ref] = true;
        uint256 total = q.credits + q.bonus;
        if (total > maxPerQuote) revert OverLimit();
        _release(q.buyer, total, q.ref);
        emit Purchased(q.buyer, q.gdAmount, q.credits, q.bonus, q.ref);
    }

    /// Burns credits out of inventory and tells the backend to credit the wallet's ledger once.
    function _release(address account, uint256 credits, bytes32 ref) private {
        if (credits > balanceOf(address(this))) revert SoldOut();
        _burn(address(this), credits);
        totalReleased += credits;
        emit Redeemed(account, credits, ref);
    }

    /// Admin: give a wallet credits at no charge (support, promotions). Uses the same unique-ref guard.
    function grant(address account, uint256 credits, bytes32 ref) external onlyOwner {
        if (account == address(0)) revert BadAddress();
        if (credits == 0) revert ZeroAmount();
        if (credits > maxPerQuote) revert OverLimit();
        if (used[ref]) revert QuoteUsed();
        used[ref] = true;
        _release(account, credits, ref);
        emit Granted(account, credits, ref);
    }

    /// Admin: take G$ (or any token) out; `token` of address(0) means CELO.
    function withdraw(address token, address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadAddress();
        if (amount == 0) revert ZeroAmount();
        if (token == address(this)) revert BadAddress(); // credits are not withdrawable, only sold
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert WithdrawFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(token, to, amount);
    }

    function setQuoteSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert BadAddress();
        quoteSigner = signer;
        emit QuoteSignerChanged(signer);
    }

    function setMaxPerQuote(uint256 value) external onlyOwner {
        if (value == 0) revert ZeroAmount();
        maxPerQuote = value;
        emit MaxPerQuoteChanged(value);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// Only mint (the one-time supply) and burn (a sale) move balances; credits can never be sent.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert TransfersDisabled();
        super._update(from, to, value);
    }

    function renounceOwnership() public pure override {
        revert BadAddress();
    }
}
