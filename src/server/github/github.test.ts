// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { githubAccounts, githubRepos } from "@/server/db/github-schema";
import { createProjectFromPrompt } from "@/server/projects";
import { saveFiles } from "@/server/agent/store";
import { decryptToken, encryptToken } from "./crypto";
import { GITHUB_STATE_COOKIE, callbackDestination, checkState, newState, redirectToPath, safeReturnTo } from "./oauth";
import { createAndLink, linksOwnedByOthers, syncProject, toLink, unlinkProject } from "./sync";
import { buildTree, repoName, safePath } from "./tree";

describe("token encryption", () => {
  it("round-trips and doesn't leak the token", () => {
    const sealed = encryptToken("gho_secret123");
    expect(sealed).not.toContain("gho_secret123");
    expect(decryptToken(sealed)).toBe("gho_secret123");
  });
  it("refuses tampered or malformed values", () => {
    const sealed = encryptToken("gho_secret123");
    const [v, iv, tag, data] = sealed.split(".");
    expect(decryptToken([v, iv, tag, data.slice(0, -2) + "AA"].join("."))).toBeNull();
    expect(decryptToken("nonsense")).toBeNull();
    expect(decryptToken("")).toBeNull();
  });
});

describe("paths and trees", () => {
  it("keeps secrets and git internals out", () => {
    for (const p of [".env", ".env.local", ".envrc", ".envrc.local", "src/.envrc", "src/.env.production", ".git/config", "a/../b", "/abs", "node_modules/x/index.js", "a\\b", ""]) expect(safePath(p), p).toBe(false);
    for (const p of ["src/App.tsx", "contracts/Vault.sol", ".gitignore", "env.ts", "src/.envelope.ts"]) expect(safePath(p), p).toBe(true);
  });
  it("adds a README and .gitignore only when missing", () => {
    const a = buildTree({ "src/a.ts": "x", ".env": "SECRET=1" }, "My App");
    expect(a.tree.map((t) => t.path).sort()).toEqual([".gitignore", "README.md", "src/a.ts"]);
    expect(a.skipped).toEqual([".env"]);
    const b = buildTree({ "README.md": "mine", ".gitignore": "x" }, "My App");
    expect(b.tree).toHaveLength(2);
    expect(b.tree.find((t) => t.path === "README.md")?.content).toBe("mine");
  });
  it("makes repository names", () => {
    expect(repoName("My Savings Jar!")).toBe("my-savings-jar");
    expect(repoName("My Savings Jar", 1)).toBe("my-savings-jar-2");
    expect(repoName("!!!")).toBe("goodbuild-app");
  });
});

