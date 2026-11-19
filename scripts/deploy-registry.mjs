// Deploys GoodBuildRegistry (D156). Dry run by default: prints what it would do and touches nothing.
//
//   node scripts/compile-credits.mjs        (also compiles the registry)
//   REGISTRY_RECORDER=0x… DEPLOYER_PRIVATE_KEY=0x… CONFIRM_MAINNET=yes REGISTRY_NETWORK=celo \
//     node scripts/deploy-registry.mjs --send
//
// REGISTRY_NETWORK: "celo" (mainnet, 42220) or "celo-sepolia" (default).
// REGISTRY_ADMIN: the owner, who can replace the recorder. Defaults to GoodBuild's admin. The deployer key pays gas only.
// REGISTRY_RECORDER: the address of the recorder key the worker uses (RECORDER_KEY_FILE on the server). Fund it with a little CELO.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

const DEFAULT_ADMIN = "0xf0449277E30CC9063147bfB9Ecdf036BF9d41531";
const root = path.resolve(import.meta.dirname, "..");
const chain = { celo, "celo-sepolia": celoSepolia }[process.env.REGISTRY_NETWORK ?? "celo-sepolia"];
if (!chain) throw new Error("REGISTRY_NETWORK must be celo or celo-sepolia");
const need = (name, fallback) => {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const admin = need("REGISTRY_ADMIN", DEFAULT_ADMIN);
const recorder = need("REGISTRY_RECORDER");
for (const a of [admin, recorder]) if (!isAddress(a)) throw new Error(`Not an address: ${a}`);
const artifact = JSON.parse(fs.readFileSync(path.join(root, "contracts/build/GoodBuildRegistry.json"), "utf8"));
const args = [getAddress(admin), getAddress(recorder)];

console.log(`Network ${chain.name} (${chain.id}); admin ${admin}; recorder ${recorder}`);
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
const [owner, rec] = await Promise.all([read("owner"), read("recorder")]);
console.log(`GoodBuildRegistry at ${addr} (block ${receipt.blockNumber}). Owner ${owner}; recorder ${rec}.`);
console.log(`Set on the server: REGISTRY_ADDRESS=${addr} and REGISTRY_SALT=<a long random secret>; put the recorder key in RECORDER_KEY_FILE (default /run/secrets/recorder_key).`);
console.log("Then verify the source on Sourcify and Celoscan, and add the address to /stats.");
