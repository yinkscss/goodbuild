import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { appSettings } from "@/server/db/settings-schema";

/**
 * Who may start a NEW Celo mainnet deploy right now (D50). Read from the database on every call, so
 * changing it takes effect at once, with no rebuild and no restart.
 *
 *   off       nobody. The kill switch: set it on purpose and it stays off. An unreadable value also means off.
 *   admins    wallets listed in ADMIN_WALLETS.
 *   everyone  every signed-in wallet. THE DEFAULT since mainnet launch (D51): with no stored row, the
 *             MAINNET_DEFAULT_MODE environment value applies, and with that unset it is "everyone".
 *
 * It decides prepares only. Recording a transaction that is already on-chain, withdrawals and the
 * old-funds card never ask it, so turning it off can't strand someone's money or their record.
 * Note that `everyone` doesn't check GoodDollar verification: that arrives with step G1.
 */
export const MAINNET_ACCESS_MODES = ["off", "admins", "everyone"] as const;
export type MainnetAccessMode = (typeof MAINNET_ACCESS_MODES)[number];

export const MAINNET_ACCESS_KEY = "mainnet_access";

export function parseMode(value: unknown): MainnetAccessMode {
  return typeof value === "string" && (MAINNET_ACCESS_MODES as readonly string[]).includes(value) ? (value as MainnetAccessMode) : "off";
}

/** What applies when no admin has set the switch. Mainnet is open by default (D51); a deployment can start closed. */
export function defaultMode(raw: string | undefined = process.env.MAINNET_DEFAULT_MODE): MainnetAccessMode {
  return raw === undefined || raw.trim() === "" ? "everyone" : parseMode(raw.trim());
}

/** ADMIN_WALLETS: comma separated, trimmed, lowercased. Anything that isn't an address is dropped. */
export function adminWallets(raw: string | undefined = process.env.ADMIN_WALLETS): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const w = part.trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(w)) out.add(w);
  }
  return out;
}

export function isAdminWallet(wallet: string | null | undefined): boolean {
  return Boolean(wallet) && adminWallets().has(wallet!.trim().toLowerCase());
}

/** The stored setting. A missing row, an unknown value or a failed read all give "off". */
export async function getMainnetMode(db: Db): Promise<MainnetAccessMode> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, MAINNET_ACCESS_KEY)).limit(1);
    return row ? parseMode(row.value) : defaultMode();
  } catch (error) {
    console.error("mainnet switch unreadable, treating it as off", error);
    return "off";
  }
}

export function allowsMainnet(mode: MainnetAccessMode, wallet: string | null | undefined): boolean {
  if (mode === "everyone") return true;
  if (mode === "admins") return isAdminWallet(wallet);
  return false;
}

/** Whether this wallet (null when signed out) may start a new mainnet deploy now. */
export async function mainnetAllowedFor(db: Db, wallet: string | null | undefined): Promise<boolean> {
  return allowsMainnet(await getMainnetMode(db), wallet);
}

export async function setMainnetMode(db: Db, mode: MainnetAccessMode, adminWallet: string | null): Promise<void> {
  const row = { key: MAINNET_ACCESS_KEY, value: mode, updatedAt: new Date(), updatedBy: adminWallet?.toLowerCase() ?? null };
  await db.insert(appSettings).values(row).onConflictDoUpdate({ target: appSettings.key, set: { value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy } });
}
