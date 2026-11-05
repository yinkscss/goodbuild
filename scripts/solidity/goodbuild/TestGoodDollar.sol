// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IERC677Receiver {
    function onTokenTransfer(address from, uint256 amount, bytes calldata data) external returns (bool);
}

/// @title Test G$ for Celo Sepolia
/// @notice There is no official G$ on Celo Sepolia, so GoodBuild deploys this stand-in (D23). It
/// behaves like mainnet G$ where generated apps depend on it: 18 decimals and ERC-677
/// `transferAndCall`. Anyone can claim 1,000 test G$ once a day from the faucet. It has no value
/// and no owner. Never use it on mainnet: GoodBuild always uses the real G$ there.
contract TestGoodDollar is ERC20 {
    /// @notice Test G$ one claim hands out.
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;
    /// @notice Minimum time between claims for one wallet.
    uint256 public constant FAUCET_INTERVAL = 1 days;

    /// @notice When each wallet last claimed (0 = never).
    mapping(address => uint256) public lastClaimAt;

    error FaucetCooldown(uint256 availableAt);
    error ReceiverRejected();

    event FaucetClaimed(address indexed to, uint256 amount);

    constructor() ERC20("GoodDollar (test)", "G$") {}

    /// @notice Claim FAUCET_AMOUNT test G$ for yourself, once per FAUCET_INTERVAL.
    function faucet() external {
        uint256 availableAt = nextClaimAt(msg.sender);
        if (block.timestamp < availableAt) revert FaucetCooldown(availableAt);
        lastClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice The time a wallet may claim next (0 if it never claimed, so it can claim now).
    function nextClaimAt(address account) public view returns (uint256) {
        uint256 last = lastClaimAt[account];
        return last == 0 ? 0 : last + FAUCET_INTERVAL;
    }

    /// @notice ERC-677: move tokens, then call `onTokenTransfer(from, amount, data)` on a contract receiver.
    function transferAndCall(address to, uint256 amount, bytes calldata data) external returns (bool) {
        _transfer(msg.sender, to, amount);
        if (to.code.length > 0 && !IERC677Receiver(to).onTokenTransfer(msg.sender, amount, data)) revert ReceiverRejected();
        return true;
    }
}
