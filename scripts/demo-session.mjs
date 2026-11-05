// Sign in a throwaway wallet against a running server and optionally seed projects.
// Prints the session cookie value, for screenshots and manual testing without Magic.
// Usage: BASE_URL=http://localhost:3000 node scripts/demo-session.mjs [--seed]
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const account = privateKeyToAccount(generatePrivateKey());
const jar = {};
async function call(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const c of res.headers.getSetCookie()) {
    const [k, ...v] = c.split(";")[0].split("=");
    if (v.join("=")) jar[k] = v.join("=");
  }
  return res;
}
const { nonce } = await (await call("/api/auth/nonce")).json();
const message = createSiweMessage({
  address: account.address, chainId: 11142220, domain: new URL(base).host, uri: base, version: "1", nonce, issuedAt: new Date(),
});
const signature = await account.signMessage({ message });
const res = await call("/api/auth/verify", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ message, signature, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } }),
});
if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
if (process.argv.includes("--seed")) {
  const prompts = [
    ["Co-op grain fund: members pool G$ to buy maize in bulk, released by a 3-of-5 vote.", null],
    ["Tickets for a 300-person campus concert, sold for 200 G$ each as NFTs.", "event-tickets"],
    ["Ikeja FC tip jar that splits G$ 70/30 between the coach and the kit fund.", null],
    ["A weekly G$ savings circle for 12 members, 50 G$ every Friday.", "savings-circle"],
  ];
  for (const [prompt, templateId] of prompts) {
    await call("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, templateId, network: "celo-sepolia" }) });
  }
}
console.log(JSON.stringify({ wallet: account.address, gb_session: jar.gb_session }));
