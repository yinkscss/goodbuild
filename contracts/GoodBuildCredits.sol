// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * GoodBuild Credits (GBC), on Celo mainnet (D51).
 *
 * One GBC unit is one micro-USD of GoodBuild AI credit: 6 decimals, 1.000000 GBC = $1 of AI builds.
 * It is NOT a trading asset. It can only be minted and burned, never sent between wallets, so a
 * balance always belongs to the wallet that bought it and maps to one GoodBuild account.
 *
 * Flow:
 *   1. Mint: a wallet buys with CELO (`purchase`), or an authorised minter (the GoodBuild backend,
 *      for on-ramp and other payments) mints for a wallet (`mint`).
 *   2. Redeem: the wallet calls `redeem`, which burns the tokens and emits `Redeemed`. The backend
 *      sees that event and posts the same amount to the wallet's ledger balance, once per event.
 * Burning before crediting means credit can never be created twice from one balance.
 *
 * Not audited. Value caps: one purchase or mint is limited, and the owner can pause everything
 * except redeem of existing balances (so a pause never traps credit).
 */
contract GoodBuildCredits is ERC20, Ownable2Step, Pausable, ReentrancyGuard {
    /// GBC units (6 decimals) minted per 1 CELO (1e18 wei). Owner-set: there is no price oracle.
    uint256 public creditsPerCelo;
    /// Where purchase money goes, immediately.
    address payable public treasury;
    /// The most one purchase or one mint may create, in GBC units.
    uint256 public maxPerMint;
    mapping(address => bool) public isMinter;

    event Purchased(address indexed account, uint256 celoPaid, uint256 credits);
    event Minted(address indexed minter, address indexed account, uint256 credits, bytes32 ref);
    event Redeemed(address indexed account, uint256 credits, bytes32 ref);
    event RateChanged(uint256 creditsPerCelo);
    event TreasuryChanged(address treasury);
    event MaxPerMintChanged(uint256 maxPerMint);
    event MinterSet(address indexed minter, bool allowed);

    error TransfersDisabled();
    error ZeroAmount();
    error OverLimit();
    error NotMinter();
    error BadAddress();
    error PaymentFailed();

    constructor(address initialOwner, address payable treasury_, uint256 creditsPerCelo_, uint256 maxPerMint_)
        ERC20("GoodBuild Credits", "GBC")
        Ownable(initialOwner)
    {
        if (treasury_ == address(0)) revert BadAddress();
        if (creditsPerCelo_ == 0 || maxPerMint_ == 0) revert ZeroAmount();
        treasury = treasury_;
        creditsPerCelo = creditsPerCelo_;
        maxPerMint = maxPerMint_;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// Buy credits with CELO. Mints to the sender and forwards the CELO to the treasury.
    function purchase() external payable whenNotPaused nonReentrant {
        uint256 credits = (msg.value * creditsPerCelo) / 1e18;
        if (credits == 0) revert ZeroAmount();
        if (credits > maxPerMint) revert OverLimit();
        _mint(msg.sender, credits);
        emit Purchased(msg.sender, msg.value, credits);
        (bool ok, ) = treasury.call{value: msg.value}("");
        if (!ok) revert PaymentFailed();
    }

    /// Buy credits with CELO and add them to the sender's GoodBuild balance in one signature: the same as
    /// `purchase` then `redeem`, so the wallet never holds an unspent balance. The default path in the app.
    function purchaseAndRedeem(bytes32 ref) external payable whenNotPaused nonReentrant {
        uint256 credits = (msg.value * creditsPerCelo) / 1e18;
        if (credits == 0) revert ZeroAmount();
        if (credits > maxPerMint) revert OverLimit();
        emit Purchased(msg.sender, msg.value, credits);
        emit Redeemed(msg.sender, credits, ref);
        (bool ok, ) = treasury.call{value: msg.value}("");
        if (!ok) revert PaymentFailed();
    }

    /// An authorised minter creates credits for a wallet. `ref` ties it to the payment it answers.
    function mint(address account, uint256 credits, bytes32 ref) external whenNotPaused {
        if (!isMinter[msg.sender]) revert NotMinter();
        if (account == address(0)) revert BadAddress();
        if (credits == 0) revert ZeroAmount();
        if (credits > maxPerMint) revert OverLimit();
        _mint(account, credits);
        emit Minted(msg.sender, account, credits, ref);
    }

    /// Burn credits to add the same amount to the sender's GoodBuild balance. Works while paused.
    function redeem(uint256 credits, bytes32 ref) external {
        if (credits == 0) revert ZeroAmount();
        _burn(msg.sender, credits);
        emit Redeemed(msg.sender, credits, ref);
    }

    function setCreditsPerCelo(uint256 value) external onlyOwner {
        if (value == 0) revert ZeroAmount();
        creditsPerCelo = value;
        emit RateChanged(value);
    }

    function setTreasury(address payable value) external onlyOwner {
        if (value == address(0)) revert BadAddress();
        treasury = value;
        emit TreasuryChanged(value);
    }

    function setMaxPerMint(uint256 value) external onlyOwner {
        if (value == 0) revert ZeroAmount();
        maxPerMint = value;
        emit MaxPerMintChanged(value);
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) revert BadAddress();
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// Only mint (from == 0) and burn (to == 0) move balances. Wallet to wallet is refused.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert TransfersDisabled();
        super._update(from, to, value);
    }

    function renounceOwnership() public pure override {
        revert BadAddress();
    }
}
