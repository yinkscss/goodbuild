import type { Address, Hex } from "viem";

/**
 * Transactions sent but not yet recorded, kept in the browser so a reload or a closed modal can't
 * lose a contract that is already on-chain. Scoped to the exact source and wallet: anything else
 * couldn't be recorded anyway. Storage can be missing or blocked, and then only this tab remembers.
 */
export function pendingKey(projectId: string, chainId: number, sourceHash: Hex, account: Address) {
  return `gb:deploy-sent:${projectId}:${chainId}:${sourceHash}:${account.toLowerCase()}`;
}

export function loadSent(key: string): Record<string, Hex> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v))) as Record<string, Hex>;
  } catch {
    return {};
  }
}

export function saveSent(key: string, sent: Record<string, Hex>) {
  try {
    if (Object.keys(sent).length) localStorage.setItem(key, JSON.stringify(sent));
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

/** The nonce each sent transaction went out with (GB-03), kept beside `sent` under its own key. */
export function loadNonces(key: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${key}:nonces`) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => Number.isSafeInteger(v) && (v as number) >= 0)) as Record<string, number>;
  } catch {
    return {};
  }
}

export function saveNonces(key: string, nonces: Record<string, number>) {
  try {
    if (Object.keys(nonces).length) localStorage.setItem(`${key}:nonces`, JSON.stringify(nonces));
    else localStorage.removeItem(`${key}:nonces`);
  } catch {
    /* private mode */
  }
}
