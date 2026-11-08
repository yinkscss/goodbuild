// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Address, Hex, PublicClient } from "viem";

import { saveFiles } from "@/server/agent/store";
import { contractModule } from "@/server/agent/template";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { appSettings } from "@/server/db/settings-schema";
import { createProjectFromPrompt, chainIdFor } from "@/server/projects";
import {
  adminWallets,
  allowsMainnet,
  getMainnetMode,
  isAdminWallet,
  mainnetAllowedFor,
  parseMode,
  setMainnetMode,
} from "@/server/settings/mainnet-access";
import { oldContractsWithFunds } from "./old-contracts";
import { assertChain, prepareDeploy, recordDeployment } from "./service";


// The mainnet switch (D50). Each test is written to fail if the check it names is taken out.

const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n";
const TOKEN = HEADER + `import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract RTXToken is ERC20 { constructor() ERC20("RTX", "RTX") { _mint(msg.sender, 1000 ether); } }
`;
const MANIFEST = JSON.stringify({ contracts: [{ name: "RTXToken", args: {} }] });

const ADMIN = "0xAbCdEf0000000000000000000000000000000001"; // mixed case on purpose
const OTHER = "0x7a3000000000000000000000000000000000e41c";
const MAINNET = 42220;
const SEPOLIA = 11142220;

let db: Db;
let userId: string;
let projectId: string;

afterEach(() => vi.restoreAllMocks()); // the test database is shared, so a spy must not outlive its test

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("MAINNET_DEFAULT_MODE", "off"); // mainnet is open by default (D51); these tests are about the switch when closed
  vi.stubEnv("ADMIN_WALLETS", `  ${ADMIN.toUpperCase().replace("0X", "0x")} , not-an-address, `);
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MAINNET", ""); // the old build flag must mean nothing now
  db = await createTestDb();
  const user = await signInUser(db, { wallet: OTHER, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  const project = await createProjectFromPrompt(db, userId, { prompt: "RTX token", network: "celo-sepolia" });
  projectId = project.id;
  await saveFiles(db, projectId, {
    "contracts/RTXToken.sol": TOKEN,
    "contracts/deploy.json": MANIFEST,
    "src/contracts/RTXToken.ts": contractModule("RTXToken", []),
  });
});

const prepare = (wallet: string | undefined, chainId = MAINNET) => prepareDeploy(db, { projectId, chainId, wallet });
const refused = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return error as { code?: string; message?: string } | null;
};

describe("the setting", () => {
  it("is open when nothing is stored and no default is set (D51), and closed when the default says so", async () => {
    vi.stubEnv("MAINNET_DEFAULT_MODE", "");
    expect(await getMainnetMode(db)).toBe("everyone");
    vi.stubEnv("MAINNET_DEFAULT_MODE", "admins");
    expect(await getMainnetMode(db)).toBe("admins");
    vi.stubEnv("MAINNET_DEFAULT_MODE", "off");
    expect(await getMainnetMode(db)).toBe("off");
  });

  it("treats any value that isn't one of the three as off", async () => {
    for (const bad of ["", "Everyone", "true", "1", "on", "admin", "everyone ", null, undefined, 1]) expect(parseMode(bad)).toBe("off");
    expect(parseMode("admins")).toBe("admins");
  });

  it("treats a stored typo as off, and a database that can't be read as off", async () => {
    await db.insert(appSettings).values({ key: "mainnet_access", value: "EVERYONE" });
    expect(await getMainnetMode(db)).toBe("off");
    const broken = { select: () => { throw new Error("db down"); } } as unknown as Db;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await getMainnetMode(broken)).toBe("off");
    expect(await mainnetAllowedFor(broken, ADMIN)).toBe(false);
  });

  it("is read on every call, so a change is felt at once", async () => {
    await setMainnetMode(db, "everyone", null);
    expect(await mainnetAllowedFor(db, OTHER)).toBe(true);
    await setMainnetMode(db, "off", ADMIN);
    expect(await mainnetAllowedFor(db, OTHER)).toBe(false);
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "mainnet_access"));
    expect(row.updatedBy).toBe(ADMIN.toLowerCase());
  });

  it("only accepts a known key", async () => {
    await expect(db.insert(appSettings).values({ key: "anything", value: "x" })).rejects.toThrow();
  });
});

