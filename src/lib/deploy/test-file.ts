/**
 * Is this project file a Solidity test (GB-04)? Tests are compiled and run in the local EVM and never
 * deployed. A `*.t.sol` file anywhere under contracts/ is a test, and so is anything under contracts/test/
 * (projects made before this rule keep their files there). One rule, used by the builder's checks and the
 * deploy compile alike, so a test can't be skipped as a test and then compiled as a deployable contract.
 */
export function isTestFile(path: string): boolean {
  return path.startsWith("contracts/test/") || /\.t\.sol$/.test(path);
}

/** A deployable Solidity source: a project contract that isn't a test. */
export function isDeployableSource(path: string): boolean {
  return path.startsWith("contracts/") && path.endsWith(".sol") && !isTestFile(path);
}