describe("oauth state", () => {
  it("only accepts paths on this site", () => {
    expect(safeReturnTo("/p/123?x=1")).toBe("/p/123?x=1");
    for (const bad of ["//evil.com", "https://evil.com", "\\evil", "/a\nb", "/\t/evil.example", "/\u0000x", null, ""]) expect(safeReturnTo(bad as string | null)).toBe("/settings?tab=github");
  });
  it("redirects with a path and no host, so a server bound to 0.0.0.0 can't send the browser there", () => {
    const res = redirectToPath("/p/abc?x=1", { github: "connected" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toBe("/p/abc?x=1&github=connected");
    expect(location).not.toMatch(/^[a-z]+:|0\.0\.0\.0|\.invalid/i);
    expect(redirectToPath("/", {}).headers.get("location")).toBe("/");
    expect(redirectToPath("/settings?tab=github", { github: "different_account", revoke: "manual" }).headers.get("location")).toBe("/settings?tab=github&github=different_account&revoke=manual");
    // An off-site or protocol-relative target still can't be used.
    expect(redirectToPath("//evil.com/x", { github: "failed" }).headers.get("location")).toBe("/settings?tab=github&github=failed");
    expect(redirectToPath("https://evil.com", {}).headers.get("location")).toBe("/settings?tab=github");
  });
  it("sends the person to Settings when a revocation wasn't confirmed, wherever they started", () => {
    expect(callbackDestination("/p/abc", true)).toBe("/settings?tab=github");
    expect(callbackDestination("/p/abc", false)).toBe("/p/abc");
    expect(callbackDestination("//evil.com", false)).toBe("/settings?tab=github");
  });
  it("needs the same state and the same person", async () => {
    const { state, cookie } = await newState("user-1", "/p/abc");
    expect(await checkState(cookie, state, "user-1")).toEqual({ returnTo: "/p/abc" });
    expect(await checkState(cookie, "other", "user-1")).toBeNull();
    expect(await checkState(cookie, state, "user-2")).toBeNull();
    expect(await checkState(undefined, state, "user-1")).toBeNull();
    expect(await checkState("garbage", state, "user-1")).toBeNull();
    expect(GITHUB_STATE_COOKIE).toBe("gb_gh_state");
  });
});

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

describe("syncing to GitHub", () => {
  let db: Db;
  let userId: string;
  let projectId: string;
  let calls: Call[];
  let head: string;
  let createStatus: number[];
  let defaultBranch: string;
  let treeStatus: number;

  function mockGithub() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
        calls.push({ method, url, body });
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        if (url.endsWith("/user")) return json({ id: 1, login: "ada" });
        if (url.endsWith("/user/repos")) {
          const status = createStatus.shift() ?? 201;
          return status === 201 ? json({ full_name: `ada/${body?.name}`, default_branch: defaultBranch, html_url: "x" }, 201) : json({ message: "name exists" }, status);
        }
        if (method === "GET" && url.includes("/git/ref/heads/")) return json({ object: { sha: head } });
        if (url.endsWith("/git/trees")) return treeStatus === 201 ? json({ sha: "tree1" }, 201) : json({ message: "Validation Failed" }, treeStatus);
        if (method === "POST" && url.endsWith("/git/refs")) return json({}, 201);
        if (method === "PATCH" && /\/repos\/[^/]+\/[^/]+$/.test(url)) return json({});
        if (url.endsWith("/git/commits")) return json({ sha: "commit-" + calls.length }, 201);
        if (method === "PATCH" && url.includes("/git/refs/heads/")) {
          head = String(body?.sha);
          return json({});
        }
        return json({ message: "unexpected " + url }, 500);
      }),
    );
  }

  beforeEach(async () => {
    db = await createTestDb();
    calls = [];
    head = "init-sha";
    createStatus = [];
    defaultBranch = "main";
    treeStatus = 201;
    const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
    userId = user.id;
    projectId = (await createProjectFromPrompt(db, userId, { prompt: "A savings jar for our club", network: "celo-sepolia" })).id;
    await saveFiles(db, projectId, { "src/App.tsx": "export default 1", ".env": "SECRET=1" });
    await db.insert(githubAccounts).values({ userId, githubId: "1", login: "ada", tokenEnc: encryptToken("gho_tok"), scope: "public_repo" });
    mockGithub();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a public repo, pushes one commit on main and never sends the token or .env", async () => {
    const link = await createAndLink(db, userId, projectId);
    expect(link.status).toBe("synced");
    expect(link.fullName).toBe("ada/savings-jar");
    const create = calls.find((c) => c.url.endsWith("/user/repos"))!;
    expect(create.body).toMatchObject({ private: false, auto_init: true });
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!.body as { tree: { path: string }[] };
    expect(tree.tree.map((t) => t.path)).not.toContain(".env");
    expect(tree.tree.map((t) => t.path)).toContain("src/App.tsx");
    const move = calls.find((c) => c.method === "PATCH")!;
    expect(move.body).toMatchObject({ force: false });
    expect(JSON.stringify(calls)).not.toContain("SECRET=1");
  });

  it("tries another name when GitHub says the name is taken", async () => {
    createStatus = [422, 422];
    const link = await createAndLink(db, userId, projectId);
    expect(link.fullName.endsWith("-3")).toBe(true);
  });

  it("refuses a second repository for the same app", async () => {
    await createAndLink(db, userId, projectId);
    await expect(createAndLink(db, userId, projectId)).rejects.toMatchObject({ code: "already_linked" });
  });

  it("pauses instead of overwriting when someone else committed, and overwrite adds a commit on top", async () => {
    await createAndLink(db, userId, projectId);
    head = "someone-elses-commit";
    calls.length = 0;
    const paused = await syncProject(db, projectId);
    expect(paused?.status).toBe("diverged");
    expect(calls.some((c) => c.method === "PATCH" || c.url.endsWith("/git/trees"))).toBe(false);

    const forced = await syncProject(db, projectId, { overwrite: true });
    expect(forced?.status).toBe("synced");
    const commit = calls.find((c) => c.url.endsWith("/git/commits"))!.body as { parents: string[] };
    expect(commit.parents).toEqual(["someone-elses-commit"]);
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ force: false });
  });

  async function bumpVersion(n: number) {
    const { projects } = await import("@/server/db/schema");
    await db.update(projects).set({ currentVersion: n }).where(eq(projects.id, projectId));
  }

  it("treats a rejected branch move as someone else pushing only when the branch really moved", async () => {
    await createAndLink(db, userId, projectId);
    await bumpVersion(5);
    let moved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PATCH") {
          moved = true; // someone pushed between our read and our write
          return new Response(JSON.stringify({ message: "Update is not a fast forward" }), { status: 422 });
        }
        if (url.includes("/git/ref/heads/")) return new Response(JSON.stringify({ object: { sha: moved ? "theirs" : head } }));
        return new Response(JSON.stringify({ sha: "x" }), { status: 201 });
      }),
    );
    expect((await syncProject(db, projectId))?.status).toBe("diverged");
  });

  it("does not call a rejected tree a divergence, and keeps trying later", async () => {
    await createAndLink(db, userId, projectId);
    await bumpVersion(6);
    treeStatus = 422;
    const result = await syncProject(db, projectId);
    expect(result?.status).toBe("error");
    expect(result?.error).toMatch(/Validation Failed/);
    treeStatus = 201;
    expect((await syncProject(db, projectId))?.status).toBe("synced");
  });

  it("does not call a 422 divergence when the branch didn't move", async () => {
    await createAndLink(db, userId, projectId);
    await bumpVersion(7);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PATCH") return new Response(JSON.stringify({ message: "Reference update failed" }), { status: 422 });
        if (url.includes("/git/ref/heads/")) return new Response(JSON.stringify({ object: { sha: head } }));
        return new Response(JSON.stringify({ sha: "x" }), { status: 201 });
      }),
    );
    expect((await syncProject(db, projectId))?.status).toBe("error");
  });

  it("makes main when the person's default branch is called master", async () => {
    defaultBranch = "master";
    const link = await createAndLink(db, userId, projectId);
    expect(link.branch).toBe("main");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/git/refs") && c.body?.ref === "refs/heads/main")).toBe(true);
    expect(calls.some((c) => c.method === "PATCH" && c.body?.default_branch === "main")).toBe(true);
  });

  it("keeps the default branch when main can't be made", async () => {
    defaultBranch = "trunk";
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => (String(input).endsWith("/git/refs") && init?.method === "POST" ? new Response("{}", { status: 403 }) : original(input, init))));
    const link = await createAndLink(db, userId, projectId);
    expect(link.branch).toBe("trunk");
  });

  it("runs a manual and an automatic push one after the other", async () => {
    await createAndLink(db, userId, projectId);
    await bumpVersion(8);
    let active = 0;
    let overlap = false;
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        active++;
        if (active > 1) overlap = true;
        await new Promise((r) => setTimeout(r, 5));
        const res = await inner(input, init);
        active--;
        return res;
      }),
    );
    const [a, b] = await Promise.all([syncProject(db, projectId), syncProject(db, projectId)]);
    expect(overlap).toBe(false);
    expect([a?.status, b?.status]).toEqual(["synced", "synced"]);
  });

  /** Holds every push at its tree request until released, and says when one has got there (no sleeping and hoping). */
  function holdPushes() {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const arrived = new Promise<void>((r) => (reached = r));
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("/git/trees")) {
          reached();
          await gate;
        }
        return inner(input, init);
      }),
    );
    return { release, arrived };
  }

  it("an old push can't write its result onto a repository linked afterwards", async () => {
    await createAndLink(db, userId, projectId);
    await bumpVersion(9);
    const { release, arrived } = holdPushes();
    const running = syncProject(db, projectId);
    await arrived; // the push is really in flight
    const unlinking = unlinkProject(db, projectId); // waits for it, in this process
    release();
    await running;
    await unlinking;
    expect(await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId))).toHaveLength(0);
    // Relink to a new repository: it starts clean.
    const again = await createAndLink(db, userId, projectId);
    expect(again.status).toBe("synced");
    expect(again.lastVersion).toBe(9);
  });

  it("a push from another process can't write onto a link made after it started, even to the same repository name", async () => {
    const first = await createAndLink(db, userId, projectId);
    await bumpVersion(10);
    const { release, arrived } = holdPushes();
    const running = syncProject(db, projectId); // the "worker": stuck mid-push
    await arrived; // it has read the old link and is waiting on GitHub
    // The "web server" unlinks and links again straight in the database, without the worker's lock, to the same repository name.
    await db.delete(githubRepos).where(eq(githubRepos.projectId, projectId));
    await db.insert(githubRepos).values({ projectId, userId, fullName: first.fullName, branch: "main", lastCommitSha: "fresh-link-sha", lastVersion: 1, status: "synced" });
    release();
    await running;
    const [row] = await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId));
    expect(row.lastCommitSha).toBe("fresh-link-sha");
    expect(row.lastVersion).toBe(1);
    expect(row.status).toBe("synced");
    expect(row.error).toBeNull();
  });

  it("finds apps synced to a different GitHub account, by account id so a rename doesn't count", async () => {
    await createAndLink(db, userId, projectId);
    expect(await linksOwnedByOthers(db, userId, { id: 1, login: "ada" })).toEqual([]);
    expect(await linksOwnedByOthers(db, userId, { id: 1, login: "ada-renamed" })).toEqual([]);
    expect(await linksOwnedByOthers(db, userId, { id: 2, login: "grace" })).toHaveLength(1);
    expect(await linksOwnedByOthers(db, userId, { id: 2, login: "ada" })).toHaveLength(1);
  });

  it("treats a branch move that landed but wasn't recorded as GoodBuild's own, and still pauses for anyone else's", async () => {
    await createAndLink(db, userId, projectId);
    await bumpVersion(11);
    // The push moved the branch to "ours", then writing the result failed.
    await db.update(githubRepos).set({ pendingSha: "ours" }).where(eq(githubRepos.projectId, projectId));
    head = "ours";
    expect((await syncProject(db, projectId))?.status).toBe("synced");
    const [row] = await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId));
    expect(row.pendingSha).toBeNull();

    await bumpVersion(12);
    await db.update(githubRepos).set({ pendingSha: "ours-2" }).where(eq(githubRepos.projectId, projectId));
    head = "someone-else";
    expect((await syncProject(db, projectId))?.status).toBe("diverged");
  });

  it("a 401 for an old token doesn't remove the account connected since", async () => {
    await createAndLink(db, userId, projectId);
    await bumpVersion(13);
    const fresh = encryptToken("gho_newer");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // While this request is in flight the person connects again.
        await db.update(githubAccounts).set({ tokenEnc: fresh }).where(eq(githubAccounts.userId, userId));
        return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      }),
    );
    expect((await syncProject(db, projectId))?.status).toBe("error");
    const [account] = await db.select().from(githubAccounts).where(eq(githubAccounts.userId, userId));
    expect(account?.tokenEnc).toBe(fresh);
  });

  it("marks a push that began long ago and never finished as stale, and a recent one as running", async () => {
    await createAndLink(db, userId, projectId);
    const set = (ago: number) => db.update(githubRepos).set({ status: "syncing", syncingSince: new Date(Date.now() - ago) }).where(eq(githubRepos.projectId, projectId));
    const read = async () => toLink((await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId)))[0]);
    await set(60_000);
    expect((await read()).stale).toBe(false);
    await set(10 * 60_000);
    expect((await read()).stale).toBe(true);
    // And it can simply be tried again.
    expect((await syncProject(db, projectId))?.status).toBe("synced");
  });

  it("forgets the account when GitHub says the token is revoked", async () => {
    await createAndLink(db, userId, projectId);
    await db.update((await import("@/server/db/schema")).projects).set({ currentVersion: 9 }).where(eq((await import("@/server/db/schema")).projects.id, projectId));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })));
    const result = await syncProject(db, projectId);
    expect(result?.status).toBe("error");
    expect(result?.error).toMatch(/Connect GitHub again/);
    expect(await db.select().from(githubAccounts).where(eq(githubAccounts.userId, userId))).toHaveLength(0);
    expect(await db.select().from(githubRepos).where(eq(githubRepos.projectId, projectId))).toHaveLength(1);
  });

  it("does nothing when already up to date", async () => {
    await createAndLink(db, userId, projectId);
    calls.length = 0;
    const link = await syncProject(db, projectId);
    expect(link?.status).toBe("synced");
    expect(calls.some((c) => c.url.endsWith("/git/trees"))).toBe(false);
  });
});
