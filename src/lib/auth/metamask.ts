import { numberToHex, type EIP1193Provider } from "viem";
import { celo, celoSepolia } from "viem/chains";

/**
 * MetaMask's connect screen, for a plain eth_requestAccounts, pre-selects every network the
 * wallet knows. That includes Tron (tron:728126428) once the wallet has a Tron account. MetaMask
 * then refuses to store the approval, because that scope isn't one it can grant, and the account
 * request fails after the person has already pressed Connect.
 *
 * Naming the two Celo chains in endowment:permitted-chains makes the screen pre-select only those,
 * so Tron stays out of the approval. See MetaMask's getDefaultConnectChainIds.
 *
 * MetaMask refuses the whole request when it names a network the wallet hasn't added (for Celo
 * Sepolia: 'Received scopeString value(s): eip155:11142220 ... not supported by the wallet').
 * Then we ask again without that network, and the chain switch afterwards adds it.
 */
const CELO_CHAIN_IDS = [numberToHex(celo.id), numberToHex(celoSepolia.id)];
/** Every MetaMask has Ethereum, so it stands in when the wallet has neither Celo chain. It still keeps Tron out. */
const FALLBACK_CHAIN_IDS = ["0x1"];

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

/** The EVM chains (as hex) a CAIP-25 error says the wallet hasn't added. */
export function unsupportedEvmChains(error: unknown): string[] {
  if (!isCaip25ScopeError(error)) return [];
  return [...errorMessage(error).matchAll(/eip155:(\d+)/g)].map((m) => numberToHex(Number(m[1])));
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
async function requestCeloPermissions(provider: EIP1193Provider, chains: string[]): Promise<void> {
  // Spread keeps the caveat off viem's `{ eth_accounts }` parameter type. MetaMask still receives it.
  const permittedChains = {
    "endowment:permitted-chains": {
      caveats: [{ type: "restrictNetworkSwitching", value: chains }],
    },
  };
  await provider.request({
    method: "wallet_requestPermissions",
    params: [{ eth_accounts: {}, ...permittedChains }],
  });
}

/**
 * Ask MetaMask for an account on Celo only. Falls back for a wallet that predates permitted chains,
 * drops Celo networks the wallet hasn't added, and clears a stored permission that brings Tron back.
 */
export async function requestMetaMaskAccount(provider: EIP1193Provider): Promise<`0x${string}` | null> {
  let chains: string[] = CELO_CHAIN_IDS;
  let revoked = false;
  for (;;) {
    try {
      await requestCeloPermissions(provider, chains);
      break;
    } catch (error) {
      if (isScopedPermissionUnsupported(error)) return firstAccount(provider, "eth_requestAccounts");
      if (!isCaip25ScopeError(error)) throw error;
      const missing = unsupportedEvmChains(error);
      if (missing.length) {
        // A network the wallet hasn't added. Ask without it; it gets added when the app switches chain.
        const left = chains.filter((c) => !missing.includes(c));
        if (left.length === chains.length || chains === FALLBACK_CHAIN_IDS) throw error;
        chains = left.length ? left : FALLBACK_CHAIN_IDS;
        continue;
      }
      // A permission saved earlier can merge Tron back into this approval. Drop it and ask once more.
      if (revoked) throw error;
      revoked = true;
      await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => undefined);
    }
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
