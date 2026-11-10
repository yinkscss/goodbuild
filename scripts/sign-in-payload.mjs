// Prints a SIWE sign-in body for a throwaway wallet and a given nonce, so the in-app browser can sign in:
//   node scripts/sign-in-payload.mjs <nonce> [origin]
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
const [nonce, origin = "http://localhost:3100"] = process.argv.slice(2);
const a = privateKeyToAccount(generatePrivateKey());
const message = createSiweMessage({ address: a.address, chainId: 11142220, domain: new URL(origin).host, uri: origin, version: "1", nonce, issuedAt: new Date() });
console.log(JSON.stringify({ message, signature: await a.signMessage({ message }), walletKind: "external", attestation: { ageOk: true, notUsPerson: true } }));
