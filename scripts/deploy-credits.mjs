// Deploys GoodBuildCredits v2 (D56). Dry run by default: prints what it would do and touches nothing.
//
//   node scripts/compile-credits.mjs
//   CREDITS_NETWORK=celo CREDITS_QUOTE_SIGNER=0x… DEPLOYER_PRIVATE_KEY=0x… CONFIRM_MAINNET=yes \
//     node scripts/deploy-credits.mjs --send
//
// CREDITS_NETWORK: "celo" (mainnet, 42220) or "celo-sepolia".
// CREDITS_ADMIN: the owner. Defaults to GoodBuild's admin 0xf0449277E30CC9063147bfB9Ecdf036BF9d41531. The deployer key pays gas
//   only and gets no power over the contract.
// CREDITS_QUOTE_SIGNER: the address whose key the server uses to sign quotes (CREDITS_QUOTE_SIGNER_KEY on the server).
// CREDITS_GOODDOLLAR: the G$ token. Defaults to the real G$ on Celo mainnet; Sepolia needs GoodBuild's test G$ (NEXT_PUBLIC_TEST_GD_ADDRESS).
// CREDITS_MAX_PER_QUOTE: most credits (GBC units, 6 decimals) one quote or grant may release. Default 1,000 credits.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

const MAINNET_GD = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const DEFAULT_ADMIN = "0xf0449277E30CC9063147bfB9Ecdf036BF9d41531";

const root = path.resolve(import.meta.dirname, "..");
const chain = { celo, "celo-sepolia": celoSepolia }[process.env.CREDITS_NETWORK ?? "celo-sepolia"];
if (!chain) throw new Error("CREDITS_NETWORK must be celo or celo-sepolia");
const need = (name, fallback) => {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const admin = need("CREDITS_ADMIN", DEFAULT_ADMIN);
const signer = need("CREDITS_QUOTE_SIGNER");
const gd = need("CREDITS_GOODDOLLAR", chain.id === 42220 ? MAINNET_GD : undefined);
for (const a of [admin, signer, gd]) if (!isAddress(a)) throw new Error(`Not an address: ${a}`);
const maxPerQuote = BigInt(process.env.CREDITS_MAX_PER_QUOTE ?? 1_000_000_000);
const artifact = JSON.parse(fs.readFileSync(path.join(root, "contracts/build/GoodBuildCredits.json"), "utf8"));
const args = [getAddress(admin), getAddress(gd), getAddress(signer), maxPerQuote];

console.log(`Network ${chain.name} (${chain.id}); admin ${admin}; G$ ${gd}; quote signer ${signer}; max ${maxPerQuote} units per quote; supply 10,000,000 credits`);
if (!process.argv.includes("--send")) {
  console.log("Dry run. Add --send (and DEPLOYER_PRIVATE_KEY) to deploy.");
  process.exit(0);
}
if (chain.id === 42220 && process.env.CONFIRM_MAINNET !== "yes") throw new Error("Mainnet deploy needs CONFIRM_MAINNET=yes");
const account = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY"));
const rpc = process.env.CELO_RPC_URL ? http(process.env.CELO_RPC_URL) : http();
const pub = createPublicClient({ chain, transport: rpc });
const wallet = createWalletClient({ account, chain, transport: rpc });
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
console.log(`Sent ${hash}, waiting…`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deploy failed");
const addr = receipt.contractAddress;
const read = (fn) => pub.readContract({ address: addr, abi: artifact.abi, functionName: fn });
const [owner, supply, goodDollar, quoteSigner] = await Promise.all([read("owner"), read("totalSupply"), read("goodDollar"), read("quoteSigner")]);
console.log(`GoodBuildCredits at ${addr} (block ${receipt.blockNumber}).`);
console.log(`Verified on-chain: owner ${owner}; supply ${supply} (10,000,000 credits = 10000000000000); G$ ${goodDollar}; signer ${quoteSigner}.`);
console.log(`Set on the server: CREDITS_CONTRACT_${chain.id}=${addr} and CREDITS_START_BLOCK_${chain.id}=${receipt.blockNumber}`);
console.log("The owner (admin) accepts nothing: ownership is already theirs. Verify the source on Sourcify/Celoscan.");
