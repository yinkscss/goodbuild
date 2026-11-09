// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Platform-owned test helpers for generated contract tests (contracts/test/*.t.sol).
// Import as "@goodbuild/Test.sol". Tests run in a local EVM only and are never deployed.
// Each public or external function whose name starts with "test" runs in a fresh deploy of
// the test contract, after setUp() if there is one. A test passes when it doesn't revert.

/// @notice A stand-in user. Tests call contracts through actors to act as different wallets.
contract Actor {
    /// @notice Lets the actor hold CELO (see Test.fund) and receive refunds or withdrawals.
    receive() external payable {}

    /// @notice Call `target` with `data` as this actor (msg.sender == this actor).
    function exec(address target, bytes calldata data) external returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            // Bubble the original revert so the failure names the real error.
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /// @notice Same as exec, but sends `value` of the actor's CELO with the call (the actor must hold it: see Test.fund).
    function execValue(address target, bytes calldata data, uint256 value) external returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
}

abstract contract Test {
    error AssertionFailed(string message);
    error AssertionFailedUint(string message, uint256 actual, uint256 expected);
    error ExpectedRevert(string message);

    function newActor() internal returns (Actor) {
        return new Actor();
    }

    /// @notice Give an actor `amount` of CELO out of the test contract's own balance (it starts with 1,000 CELO).
    function fund(Actor actor, uint256 amount) internal {
        (bool ok,) = address(actor).call{value: amount}("");
        if (!ok) revert AssertionFailed("fund: the test contract has too little CELO");
    }

    function assertTrue(bool condition, string memory message) internal pure {
        if (!condition) revert AssertionFailed(message);
    }

    function assertEq(uint256 actual, uint256 expected, string memory message) internal pure {
        if (actual != expected) revert AssertionFailedUint(message, actual, expected);
    }

    function assertEq(address actual, address expected, string memory message) internal pure {
        if (actual != expected) revert AssertionFailed(message);
    }

    function assertGt(uint256 a, uint256 b, string memory message) internal pure {
        if (a <= b) revert AssertionFailedUint(message, a, b);
    }

    function assertGe(uint256 a, uint256 b, string memory message) internal pure {
        if (a < b) revert AssertionFailedUint(message, a, b);
    }

    /// @notice Passes only if calling `target` with `data` (as `actor`) reverts.
    function expectRevert(Actor actor, address target, bytes memory data, string memory message) internal {
        try actor.exec(target, data) {
            revert ExpectedRevert(message);
        } catch {}
    }

    /// @notice Passes only if calling `target` with `data` and `value` CELO (as `actor`) reverts.
    function expectRevertValue(Actor actor, address target, bytes memory data, uint256 value, string memory message) internal {
        try actor.execValue(target, data, value) {
            revert ExpectedRevert(message);
        } catch {}
    }
}
