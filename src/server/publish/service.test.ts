// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbAssetStore } from "@/server/agent/asset-store";
import { saveFiles } from "@/server/agent/store";
import { starterFiles } from "@/server/agent/template";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { publications } from "@/server/db/publish-schema";
import { projects, type Project } from "@/server/db/schema";
import { sourceKey } from "@/server/deploy/compile";
import { createProjectFromPrompt } from "@/server/projects";
import { PublishBuildError, type buildPublishedApp } from "./build";
import { PublishError, publishApp, publishStatus, publishedFile, publishedHeaders, undeployedContracts, unpublishApp } from "./service";

const WALLET = "0x7a3000000000000000000000000000000000e41c";
const SOL = "contracts/Tip.sol";
const APP_FILES = { "src/App.tsx": "x", "src/main.tsx": "x", "public/index.html": "<html>" };

let db: Db;
let userId: string;
let project: Project;

const fakeBuild = (marker = "v1"): typeof buildPublishedApp =>
  vi.fn(async () => [{ path: "index.html", mime: "text/html", bytes: new TextEncoder().encode(marker) }]);
const page = async (slug: string) => {
  const f = await publishedFile(db, slug, "index.html");
  return f && new TextDecoder().decode(f.bytes);
};
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: PublishError) => e.code);

async function newProject(prompt: string): Promise<Project> {
  const created = await createProjectFromPrompt(db, userId, { prompt, network: "celo-sepolia" });
  await saveFiles(db, created.id, APP_FILES);
  return created;
}

async function recordDeploy(name: string, sourceHash: string) {
  await db.insert(deployments).values({
    projectId: project.id, userId, version: 1, runId: "r", chainId: project.chainId, contractName: name, address: `0x${name.length}`, deployer: WALLET,
    txHash: `0x${sourceHash.slice(2, 10)}`, blockNumber: 1, compilerVersion: "0.8.28", evmVersion: "cancun", sourceHash, abi: [],
  });
}

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
  project = await newProject("Ikeja FC tip jar");
});

describe("publishApp", () => {
  it("publishes wallet helpers for the project's selected chain", async () => {
    const build = fakeBuild();
    await publishApp(db, { ...project, chainId: 42220 }, "mainnet-wallet", { build });
    const files = vi.mocked(build).mock.calls[0][0].files;
    expect(files["src/lib/chain.ts"]).toContain("export const chain = celo;");
    expect(files["src/lib/goodbuild/wallet.ts"]).toContain("export const appChain = celo;");
    expect(files["src/lib/chain.ts"]).toContain("[celoSepolia.id]: celoSepolia");
  });

  it("puts the app live on its address", async () => {
    const status = await publishApp(db, project, "tip-jar", { build: fakeBuild() });
    expect(status).toMatchObject({ slug: "tip-jar", live: true, publishedVersion: project.currentVersion });
    expect(await page("tip-jar")).toBe("v1");
  });

  it("refuses bad, reserved and taken addresses", async () => {
    const build = fakeBuild();
    expect(await code(publishApp(db, project, "Not Valid", { build }))).toBe("invalid_slug");
    expect(await code(publishApp(db, project, "gooddollar", { build }))).toBe("reserved_slug");
    await publishApp(db, project, "tip-jar", { build });
    const other = await newProject("Another app");
    expect(await code(publishApp(db, other, "tip-jar", { build }))).toBe("slug_taken");
  });

  it("keeps an address reserved after unpublishing", async () => {
    const build = fakeBuild();
    await publishApp(db, project, "tip-jar", { build });
    await unpublishApp(db, project);
    expect(await code(publishApp(db, await newProject("Copycat"), "tip-jar", { build }))).toBe("slug_taken");
    expect((await publishApp(db, project, "tip-jar", { build })).live).toBe(true);
  });

  it("refuses a project that is still the starter page", async () => {
    await saveFiles(db, project.id, starterFiles());
    expect((await publishStatus(db, project)).hasApp).toBe(false);
    const error = await publishApp(db, project, "tip-jar", { build: fakeBuild() }).catch((e: PublishError) => e);
    expect(error).toMatchObject({ code: "build_failed" });
    expect((error as PublishError).message).toMatch(/starter page/);
  });

  it("waits for a running build", async () => {
    const running = { ...project, turnStartedAt: new Date() };
    expect(await code(publishApp(db, running, "tip-jar", { build: fakeBuild() }))).toBe("busy");
  });

  it("won't republish an app that was taken down, and hides it", async () => {
    await publishApp(db, project, "tip-jar", { build: fakeBuild() });
    await db.update(publications).set({ disabledAt: new Date() }).where(eq(publications.projectId, project.id));
    expect(await page("tip-jar")).toBeNull();
    expect((await publishStatus(db, project)).live).toBe(false);
    expect(await code(publishApp(db, project, "tip-jar", { build: fakeBuild() }))).toBe("disabled");
  });

  it("keeps the live app untouched by later edits until republished", async () => {
    await publishApp(db, project, "tip-jar", { build: fakeBuild("v1") });
    await saveFiles(db, project.id, { ...APP_FILES, "src/App.tsx": "changed" });
    expect(await page("tip-jar")).toBe("v1");
    await publishApp(db, project, "tip-jar", { build: fakeBuild("v2") });
    expect(await page("tip-jar")).toBe("v2");
  });

  it("leaves the live app in place when a rebuild fails", async () => {
    await publishApp(db, project, "tip-jar", { build: fakeBuild("v1") });
    const failing = vi.fn(async () => {
      throw new PublishBuildError("The app didn't build.", ["src/App.tsx:1: nope"]);
    });
    const error = await publishApp(db, project, "tip-jar", { build: failing }).catch((e: PublishError) => e);
    expect(error).toMatchObject({ code: "build_failed", details: ["src/App.tsx:1: nope"] });
    expect(await page("tip-jar")).toBe("v1");
  });

  it("ships images but never design references", async () => {
    const store = dbAssetStore(db);
    const asset = { mime: "image/png" as const, bytes: new Uint8Array([1]), size: 1, width: 1, height: 1, palette: [], description: "" };
    await store.put(project.id, { ...asset, name: "logo.png", kind: "logo" });
    await store.put(project.id, { ...asset, name: "mock.png", kind: "reference" });
    const build = fakeBuild();
    await publishApp(db, project, "tip-jar", { build });
    const names = vi.mocked(build).mock.calls[0][0].assets.map((a) => a.name);
    expect(names).toEqual(["logo.png"]);
  });
});