describe("who counts as an admin", () => {
  it("compares wallets without regard to case, and ignores entries that aren't addresses", () => {
    expect([...adminWallets()]).toEqual([ADMIN.toLowerCase()]);
    expect(isAdminWallet(ADMIN)).toBe(true);
    expect(isAdminWallet(ADMIN.toLowerCase())).toBe(true);
    expect(isAdminWallet(ADMIN.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isAdminWallet(` ${ADMIN} `)).toBe(true);
    expect(isAdminWallet(OTHER)).toBe(false);
    expect(isAdminWallet("not-an-address")).toBe(false);
    expect(isAdminWallet(null)).toBe(false);
    expect(isAdminWallet("")).toBe(false);
  });

  it("is nobody when ADMIN_WALLETS is empty or missing, so admins mode then lets no one in", () => {
    vi.stubEnv("ADMIN_WALLETS", "");
    expect(isAdminWallet(ADMIN)).toBe(false);
    expect(allowsMainnet("admins", ADMIN)).toBe(false);
    vi.stubEnv("ADMIN_WALLETS", ",, ,");
    expect(adminWallets().size).toBe(0);
  });

  it("a partial or prefix match is not a match", () => {
    vi.stubEnv("ADMIN_WALLETS", ADMIN.slice(0, 20));
    expect(isAdminWallet(ADMIN)).toBe(false);
  });
});

describe("prepare asks the switch, every time", () => {
  it("refuses everyone when off, with words a person can act on, and never reads the old build flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MAINNET", "true");
    for (const wallet of [OTHER, ADMIN, undefined]) {
      const e = await refused(prepare(wallet));
      expect(e?.code).toBe("mainnet_disabled");
      expect(e?.message).toMatch(/switched off right now/);
      expect(e?.message).toMatch(/Celo Sepolia/);
    }
  });

  it("under admins, refuses a wallet that isn't one, and one that is missing", async () => {
    await setMainnetMode(db, "admins", null);
    expect((await refused(prepare(OTHER)))?.code).toBe("mainnet_disabled");
    expect((await refused(prepare(undefined)))?.code).toBe("mainnet_disabled");
    expect((await refused(prepare("")))?.code).toBe("mainnet_disabled");
    expect((await refused(prepare(OTHER)))?.message).toMatch(/only open to the GoodBuild team/);
  });

  it("under admins, lets an admin through whatever the case of the address", { timeout: 90_000 }, async () => {
    await setMainnetMode(db, "admins", null);
    for (const wallet of [ADMIN, ADMIN.toLowerCase()]) {
      const plan = await prepare(wallet);
      expect(plan.chainId).toBe(MAINNET);
    }
  });

  it("under everyone, lets any wallet through", { timeout: 90_000 }, async () => {
    await setMainnetMode(db, "everyone", null);
    expect((await prepare(OTHER)).chainId).toBe(MAINNET);
  });

  it("Sepolia never asks the switch, so testing keeps working with it off", { timeout: 90_000 }, async () => {
    expect((await prepare(OTHER, SEPOLIA)).chainId).toBe(SEPOLIA);
  });

  it("an unknown chain is still unsupported, whatever the switch says", async () => {
    await setMainnetMode(db, "everyone", null);
    expect((await refused(prepare(OTHER, 1)))?.code).toBe("unsupported_chain");
    expect(() => assertChain(1)).toThrow();
  });

  it("the switch moving between two prepares changes the second answer", { timeout: 90_000 }, async () => {
    await setMainnetMode(db, "everyone", null);
    await prepare(OTHER);
    await setMainnetMode(db, "off", null);
    expect((await refused(prepare(OTHER)))?.code).toBe("mainnet_disabled");
  });
});

describe("project creation", () => {
  it("only starts a project on mainnet when the switch lets that wallet, and otherwise falls back to Sepolia", async () => {
    expect(chainIdFor("celo")).toBe(SEPOLIA);
    expect(chainIdFor("celo", false)).toBe(SEPOLIA);
    expect(chainIdFor("celo", true)).toBe(MAINNET);
    const p = await createProjectFromPrompt(db, userId, { prompt: "x", network: "celo", mainnetAllowed: await mainnetAllowedFor(db, OTHER) });
    expect(p.chainId).toBe(SEPOLIA);
  });
});

