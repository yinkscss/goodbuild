// @vitest-environment node
import { describe, expect, it } from "vitest";

import { assetToken, publicAssetOrigin, publicAssetUrl, verifyAssetToken } from "./asset-url";

const P = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";

describe("signed asset URLs", () => {
  it("round-trips and rejects tampering", () => {
    const t = assetToken(P, A);
    expect(verifyAssetToken(t)).toEqual({ projectId: P, assetId: A });
    const [payload, mac] = t.split(".");
    const other = Buffer.from(`${P}.33333333-3333-4333-8333-333333333333`).toString("base64url");
    expect(verifyAssetToken(`${other}.${mac}`)).toBeNull();
    expect(verifyAssetToken(`${payload}.${mac.slice(0, -2)}xx`)).toBeNull();
    expect(verifyAssetToken(`${payload}.${mac}.extra`)).toBeNull();
    expect(verifyAssetToken("garbage")).toBeNull();
  });
  it("is only used on a public https deployment", () => {
    expect(publicAssetOrigin({ NODE_ENV: "production", APP_DOMAIN: "goodbuild.app" } as NodeJS.ProcessEnv)).toBe("https://goodbuild.app");
    expect(publicAssetOrigin({ NODE_ENV: "development", APP_DOMAIN: "goodbuild.app" } as NodeJS.ProcessEnv)).toBeNull();
    expect(publicAssetOrigin({ NODE_ENV: "production", APP_DOMAIN: "localhost:3000" } as NodeJS.ProcessEnv)).toBeNull();
    expect(publicAssetOrigin({ NODE_ENV: "production", PUBLIC_ASSET_ORIGIN: "http://cdn.example" } as NodeJS.ProcessEnv)).toBeNull();
    expect(publicAssetOrigin({ NODE_ENV: "production", PUBLIC_ASSET_ORIGIN: "https://cdn.example/" } as NodeJS.ProcessEnv)).toBe("https://cdn.example");
    expect(publicAssetUrl("https://goodbuild.app", P, A)).toMatch(/^https:\/\/goodbuild\.app\/a\/[\w-]+\.[\w-]+$/);
  });
});
