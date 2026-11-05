import { encodeDeployData, encodeFunctionData, parseAbi, type Abi, type Address, type Hex } from "viem";
import { celoSepolia } from "viem/chains";

/**
 * Upgradeable contracts, a testnet-only trial (D33). The app talks to a stock OpenZeppelin
 * TransparentUpgradeableProxy, which never moves. The proxy creates a stock ProxyAdmin owned by the
 * user's wallet, and only that wallet can point the proxy at new code. GoodBuild holds no keys.
 */

/** Chains where the option exists. Checked on the server; mainnet is deliberately absent. */
export const UPGRADEABLE_CHAIN_IDS: readonly number[] = [celoSepolia.id];

export function isUpgradeableChain(chainId: number): boolean {
  return UPGRADEABLE_CHAIN_IDS.includes(chainId);
}

/** The function a proxy calls once, in its own creation transaction. Replaces the constructor. */
export const INITIALIZER = "initialize";

/** EIP-1967 storage slots of the proxy. */
export const IMPLEMENTATION_SLOT: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const ADMIN_SLOT: Hex = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

export const proxyAdminAbi = parseAbi([
  "function owner() view returns (address)",
  "function upgradeAndCall(address proxy, address implementation, bytes data) payable",
  "function renounceOwnership()",
  "function transferOwnership(address newOwner)",
]);

/** How to deploy a contract's proxy for the first time. */
export interface FirstProxy {
  kind: "first";
  proxyAbi: Abi;
  proxyBytecode: Hex;
}
/** A live proxy that gets new code. It keeps its address, funds and data. */
export interface ProxyUpgrade {
  kind: "upgrade";
  proxy: Address;
  admin: Address;
}
export type UpgradeableStep = FirstProxy | ProxyUpgrade;

/** Who can still change a live proxy, read from the chain. */
export type UpgradeAuthority = "you" | "locked" | "other" | "unknown";

export interface ProxyInfo {
  address: Address;
  admin: Address;
  implementation: Address;
  authority: UpgradeAuthority;
}

/** Creation data for the proxy. Its constructor runs initialize, so nobody can get in between. */
export function encodeProxyDeploy(first: FirstProxy, implementation: Address, owner: Address, initData: Hex): Hex {
  return encodeDeployData({ abi: first.proxyAbi, bytecode: first.proxyBytecode, args: [implementation, owner, initData] });
}

/** The transaction that points a proxy at new code. New variables start at zero, so nothing is called. */
export function encodeUpgrade(proxy: Address, implementation: Address): Hex {
  return encodeFunctionData({ abi: proxyAdminAbi, functionName: "upgradeAndCall", args: [proxy, implementation, "0x"] });
}

export function initializerData(abi: Abi, args: unknown[]): Hex {
  return encodeFunctionData({ abi, functionName: INITIALIZER, args });
}

export const CAN_BE_CHANGED_LABEL = "This contract can be changed";