describe("unpublishApp", () => {
  it("takes the app offline and deletes its files", async () => {
    await publishApp(db, project, "tip-jar", { build: fakeBuild() });
    expect((await unpublishApp(db, project)).live).toBe(false);
    expect(await page("tip-jar")).toBeNull();
    expect(await code(unpublishApp(db, project))).toBe("not_published");
  });
});

describe("undeployedContracts", () => {
  const files = { ...APP_FILES, [SOL]: "contract Tip {}", "contracts/test/Tip.t.sol": "test" };

  it("is empty for a website with no contracts (D20)", async () => {
    expect(await undeployedContracts(db, project, APP_FILES)).toEqual([]);
  });

  it("lists contracts until they're deployed, and ignores test files", async () => {
    expect(await undeployedContracts(db, project, files)).toEqual(["Tip"]);
    await recordDeploy("Tip", sourceKey(files, "cancun"));
    expect(await undeployedContracts(db, project, files)).toEqual([]);
  });

  it("doesn't count a deployment of older contract code", async () => {
    await recordDeploy("Tip", sourceKey(files, "cancun"));
    expect(await undeployedContracts(db, project, { ...files, [SOL]: "contract Tip { uint x; }" })).toEqual(["Tip"]);
  });

  it("only counts the project's own chain", async () => {
    await recordDeploy("Tip", sourceKey(files, "cancun"));
    await db.update(projects).set({ chainId: 42220 }).where(eq(projects.id, project.id));
    expect(await undeployedContracts(db, { id: project.id, chainId: 42220 }, files)).toEqual(["Tip"]);
  });
});

describe("publishedHeaders", () => {
  it("locks scripts to the app's own files and blocks framing", () => {
    const csp = publishedHeaders("index.html", "text/html", 1)["Content-Security-Policy"];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*(unsafe|https:)/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("revalidates HTML and caches hashed bundles forever", () => {
    expect(publishedHeaders("index.html", "text/html", 1)["Cache-Control"]).toBe("no-cache");
    expect(publishedHeaders("app.abc.js", "text/javascript", 1)["Cache-Control"]).toContain("immutable");
    expect(publishedHeaders("assets/a.png", "image/png", 1)["Cache-Control"]).not.toContain("immutable");
  });
});
