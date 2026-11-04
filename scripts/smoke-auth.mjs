// End-to-end check of the sign-in API against a running server, with a throwaway key.
// Usage: BASE_URL=http://localhost:3000 node scripts/smoke-auth.mjs
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const host = new URL(base).host;
const account = privateKeyToAccount(generatePrivateKey());
let cookies = {};
let lastSetCookies = [];

function cookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function call(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie: cookieHeader() }, redirect: "manual" });
  lastSetCookies = res.headers.getSetCookie();
  for (const c of lastSetCookies) {
    const [pair] = c.split(";");
    const [k, ...v] = pair.split("=");
    const value = v.join("=");
    if (value) cookies[k] = value; else delete cookies[k];
  }
  return res;
}
const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
async function signedBody(attestation) {
  const { nonce } = await (await call("/api/auth/nonce")).json();
  const message = createSiweMessage({
    address: account.address, chainId: 11142220, domain: host, uri: base, version: "1", nonce,
    statement: "Sign in to GoodBuild. This is free and does not send a transaction.", issuedAt: new Date(),
  });
  const signature = await account.signMessage({ message });
  return { message, signature, walletKind: "external", ...(attestation ? { attestation } : {}) };
}
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

check("logged out: session is 401", (await call("/api/auth/session")).status === 401);
check("logged out: creating a project is 401", (await post("/api/projects", { prompt: "x" })).status === 401);

const n1 = await (await call("/api/auth/nonce")).json();
const n2 = await (await call("/api/auth/nonce")).json();
check("nonces are fresh per request", n1.nonce && n1.nonce !== n2.nonce);

{
  // A phishing site collects a signature for its own domain, then replays it with a forged host header.
  const { nonce } = await (await call("/api/auth/nonce")).json();
  const message = createSiweMessage({
    address: account.address, chainId: 11142220, domain: "evil.example", uri: "https://evil.example",
    version: "1", nonce, issuedAt: new Date(),
  });
  const signature = await account.signMessage({ message });
  const forged = await call("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-host": "evil.example", host: "evil.example" },
    body: JSON.stringify({ message, signature, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } }),
  });
  check("signature for another domain is refused, even with a forged host header", forged.status === 400, (await forged.json()).error);
}

let res = await post("/api/auth/verify", await signedBody(null));
check("first sign-in without attestation is refused", res.status === 403, (await res.json()).error);

const body = await signedBody({ ageOk: true, notUsPerson: true });
res = await post("/api/auth/verify", body);
check("sign-in with attestation succeeds", res.status === 200);
const sessionCookie = lastSetCookies.find((c) => c.startsWith("gb_session="));
check("session cookie is httpOnly + SameSite=Lax", /HttpOnly/i.test(sessionCookie ?? "") && /SameSite=Lax/i.test(sessionCookie ?? ""));

res = await post("/api/auth/verify", body);
check("replaying the same signed message is refused", res.status === 400, (await res.json()).error);

res = await call("/api/auth/session");
const session = await res.json();
check("session resolves to the signing wallet", session.user?.wallet === account.address.toLowerCase());

res = await post("/api/projects", { prompt: "A tip jar for our football club", templateId: "tip-jar", network: "celo-sepolia" });
const project = await res.json();
check("project created from the prompt", res.status === 201 && project.id, project.name);

res = await call(`/p/${project.id}`);
const html = await res.text();
check("workspace page shows the queued prompt", res.status === 200 && html.includes("A tip jar for our football club"));

res = await call("/api/auth/nonce", { headers: { "x-vercel-ip-country": "US" } });
check("US requests to the API are blocked (451)", res.status === 451);

res = await post("/api/auth/logout", {});
check("logout succeeds", res.status === 200);
check("after logout the session is 401", (await call("/api/auth/session")).status === 401);

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
