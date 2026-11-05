// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

function request(url: string, headers: Record<string, string> = {}) {
  const { host } = new URL(url);
  return new NextRequest(url, { headers: { host, ...headers } });
}
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

describe("published app hosts", () => {
  it("rewrites every path into that app's files", () => {
    expect(rewrittenTo(proxy(request("http://tip-jar.localhost:3000/")))).toMatch(/\/published-app\/tip-jar$/);
    expect(rewrittenTo(proxy(request("http://tip-jar.localhost:3000/app.abc.js")))).toContain("/published-app/tip-jar/app.abc.js");
  });

  it("can't reach the API or app pages", () => {
    for (const path of ["/api/projects", "/api/auth/session", "/home", "/p/some-id"]) {
      const res = proxy(request(`http://tip-jar.localhost:3000${path}`));
      expect(rewrittenTo(res)).toContain(`/published-app/tip-jar${path}`);
    }
  });

  it("blocks restricted regions", () => {
    expect(proxy(request("http://tip-jar.localhost:3000/", { "x-vercel-ip-country": "US" })).status).toBe(451);
    expect(rewrittenTo(proxy(request("http://tip-jar.localhost:3000/", { "x-vercel-ip-country": "NG" })))).toBeTruthy();
  });

  it("refuses nested subdomains", () => {
    expect(proxy(request("http://a.tip-jar.localhost:3000/")).status).toBe(404);
  });
});

describe("main host", () => {
  it("trusts Cloudflare's country over a visitor's fake Vercel header", () => {
    expect(proxy(request("http://localhost:3000/api/projects", { "cf-ipcountry": "US", "x-vercel-ip-country": "GB" })).status).toBe(451);
    expect(proxy(request("http://localhost:3000/api/projects", { "cf-ipcountry": "GB", "x-vercel-ip-country": "US" })).status).toBe(200);
  });

  describe("API writes from other sites", () => {
    const post = (headers: Record<string, string>) =>
      proxy(new NextRequest("http://localhost:3000/api/projects", { method: "POST", headers: { host: "localhost:3000", ...headers } }));

    it("refuses a published app, another site and a sandboxed frame", () => {
      expect(post({ origin: "http://tip-jar.localhost:3000", "sec-fetch-site": "same-site" }).status).toBe(403);
      expect(post({ origin: "http://tip-jar.localhost:3000" }).status).toBe(403);
      expect(post({ "sec-fetch-site": "same-site" }).status).toBe(403);
      expect(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }).status).toBe(403);
      expect(post({ origin: "null" }).status).toBe(403);
    });

    it("allows our own pages and non-browser callers", () => {
      expect(post({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }).status).toBe(200);
      expect(post({ "sec-fetch-site": "none" }).status).toBe(200);
      expect(post({}).status).toBe(200);
    });

    it("leaves reads alone, which CORS keeps from the other site", () => {
      expect(proxy(request("http://localhost:3000/api/auth/session", { origin: "http://tip-jar.localhost:3000", "sec-fetch-site": "same-site" })).status).toBe(200);
    });
  });

  it("can't serve published files", () => {
    expect(proxy(request("http://localhost:3000/published-app/tip-jar/app.abc.js")).status).toBe(404);
  });

  it("keeps the existing gates", () => {
    expect(proxy(request("http://localhost:3000/api/projects", { "x-vercel-ip-country": "US" })).status).toBe(451);
    expect(proxy(request("http://localhost:3000/home")).status).toBe(307);
    expect(proxy(request("http://localhost:3000/p/some-id/preview")).status).toBe(307);
    expect(proxy(request("http://localhost:3000/home", { cookie: "gb_session=x" })).status).toBe(200);
  });

  it("leaves public pages alone", () => {
    for (const path of ["/", "/docs"]) expect(proxy(request(`http://localhost:3000${path}`)).status).toBe(200);
  });
});
