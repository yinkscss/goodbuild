// Deploy GoodBuild's test G$ to Celo Sepolia (D23). Run once, by you, from your own wallet key:
//   DEPLOYER_PRIVATE_KEY=0x… pnpm deploy:test-gd
// Then put the printed address in NEXT_PUBLIC_TEST_GD_ADDRESS (.env.local and your host).
// The key signs this one transaction on this machine and is never stored or sent anywhere else.
// Fund the address first with testnet CELO: https://faucet.celo.org/celo-sepolia
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) {
  console.error("Set DEPLOYER_PRIVATE_KEY to a 0x… private key funded with Celo Sepolia CELO.");
  process.exit(1);
}

const source = readFileSync(new URL("./solidity/goodbuild/TestGoodDollar.sol", import.meta.url), "utf8");
const settings = {
  evmVersion: "cancun",
  optimizer: { enabled: true, runs: 200 },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
};
const raw = execFileSync(process.execPath, [new URL("./solc-compile.cjs", import.meta.url).pathname], {
  input: JSON.stringify({ sources: { "TestGoodDollar.sol": source }, settings }),
  maxBuffer: 64 * 1024 * 1024,
}).toString();
const { output } = JSON.parse(raw);
const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage ?? e.message).join("\n"));
  process.exit(1);
}
const artifact = output.contracts["TestGoodDollar.sol"].TestGoodDollar;

const account = privateKeyToAccount(key);
const transport = http(process.env.CELO_SEPOLIA_RPC_URL || undefined);
const publicClient = createPublicClient({ chain: celoSepolia, transport });
const wallet = createWalletClient({ account, chain: celoSepolia, transport });

console.log(`Deploying TestGoodDollar from ${account.address} to Celo Sepolia…`);
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`\nTest G$ deployed: ${receipt.contractAddress}\ntx: ${hash}\n`);
console.log(`Add to .env.local:\n  NEXT_PUBLIC_TEST_GD_ADDRESS=${receipt.contractAddress}\n`);
console.log("Explorer: https://celo-sepolia.blockscout.com/address/" + receipt.contractAddress);
