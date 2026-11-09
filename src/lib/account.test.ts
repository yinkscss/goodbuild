import { describe, expect, it } from "vitest";

import { markLive, maskSubject } from "./account";

const row = (id: string, name: string, at: string, chainId = 1, projectId = "p") => ({ id, projectId, chainId, contractName: name, createdAt: new Date(at) });

describe("markLive", () => {
  it("keeps only the newest deploy of each contract live, per project and network", () => {
    const rows = markLive([row("a", "Jar", "2026-11-01"), row("b", "Jar", "2026-11-05"), row("c", "Jar", "2026-11-03", 2), row("d", "Jar", "2026-11-02", 1, "q"), row("e", "Vote", "2026-11-01")]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.live]))).toEqual({ a: false, b: true, c: true, d: true, e: true });
  });
});

describe("maskSubject", () => {
  it("shortens wallets and ids, and echoes nothing else", () => {
    expect(maskSubject("0x7a3000000000000000000000000000000000e41c")).toBe("0x7a3…e41c");
    expect(maskSubject("anon:11111111-1111-4111-8111-111111111111")).toBe("Visitor 111111…");
    expect(maskSubject("email:22222222-2222-4222-8222-222222222222")).toBe("Email visitor 222222…");
    expect(maskSubject("someone@example.com")).toBe("Visitor");
    expect(maskSubject(null)).toBe("Hidden");
  });
});
