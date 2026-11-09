// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));
const assets = { list: vi.fn(), get: vi.fn() };
vi.mock("@/server/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/agent/asset-store", () => ({ dbAssetStore: () => assets }));

import { clearPreviews, putPreview } from "@/server/preview/cache";

import { GET } from "./[token]/[[...path]]/route";

const TOKEN = "a".repeat(32);
const HOST = `pv-${TOKEN}.localhost:3000`;
const call = (host: string, token: string, path?: string[]) =>
  GET(new Request(`http://${host}/preview-app/${token}`, { headers: { host } }), { params: Promise.resolve({ token, path }) } as never);
const text = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  clearPreviews();
  assets.list.mockReset();
  assets.get.mockReset();
  putPreview(TOKEN, "project-1", "b1", [
    { path: "index.html", mime: "text/html; charset=utf-8", bytes: text("<p>preview</p>") },
    { path: "app.abc.js", mime: "text/javascript; charset=utf-8", bytes: text("1") },
  ]);
});

describe("serving a preview", () => {
  it("serves the build on the project's preview host, framed only by the workspace and never cached", async () => {
    const res = await call(HOST, TOKEN);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>preview</p>");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors http://localhost:3000");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await call(HOST, TOKEN, ["app.abc.js"])).headers.get("content-type")).toContain("javascript");
  });

  it("never serves generated code on the main host, an app's host or another project's preview host", async () => {
    expect((await call("localhost:3000", TOKEN)).status).toBe(404);
    expect((await call("tip-jar.localhost:3000", TOKEN)).status).toBe(404);
    expect((await call(`pv-${"b".repeat(32)}.localhost:3000`, TOKEN)).status).toBe(404);
  });

  it("says the preview expired when the build is gone or the file isn't in it", async () => {
    expect((await call(HOST, TOKEN, ["nope.js"])).status).toBe(404);
    clearPreviews();
    const res = await call(HOST, TOKEN);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("expired");
  });

  it("serves the project's uploaded images, and not its design references or another project's files", async () => {
    assets.list.mockResolvedValue([
      { id: "a1", name: "logo.png", kind: "logo" },
      { id: "a2", name: "mockup.png", kind: "reference" },
    ]);
    assets.get.mockResolvedValue({ mime: "image/png", bytes: text("png") });
    const res = await call(HOST, TOKEN, ["assets", "logo.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(assets.list).toHaveBeenCalledWith("project-1");
    expect(assets.get).toHaveBeenCalledWith("project-1", "a1");
    expect((await call(HOST, TOKEN, ["assets", "mockup.png"])).status).toBe(404);
    expect((await call(HOST, TOKEN, ["assets", "..", "index.html"])).status).toBe(404);
  });
});
