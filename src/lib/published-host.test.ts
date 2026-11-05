import { describe, expect, it } from "vitest";

import { classifyHost, publishedAppUrl, publishedAppsDomain, slugFromName, slugProblem } from "./published-host";

describe("slugs", () => {
  it.each(["tip-jar", "abc", "ikeja-fc-2"])("accepts %s", (s) => expect(slugProblem(s)).toBeNull());
  it.each(["ab", "-tip", "tip-", "Tip", "a_b", "a.b", "xn--abc", "a".repeat(41)])("rejects %s", (s) => expect(slugProblem(s)).toBe("invalid"));
  it.each(["www", "api", "docs", "gooddollar", "metamask"])("reserves %s", (s) => expect(slugProblem(s)).toBe("reserved"));

  it("suggests a usable slug from any project name", () => {
    expect(slugFromName("Ikeja FC tip jar")).toBe("ikeja-fc-tip-jar");
    expect(slugFromName("G$ savings circle")).toBe("g-savings-circle");
    for (const name of ["Celo", "!!!", "", "x", "a".repeat(80)]) expect(slugProblem(slugFromName(name))).toBeNull();
  });
});

describe("hosts", () => {
  const domain = "goodbuildit.xyz";

  it("sends the apex and unrelated hosts to the main site", () => {
    expect(classifyHost("goodbuildit.xyz", domain)).toEqual({ kind: "main" });
    expect(classifyHost("preview-123.vercel.app", domain)).toEqual({ kind: "main" });
    expect(classifyHost("evilgoodbuildit.xyz", domain)).toEqual({ kind: "main" });
    expect(classifyHost(null, domain)).toEqual({ kind: "main" });
  });

  it("recognises an app subdomain, ignoring case and port", () => {
    expect(classifyHost("Tip-Jar.goodbuildit.xyz:443", domain)).toEqual({ kind: "app", slug: "tip-jar" });
    expect(classifyHost("tip-jar.localhost:3000", "localhost")).toEqual({ kind: "app", slug: "tip-jar" });
  });

  it("leaves reserved labels to the main site and refuses nested or malformed ones", () => {
    expect(classifyHost("www.goodbuildit.xyz", domain)).toEqual({ kind: "main" });
    expect(classifyHost("a.tip-jar.goodbuildit.xyz", domain)).toEqual({ kind: "unknown" });
    expect(classifyHost("-x.goodbuildit.xyz", domain)).toEqual({ kind: "unknown" });
  });

  it("builds the public address for production and development", () => {
    expect(publishedAppUrl("tip-jar", "goodbuildit.xyz", domain)).toBe("https://tip-jar.goodbuildit.xyz");
    expect(publishedAppUrl("tip-jar", "localhost:3111", "localhost")).toBe("http://tip-jar.localhost:3111");
  });

  it("defaults the domain by environment", () => {
    expect(publishedAppsDomain({ NODE_ENV: "production" })).toBe("goodbuildit.xyz");
    expect(publishedAppsDomain({ NODE_ENV: "development" })).toBe("localhost");
    expect(publishedAppsDomain({ NODE_ENV: "production", PUBLISHED_APPS_DOMAIN: "Example.org" })).toBe("example.org");
  });
});
