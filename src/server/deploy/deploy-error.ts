export type DeployErrorCode =
  | "mainnet_disabled"
  | "unsupported_chain"
  | "manifest_missing"
  | "manifest_invalid"
  | "compile_failed"
  | "exploit_tests_failed"
  | "gooddollar_missing"
  | "source_changed"
  | "tx_not_found"
  | "tx_failed"
  | "not_contract_creation"
  | "wrong_sender"
  | "bytecode_mismatch"
  | "wrong_contract"
  // Upgradeable contracts (D33)
  | "upgradeable_testnet_only"
  | "upgradeable_not_ready"
  | "upgrade_refused"
  | "wrong_upgrade"
  | "chain_read_failed";

export class DeployError extends Error {
  constructor(
    readonly code: DeployErrorCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "DeployError";
  }
}
