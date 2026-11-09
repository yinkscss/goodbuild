// Rehearses the whole GoodBuild Credits path on Celo Sepolia with a throwaway wallet (D56):
// deploy test G$ + credits, sign a quote like the server does, pay with transferAndCall, read the Redeemed event, withdraw.
//   DEPLOYER_PRIVATE_KEY=0x… node scripts/credits-rehearsal.mjs      (the key needs ~0.3 test CELO)
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseEventLogs, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import { compileCredits, compileTestGd } from "./compile-credits.mjs";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("Set DEPLOYER_PRIVATE_KEY (Sepolia test wallet).");
const account = privateKeyToAccount(key);
const transport = http(process.env.CELO_SEPOLIA_RPC_URL || undefined);
const pub = createPublicClient({ chain: celoSepolia, transport });
const wallet = createWalletClient({ account, chain: celoSepolia, transport });
const signer = privateKeyToAccount(generatePrivateKey());

const deploy = async (art, args = []) => {
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("deploy failed");
  return r.contractAddress;
};
const send = async (address, abi, functionName, args) => {
  const hash = await wallet.writeContract({ address, abi, functionName, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} failed`);
  return r;
};

const gdArt = compileTestGd();
const crArt = compileCredits();
const gd = await deploy(gdArt);
console.log("test G$", gd);
const credits = await deploy(crArt, [account.address, gd, signer.address, 1_000_000_000n]);
console.log("credits", credits);
await new Promise((r) => setTimeout(r, 6000));
const supply = await pub.readContract({ address: credits, abi: crArt.abi, functionName: "totalSupply" });
console.log("supply", supply, supply === 10_000_000_000_000n ? "(10,000,000 credits)" : "UNEXPECTED");

await send(gd, gdArt.abi, "faucet", []);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const quote = { buyer: account.address, gdAmount: 100n * 10n ** 18n, credits: 10_000_000n, bonus: 1_000_000n, ref: keccak256(toHex(`rehearsal-${Date.now()}`)), deadline };
const signature = await signer.signTypedData({
  domain: { name: "GoodBuild Credits", version: "1", chainId: celoSepolia.id, verifyingContract: credits },
  types: { Quote: [{ name: "buyer", type: "address" }, { name: "gdAmount", type: "uint256" }, { name: "credits", type: "uint256" }, { name: "bonus", type: "uint256" }, { name: "ref", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Quote",
  message: quote,
});
const data = encodeAbiParameters([{ type: "tuple", components: crArt.abi.find((x) => x.name === "buy").inputs[0].components }, { type: "bytes" }], [quote, signature]);
const r = await send(gd, gdArt.abi, "transferAndCall", [credits, quote.gdAmount, data]);
const ev = parseEventLogs({ abi: crArt.abi, eventName: "Redeemed", logs: r.logs })[0];
console.log("Redeemed", ev.args, ev.args.credits === 11_000_000n ? "OK" : "UNEXPECTED");
console.log("replay should fail…");
await new Promise((r) => setTimeout(r, 6000));
try {
  await wallet.writeContract({ address: gd, abi: gdArt.abi, functionName: "transferAndCall", args: [credits, quote.gdAmount, data], gas: 500_000n });
  console.log("REPLAY SUCCEEDED (BAD)");
} catch {
  console.log("replay refused OK");
}
await new Promise((r) => setTimeout(r, 6000));
await send(credits, crArt.abi, "withdraw", [gd, account.address, quote.gdAmount]);
console.log("withdraw OK; remaining", await pub.readContract({ address: credits, abi: crArt.abi, functionName: "remaining" }));
