import { decompressFromEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";

import { faceVerificationLink, faceVerificationMessage } from "./goodid";

const ACCOUNT = "0x7a3000000000000000000000000000000000e41c";

describe("face verification link", () => {
  it("names the checksummed account in the exact message GoodDollar expects", () => {
    const message = faceVerificationMessage(ACCOUNT);
    expect(message).toMatch(/^Sign this message to request verifying your account 0x[0-9a-fA-F]{40} and to create/);
    expect(message).not.toContain("<account>");
    expect(message).toContain("WARNING: do not sign this message unless you trust");
  });

  it("carries the signature and return address, compressed as the SDK does", () => {
    const link = new URL(faceVerificationLink(ACCOUNT, "0xsig", "https://goodbuildit.xyz/p/1", 1_700_000_000_000));
    expect(link.origin).toBe("https://goodid.gooddollar.org");
    const params = JSON.parse(decompressFromEncodedURIComponent(link.searchParams.get("lz")!)) as Record<string, unknown>;
    expect(params).toMatchObject({ nonce: "1700000000", fvsig: "0xsig", chain: 42220, rdu: "https://goodbuildit.xyz/p/1" });
    expect(String(params.account).toLowerCase()).toBe(ACCOUNT);
  });
});
