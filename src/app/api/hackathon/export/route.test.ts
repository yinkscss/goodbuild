// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: null as null | { user: { wallet: string } },
}));
const csv = vi.hoisted(() =>
  vi.fn(async () => '"email"\r\n"builder@example.com"'),
);
vi.mock("@/server/auth/http", async (original) => {
  const real = await original<typeof import("@/server/auth/http")>();
  const { AuthError } = await import("@/server/auth/errors");
  return {
    ...real,
    requireSession: async () => {
      if (!state.session) throw new AuthError("unauthenticated");
      return state.session;
    },
  };
});
vi.mock("@/server/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/hackathon/community", () => ({ participantCsv: csv }));
import { GET as route } from "./route";
const GET = (event?: string) => route(new Request(`http://localhost/api/hackathon/export${event ? `?event=${event}` : ""}`));
afterEach(() => {
  state.session = null;
  vi.unstubAllEnvs();
  csv.mockClear();
});
it("rejects signed-out and non-admin callers before reading emails", async () => {
  expect((await GET()).status).toBe(401);
  state.session = { user: { wallet: "0x" + "a".repeat(40) } };
  vi.stubEnv("ADMIN_WALLETS", "0x" + "b".repeat(40));
  expect((await GET()).status).toBe(403);
  expect(csv).not.toHaveBeenCalled();
});
it("allows only the configured admin to download the private CSV", async () => {
  const wallet = "0x" + "a".repeat(40);
  state.session = { user: { wallet } };
  vi.stubEnv("ADMIN_WALLETS", wallet);
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/csv");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.text()).toContain("builder@example.com");
});
it("exports the FUTMinna signups on ?event=futminna, under their own file name (D160)", async () => {
  const wallet = "0x" + "a".repeat(40);
  state.session = { user: { wallet } };
  vi.stubEnv("ADMIN_WALLETS", wallet);
  const res = await GET("futminna");
  expect(res.status).toBe(200);
  expect(csv).toHaveBeenLastCalledWith(expect.anything(), "futminna");
  expect(res.headers.get("content-disposition")).toContain("goodbuild-futminna-signups.csv");
});
