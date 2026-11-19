// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * GoodBuild Registry on Celo (D155).
 *
 * A public, append-only log of GoodBuild activity: builders who joined, apps generated, contracts deployed, apps
 * published or taken offline, and apps that use G$. It only emits events. It holds no funds, takes no payments,
 * has no upgrade path and keeps no state beyond who may write.
 *
 * Builders and apps appear as opaque 32-byte ids (a salted hash made off-chain), never as wallets, emails or
 * project names. A deployed contract's address and creation transaction are already public on Celo, so they go in as they are.
 *
 * Only the `recorder` (GoodBuild's server) can write. The owner can replace the recorder. Not audited.
 */
contract GoodBuildRegistry is Ownable2Step {
    enum Kind {
        BuilderJoined,
        AppGenerated,
        ProjectDeployed,
        AppPublished,
        AppUnpublished,
        GdollarIntegrated
    }

    struct Entry {
        Kind kind;
        bytes32 builder;
        bytes32 app;
        address target; // the deployed contract (ProjectDeployed, GdollarIntegrated); zero otherwise
        bytes32 txHash; // its creation transaction; zero otherwise
        uint64 at; // when it happened (unix seconds), so history written later can be told apart from new activity
    }

    /// Most entries in one transaction, so a batch always fits in a block.
    uint256 public constant MAX_BATCH = 100;

    address public recorder;

    event BuilderJoined(bytes32 indexed builder, uint64 at);
    event AppGenerated(bytes32 indexed builder, bytes32 indexed app, uint64 at);
    event ProjectDeployed(bytes32 indexed builder, bytes32 indexed app, address indexed target, bytes32 txHash, uint64 at);
    event AppPublished(bytes32 indexed builder, bytes32 indexed app, uint64 at);
    event AppUnpublished(bytes32 indexed builder, bytes32 indexed app, uint64 at);
    event GdollarIntegrated(bytes32 indexed app, address indexed target, uint64 at);
    event RecorderChanged(address indexed recorder);

    error NotRecorder();
    error BatchTooLarge();
    error ZeroAddress();

    constructor(address admin, address firstRecorder) Ownable(admin) {
        if (firstRecorder == address(0)) revert ZeroAddress();
        recorder = firstRecorder;
        emit RecorderChanged(firstRecorder);
    }

    function setRecorder(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        recorder = next;
        emit RecorderChanged(next);
    }

    function recordBatch(Entry[] calldata entries) external {
        if (msg.sender != recorder) revert NotRecorder();
        if (entries.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < entries.length; i++) {
            Entry calldata e = entries[i];
            if (e.kind == Kind.BuilderJoined) emit BuilderJoined(e.builder, e.at);
            else if (e.kind == Kind.AppGenerated) emit AppGenerated(e.builder, e.app, e.at);
            else if (e.kind == Kind.ProjectDeployed) emit ProjectDeployed(e.builder, e.app, e.target, e.txHash, e.at);
            else if (e.kind == Kind.AppPublished) emit AppPublished(e.builder, e.app, e.at);
            else if (e.kind == Kind.AppUnpublished) emit AppUnpublished(e.builder, e.app, e.at);
            else emit GdollarIntegrated(e.app, e.target, e.at);
        }
    }
}
