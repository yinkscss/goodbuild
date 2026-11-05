// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));
vi.mock("@/server/db/client", () => ({ getDb: async () => ({}) }));
const publishedFile = vi.fn();
vi.mock("@/server/publish/service", async (original) => ({
  ...(await original<typeof import("@/server/publish/service")>()),
  publishedFile: (...args: unknown[]) => publishedFile(...args),
}));

import { GET } from "./[slug]/[[...path]]/route";

const call = (host: string, slug: string, path?: string[]) =>
  GET(new Request(`http://${host}/published-app/${slug}`, { headers: { host } }), { params: Promise.resolve({ slug, path }) } as never);

beforeEach(() => {
  publishedFile.mockReset();
  publishedFile.mockResolvedValue({ mime: "text/html", bytes: new TextEncoder().encode("<p>app</p>") });
});

describe("serving published files", () => {
  it("serves the app on its own host, with the security headers", async () => {
    const res = await call("tip-jar.localhost:3000", "tip-jar");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(publishedFile).toHaveBeenCalledWith(expect.anything(), "tip-jar", "index.html");
  });

  it("never serves generated code on the main host", async () => {
    expect((await call("localhost:3000", "tip-jar")).status).toBe(404);
    expect(publishedFile).not.toHaveBeenCalled();
  });

  it("won't serve one app from another app's host", async () => {
    expect((await call("other-app.localhost:3000", "tip-jar")).status).toBe(404);
    expect(publishedFile).not.toHaveBeenCalled();
  });

  it("shows a plain page when the app or file is gone", async () => {
    publishedFile.mockResolvedValue(null);
    const res = await call("tip-jar.localhost:3000", "tip-jar", ["missing.js"]);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("isn't available");
  });
});
