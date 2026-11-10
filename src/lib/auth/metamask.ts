import { numberToHex, type EIP1193Provider } from "viem";
import { celo, celoSepolia } from "viem/chains";

/**
 * MetaMask's connect screen, for a plain eth_requestAccounts, pre-selects every network the
 * wallet knows. That includes Tron (tron:728126428) once the wallet has a Tron account. MetaMask
 * then refuses to store the approval, because that scope isn't one it can grant, and the account
 * request fails after the person has already pressed Connect.
 *
 * Naming the two Celo chains in endowment:permitted-chains makes the screen pre-select only those
 * (or, if Celo isn't added yet, only EVM networks). Tron stays out of the approval.
 * See MetaMask's getDefaultConnectChainIds.
 */
const CELO_CHAIN_IDS = [numberToHex(celo.id), numberToHex(celoSepolia.id)];

export interface WalletConnectMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

/**
 * Session details WalletConnect shows, and checks, against the page. With none, the library
 * says the app is https://walletconnect.org, and the wallet reports a domain mismatch.
 */
export function walletConnectMetadata(origin: string, icon?: string | null): WalletConnectMetadata {
  return {
    name: "GoodBuild",
    description: "Build and deploy apps on Celo.",
    url: origin,
    icons: [icon || `${origin}/favicon.ico`],
  };
}

export function isCaip25ScopeError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("endowment:caip25") || message.includes("authorizedScopes");
}

/** The wallet has no scoped-permission method, so a plain account request is the one it understands. */
export function isScopedPermissionUnsupported(error: unknown): boolean {
  if (errorCode(error) === 4001 || /reject|denied|cancel/i.test(errorMessage(error))) return false;
  if (isCaip25ScopeError(error)) return false;
  const code = errorCode(error);
  if (code === -32601 || code === -32602) return true;
  return /method not found|does not exist|unrecognized|not supported|unsupported/i.test(errorMessage(error));
}

/**
 * viem types this method as `{ eth_accounts }` only. MetaMask also reads
 * `endowment:permitted-chains`, which is what keeps Tron off the approval.
 */
async function requestCeloPermissions(provider: EIP1193Provider): Promise<void> {
  // Spread keeps the caveat off viem's `{ eth_accounts }` parameter type. MetaMask still receives it.
  const permittedChains = {
    "endowment:permitted-chains": {
      caveats: [{ type: "restrictNetworkSwitching", value: CELO_CHAIN_IDS }],
    },
  };
  await provider.request({
    method: "wallet_requestPermissions",
    params: [{ eth_accounts: {}, ...permittedChains }],
  });
}

/** Ask MetaMask for an account on Celo only. Falls back for a wallet that predates permitted chains. */
export async function requestMetaMaskAccount(provider: EIP1193Provider): Promise<`0x${string}` | null> {
  try {
    await requestCeloPermissions(provider);
  } catch (error) {
    if (isScopedPermissionUnsupported(error)) return firstAccount(provider, "eth_requestAccounts");
    // A permission saved earlier can merge Tron back into this approval. Drop it and ask once more.
    if (!isCaip25ScopeError(error)) throw error;
    await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => undefined);
    await requestCeloPermissions(provider);
  }
  return firstAccount(provider, "eth_accounts");
}

async function firstAccount(provider: EIP1193Provider, method: "eth_accounts" | "eth_requestAccounts"): Promise<`0x${string}` | null> {
  const accounts = (await provider.request({ method })) as string[] | undefined;
  return (accounts?.[0] as `0x${string}` | undefined) ?? null;
}

function errorCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}
