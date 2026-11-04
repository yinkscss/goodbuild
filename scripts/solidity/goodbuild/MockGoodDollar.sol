// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IERC677Receiver {
    function onTokenTransfer(address from, uint256 amount, bytes calldata data) external returns (bool);
}

/// @notice Platform-owned G$ stand-in for local contract tests ("@goodbuild/MockGoodDollar.sol").
/// Behaves like G$ where generated apps depend on it: an 18-decimal ERC-20 with ERC-677
/// transferAndCall, which moves the tokens first and then calls the receiver's
/// onTokenTransfer(from, amount, data). Anyone can mint, because it only exists in tests.
contract MockGoodDollar is ERC20 {
    error ReceiverRejected();

    constructor() ERC20("GoodDollar", "G$") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferAndCall(address to, uint256 amount, bytes calldata data) external returns (bool) {
        _transfer(msg.sender, to, amount);
        if (to.code.length > 0 && !IERC677Receiver(to).onTokenTransfer(msg.sender, amount, data)) revert ReceiverRejected();
        return true;
    }
}