/** A chain stand-in: one mined contract creation, from the signed-in wallet. */
function minedCreation(input: Hex, from: string = OTHER) {
  return {
    waitForTransactionReceipt: async () => ({ status: "success", contractAddress: "0x3333333333333333333333333333333333333333", blockNumber: BigInt(77) }),
    getTransaction: async () => ({ from, to: null, input }),
  } as unknown as PublicClient;
}

describe("recording survives the switch (the kill switch stops new prepares only)", () => {
  const TX = `0x${"ab".repeat(32)}` as Hex;

  async function signedAndSent() {
    await setMainnetMode(db, "everyone", null);
    const plan = await prepare(OTHER);
    const input = {
      projectId,
      userId,
      wallet: OTHER,
      runId: plan.runId,
      chainId: MAINNET,
      contractName: "RTXToken",
      txHash: TX,
      sourceHash: plan.sourceHash,
      evmVersion: plan.evmVersion,
    };
    return { plan, input, client: minedCreation(plan.steps[0].bytecode) };
  }

  it("records a mainnet deploy that was signed before the switch went off", { timeout: 90_000 }, async () => {
    const { input, client } = await signedAndSent();
    await setMainnetMode(db, "off", ADMIN); // the owner pulls the switch after the wallet has signed
    const row = await recordDeployment(db, input, { client });
    expect(row.chainId).toBe(MAINNET);
    expect(row.address).toBe("0x3333333333333333333333333333333333333333");
    expect(await db.select().from(deployments).where(eq(deployments.projectId, projectId))).toHaveLength(1);
  });

  it("records it under admins for a wallet that isn't an admin, and with no row stored at all", { timeout: 90_000 }, async () => {
    const { input, client } = await signedAndSent();
    await setMainnetMode(db, "admins", null);
    await recordDeployment(db, input, { client });
    await db.delete(appSettings); // the default, off
    const again = await recordDeployment(db, input, { client });
    expect(again.txHash).toBe(TX);
  });

  it("records it even when the switch can't be read at all", { timeout: 90_000 }, async () => {
    const { input, client } = await signedAndSent();
    await db.delete(appSettings);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const real = db.select.bind(db);
    // Break only reads of the settings table: record must not depend on them.
    vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
      const q = (real as (...a: unknown[]) => { from: (t: unknown) => unknown })(...args);
      const from = q.from.bind(q);
      q.from = ((t: unknown) => {
        if (t === appSettings) throw new Error("settings unreadable");
        return from(t);
      }) as never;
      return q;
    }) as never);
    const row = await recordDeployment(db, input, { client });
    expect(row.chainId).toBe(MAINNET);
    spy.mockRestore();
  });

  it("still checks what the chain says: a stranger's transaction isn't recorded just because the switch is on or off", { timeout: 90_000 }, async () => {
    const { input, plan } = await signedAndSent();
    const stranger = minedCreation(plan.steps[0].bytecode, ADMIN);
    expect((await refused(recordDeployment(db, input, { client: stranger })))?.code).toBe("wrong_sender");
    expect((await refused(recordDeployment(db, { ...input, chainId: 1 }, { client: stranger })))?.code).toBe("unsupported_chain");
  });

  it("a recorded mainnet contract keeps its old-funds check and its explorer data while the switch is off", async () => {
    const OLD: Address = "0x00000000000000000000000000000000000000aa";
    const NEW: Address = "0x00000000000000000000000000000000000000bb";
    const WITHDRAW = [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [], outputs: [] }];
    const row = (address: string, createdAt: string) =>
      db.insert(deployments).values({ projectId, userId, version: 1, runId: "r", chainId: MAINNET, contractName: "Tip", address, deployer: OTHER, txHash: `0x${address}`, blockNumber: 1, compilerVersion: "0.8.28", evmVersion: "cancun", sourceHash: "0x1", abi: WITHDRAW, createdAt: new Date(createdAt) });
    await row(OLD, "2026-11-01");
    await row(NEW, "2026-11-02");
    expect(await getMainnetMode(db)).toBe("off");
    const client = { readContract: async ({ args }: { args: readonly unknown[] }) => (args[0] === OLD ? BigInt(9) : BigInt(0)) } as never;
    const out = await oldContractsWithFunds(db, { id: projectId, chainId: MAINNET }, client);
    expect(out.map((c) => [c.address, c.gdBalance, c.exits.map((e) => e.name)])).toEqual([[OLD, "9", ["withdraw"]]]);
  });
});
