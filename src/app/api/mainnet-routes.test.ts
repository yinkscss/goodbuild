// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveFiles } from "@/server/agent/store";
import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { createProjectFromPrompt } from "@/server/projects";
import { getMainnetMode, setMainnetMode } from "@/server/settings/mainnet-access";


// The routes with the session and the database stood in, so what the request says can be tried
// against what the server decides (D50). A request must not be able to talk its way onto mainnet.

const ADMIN = "0xabcdef0000000000000000000000000000000001";
const USER = "0x7a3000000000000000000000000000000000e41c";

let db: Db;
let session: { user: { id: string; wallet: string }; chainId: number } | null;

vi.mock("@/server/auth/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    currentSession: async () => session,
    requireSession: async () => {
      if (!session) throw Object.assign(new Error("unauthenticated"), { status: 401 });
      return session;
    },
    errorResponse: (e: unknown) => NextResponse.json({ error: String(e) }, { status: 500 }),
  };
});
vi.mock("@/server/db/client", async (orig) => ({ ...(await orig<typeof import("@/server/db/client")>()), getDb: async () => db }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));

const mainnet = () => import("./mainnet/route");
const prepareRoute = () => import("./projects/[id]/deploy/prepare/route");
const createRoute = () => import("./projects/route");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const put = (body: unknown) => new Request("http://localhost/api/mainnet", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let projectId: string;

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("MAINNET_DEFAULT_MODE", "off"); // mainnet is open by default (D51); these tests are about the switch when closed
  vi.stubEnv("ADMIN_WALLETS", ADMIN);
  db = await createTestDb();
  const user = await signInUser(db, { wallet: USER, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  session = { user: { id: user.id, wallet: USER }, chainId: 11142220 };
  projectId = (await createProjectFromPrompt(db, user.id, { prompt: "x", network: "celo-sepolia" })).id;
  await saveFiles(db, projectId, { "contracts/deploy.json": "{}" });
});

describe("POST /api/projects/:id/deploy/prepare", () => {
  const call = async (body: unknown, headers?: Record<string, string>) => {
    const { POST } = await prepareRoute();
    const res = await POST(post(body, headers), { params: Promise.resolve({ id: projectId }) } as never);
    return { status: res.status, json: (await res.json()) as { error?: string; message?: string } };
  };

  it("refuses mainnet while off, in plain words, with a 422", async () => {
    const { status, json } = await call({ chainId: 42220 });
    expect(status).toBe(422);
    expect(json.error).toBe("mainnet_disabled");
    expect(json.message).toMatch(/switched off right now/);
  });

  it("can't be talked past by anything in the request: a mode, a wallet, an admin flag, a header, a cookie", async () => {
    const lies = {
      chainId: 42220,
      mode: "everyone",
      mainnet: true,
      mainnetAccess: "everyone",
      admin: true,
      wallet: ADMIN,
      userId: "x",
      NEXT_PUBLIC_ENABLE_MAINNET: "true",
    };
    const headers = {
      "x-mainnet-access": "everyone",
      "x-mainnet": "true",
      "x-admin": "1",
      "x-wallet": ADMIN,
      "x-forwarded-user": ADMIN,
      authorization: `Bearer ${ADMIN}`,
      cookie: "mainnet_access=everyone; ADMIN_WALLETS=" + USER,
    };
    expect((await call(lies, headers)).json.error).toBe("mainnet_disabled");
    await setMainnetMode(db, "admins", null);
    expect((await call(lies, headers)).json.error).toBe("mainnet_disabled"); // the session wallet is USER, not the ADMIN it claims
    expect(await getMainnetMode(db)).toBe("admins"); // and nothing in it changed the setting
  });

  it("a string for chainId, or an extra chain, doesn't slip past either", async () => {
    expect((await call({ chainId: "42220" })).status).toBe(400);
    expect((await call({ chainId: 42220.0 })).json.error).toBe("mainnet_disabled");
  });
});

describe("POST /api/projects (a new project's chain)", () => {
  it("starts on Sepolia when the switch won't let this wallet, even if the body asks for celo", async () => {
    const { POST } = await createRoute();
    await setMainnetMode(db, "admins", null);
    const res = await POST(post({ prompt: "a tip jar", network: "celo" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const { getOwnedProject } = await import("@/server/projects");
    expect((await getOwnedProject(db, id, session!.user.id))!.project.chainId).toBe(11142220);
    await setMainnetMode(db, "everyone", null);
    const again = (await (await POST(post({ prompt: "a tip jar", network: "celo" }))).json()) as { id: string };
    expect((await getOwnedProject(db, again.id, session!.user.id))!.project.chainId).toBe(42220);
  });
});

describe("GET /api/mainnet", () => {
  const get = async () => {
    const { GET } = await mainnet();
    const res = await GET();
    return { json: (await res.json()) as { allowed: boolean; admin?: boolean; mode?: string }, cache: res.headers.get("cache-control") };
  };

  it("says yes or no for this viewer, never stores the answer, and shows the setting only to an admin", async () => {
    expect((await get()).json).toEqual({ allowed: false });
    await setMainnetMode(db, "admins", null);
    expect((await get()).json).toEqual({ allowed: false });
    session = { user: { id: session!.user.id, wallet: ADMIN }, chainId: 11142220 };
    const admin = await get();
    expect(admin.json).toEqual({ allowed: true, admin: true, mode: "admins" });
    expect(admin.cache).toBe("no-store");
    await setMainnetMode(db, "everyone", null);
    session = null;
    expect((await get()).json).toEqual({ allowed: true }); // signed out sees only a yes or no
  });

  it("fails shut", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db = { select: () => { throw new Error("down"); } } as unknown as Db;
    expect((await get()).json).toEqual({ allowed: false });
  });
});

describe("PUT /api/mainnet", () => {
  const set = async (body: unknown) => {
    const { PUT } = await mainnet();
    const res = await PUT(put(body));
    return res.status;
  };

  it("is for admins only", async () => {
    expect(await set({ mode: "everyone" })).toBe(403);
    expect(await getMainnetMode(db)).toBe("off");
    session = null;
    expect(await set({ mode: "everyone" })).toBe(401);
    expect(await getMainnetMode(db)).toBe("off");
  });

  it("an admin sets it, an invalid mode is refused, and the next read sees it", async () => {
    session = { user: { id: session!.user.id, wallet: ADMIN }, chainId: 11142220 };
    expect(await set({ mode: "sometimes" })).toBe(400);
    expect(await set({})).toBe(400);
    expect(await set({ mode: "admins" })).toBe(200);
    expect(await getMainnetMode(db)).toBe("admins");
    expect(await set({ mode: "off" })).toBe(200);
    expect(await getMainnetMode(db)).toBe("off");
  });

  it("an admin who is no longer listed can't change it", async () => {
    session = { user: { id: session!.user.id, wallet: ADMIN }, chainId: 11142220 };
    vi.stubEnv("ADMIN_WALLETS", USER);
    expect(await set({ mode: "everyone" })).toBe(403);
  });
});
