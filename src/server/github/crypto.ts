import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { sessionSecret } from "@/server/auth/config";

/**
 * GitHub access tokens are encrypted at rest (D96). The key is derived from SESSION_SECRET, so no
 * new secret is needed; rotating SESSION_SECRET makes stored tokens unreadable and people reconnect.
 */
function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", sessionSecret(), "goodbuild", "github-token-v1", 32));
}

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64(iv), b64(cipher.getAuthTag()), b64(data)].join(".");
}

/** The token, or null when the value is malformed, tampered with or sealed with another key. */
export function decryptToken(sealed: string): string | null {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
