// Deploys GoodBuildCredits. Dry run by default: prints what it would do and touches nothing.
//
//   node scripts/compile-credits.mjs
//   CREDITS_NETWORK=celo CREDITS_OWNER=0x… CREDITS_TREASURY=0x… CREDITS_CREDITS_PER_CELO=14000000 \
//     CREDITS_MAX_PER_MINT=100000000 DEPLOYER_PRIVATE_KEY=0x… node scripts/deploy-credits.mjs --send
//
// CREDITS_NETWORK: "celo" (mainnet, 42220) or "celo-sepolia". CREDITS_CREDITS_PER_CELO is GBC units (6 decimals)
// per 1 CELO, so at CELO = $0.07, 14.28 credits ($1 each) would be 1 CELO = 70000 units: set it from the live price.
// The deployer key pays gas only; make CREDITS_OWNER a multisig or a hardware wallet, not the deployer.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

const root = path.resolve(import.meta.dirname, "..");
const chain = { celo, "celo-sepolia": celoSepolia }[process.env.CREDITS_NETWORK ?? "celo-sepolia"];
if (!chain) throw new Error("CREDITS_NETWORK must be celo or celo-sepolia");
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const owner = need("CREDITS_OWNER");
const treasury = need("CREDITS_TREASURY");
for (const a of [owner, treasury]) if (!isAddress(a)) throw new Error(`Not an address: ${a}`);
const perCelo = BigInt(need("CREDITS_CREDITS_PER_CELO"));
const maxPerMint = BigInt(need("CREDITS_MAX_PER_MINT"));
const artifact = JSON.parse(fs.readFileSync(path.join(root, "contracts/build/GoodBuildCredits.json"), "utf8"));
const args = [getAddress(owner), getAddress(treasury), perCelo, maxPerMint];

console.log(`Network ${chain.name} (${chain.id}); owner ${owner}; treasury ${treasury}; ${perCelo} units per CELO; max ${maxPerMint} units per mint`);
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
console.log(`GoodBuildCredits at ${receipt.contractAddress} (block ${receipt.blockNumber}).`);
console.log(`Set on the server: CREDITS_CONTRACT_${chain.id}=${receipt.contractAddress} and CREDITS_START_BLOCK_${chain.id}=${receipt.blockNumber}`);
console.log("Then: owner calls setMinter(<backend minter>, true) if you want server-side mint, and the contract is yours to verify on Celoscan/Sourcify.");
