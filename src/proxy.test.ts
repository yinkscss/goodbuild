// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";
import { SESSION_COOKIE } from "./lib/auth/cookie-names";
import { effectiveHost } from "./server/edge";

function request(url: string, headers: Record<string, string> = {}) {
  const { host } = new URL(url);
  return new NextRequest(url, { headers: { host, ...headers } });
}
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

describe("edge and backend (D26)", () => {
  const SECRET = "s3cret";
  afterEach(() => vi.unstubAllEnvs());
  const forwardedHeader = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  describe("on the edge", () => {
    beforeEach(() => {
      vi.stubEnv("BACKEND_ORIGIN", "https://api.example");
      vi.stubEnv("EDGE_SECRET", SECRET);
    });

    it("forwards API calls with the secret, overwriting anything the visitor sent", () => {
      const res = proxy(request("https://goodbuildit.xyz/api/projects?x=1", { "x-gb-edge": "fake", "x-gb-host": "fake.example" }));
      expect(rewrittenTo(res)).toBe("https://api.example/api/projects?x=1");
      expect(forwardedHeader(res, "x-gb-edge")).toBe(SECRET);
      expect(forwardedHeader(res, "x-gb-host")).toBe("goodbuildit.xyz");
    });

    it("forwards published apps and assets, and applies the gates first", () => {
      vi.stubEnv("PUBLISHED_APPS_DOMAIN", "goodbuildit.xyz");
      const app = proxy(request("https://tip-jar.goodbuildit.xyz/app.js"));
      expect(rewrittenTo(app)).toBe("https://api.example/published-app/tip-jar/app.js");
      expect(forwardedHeader(app, "x-gb-host")).toBe("tip-jar.goodbuildit.xyz");
      expect(rewrittenTo(proxy(request("https://goodbuildit.xyz/a/token")))).toBe("https://api.example/a/token");

      expect(proxy(request("https://tip-jar.goodbuildit.xyz/", { "x-vercel-ip-country": "US" })).status).toBe(451);
      expect(proxy(request("https://goodbuildit.xyz/api/projects", { "x-vercel-ip-country": "US" })).status).toBe(451);
      expect(proxy(new NextRequest("https://goodbuildit.xyz/api/projects", { method: "POST", headers: { host: "goodbuildit.xyz", origin: "https://tip-jar.goodbuildit.xyz" } })).status).toBe(403);
    });

    it("keeps pages on the edge", () => {
      expect(rewrittenTo(proxy(request("https://goodbuildit.xyz/")))).toBeNull();
      expect(proxy(request("https://goodbuildit.xyz/published-app/tip-jar")).status).toBe(404);
    });
  });

  describe("on the backend", () => {
    beforeEach(() => vi.stubEnv("EDGE_SECRET", SECRET));

    it("refuses anyone but the edge, so nobody can skip the region gate", () => {
      expect(proxy(request("https://api.example/api/projects")).status).toBe(404);
      expect(proxy(request("https://api.example/api/projects", { "x-gb-edge": "wrong-secret" })).status).toBe(404);
      expect(proxy(request("https://api.example/published-app/tip-jar")).status).toBe(404);
    });

    it("trusts the edge, and only then its host header", () => {
      expect(proxy(request("https://api.example/published-app/tip-jar", { "x-gb-edge": SECRET, "x-gb-host": "tip-jar.goodbuildit.xyz" })).status).toBe(200);
      expect(effectiveHost(new Headers({ host: "api.example", "x-gb-edge": SECRET, "x-gb-host": "tip-jar.goodbuildit.xyz" }))).toBe("tip-jar.goodbuildit.xyz");
      expect(effectiveHost(new Headers({ host: "api.example", "x-gb-edge": "nope", "x-gb-host": "evil.example" }))).toBe("api.example");
    });
  });
});

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

  it("sends the data API to its own route, with the query, and nothing else", () => {
    expect(rewrittenTo(proxy(request("http://tip-jar.localhost:3000/__gb/data/v1/c/posts?limit=2")))).toMatch(/\/app-data\/tip-jar\/v1\/c\/posts\?limit=2$/);
    expect(rewrittenTo(proxy(request("http://tip-jar.localhost:3000/app-data/other/v1/c/posts")))).toContain("/published-app/tip-jar/app-data/other");
  });

  it("refuses encoded data paths itself, before any route sees them", () => {
    for (const path of ["/__gb/data/v1/c/..%2f..%2fother/x", "/__gb/data/v1/c/notes%00/x", "/__gb/data/v1/c/a%2Fb"]) {
      const res = proxy(request(`http://tip-jar.localhost:3000${path}`));
      expect(res.status, path).toBe(404);
      expect(rewrittenTo(res), path).toBeNull();
    }
  });

  it("answers a blocked region on the data API with JSON", async () => {
    const res = proxy(request("http://tip-jar.localhost:3000/__gb/data/v1/c/posts", { "cf-ipcountry": "US" }));
    expect(res.status).toBe(451);
    expect(((await res.json()) as { error: string }).error).toBe("region_blocked");
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
  it("sends www to the main domain, which is the only one sign-in accepts", () => {
    vi.stubEnv("APP_DOMAIN", "goodbuildit.xyz");
    const res = proxy(request("https://www.goodbuildit.xyz/docs?x=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://goodbuildit.xyz/docs?x=1");
    vi.unstubAllEnvs();
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

  it("has no data routes", () => {
    expect(proxy(request("http://localhost:3000/app-data/tip-jar/v1/c/posts")).status).toBe(404);
  });

  it("can't serve published files", () => {
    expect(proxy(request("http://localhost:3000/published-app/tip-jar/app.abc.js")).status).toBe(404);
  });

  it("keeps the existing gates", () => {
    expect(proxy(request("http://localhost:3000/api/projects", { "x-vercel-ip-country": "US" })).status).toBe(451);
    expect(proxy(request("http://localhost:3000/home")).status).toBe(307);
    expect(proxy(request("http://localhost:3000/p/some-id/preview")).status).toBe(307);
    expect(proxy(request("http://localhost:3000/home", { cookie: `${SESSION_COOKIE}=x` })).status).toBe(200);
  });

  it("leaves public pages alone", () => {
    for (const path of ["/", "/docs"]) expect(proxy(request(`http://localhost:3000${path}`)).status).toBe(200);
  });
});

describe("signed-in app pages", () => {
  it.each(["/home", "/templates", "/deployments", "/credits", "/p/abc"])("sends %s to the landing page without a session cookie", (path) => {
    const res = proxy(request(`https://goodbuildit.xyz${path}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://goodbuildit.xyz/");
  });

  it("lets a request with a session cookie through", () => {
    const res = proxy(request("https://goodbuildit.xyz/templates", { cookie: "gb_session=x" }));
    expect(res.headers.get("location")).toBeNull();
  });
});
