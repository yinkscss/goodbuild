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
    expect(rewrittenTo(proxy(request("http://tip-jar.localhost:3000/")))).toContain("/published-app/tip-jar/");
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
