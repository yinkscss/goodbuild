// Live test of the mainnet credits contract with a funded throwaway wallet (D56). Run ON THE SERVER by the owner:
// it signs the quote itself with CREDITS_QUOTE_SIGNER_KEY (the same key the app uses), so it proves the contract, the G$
// payment hook and the Redeemed event on mainnet without needing the app deployed. It does not touch the database; once the
// app is live and the env vars are set, the same purchase through the app's screen is the full test.
//
//   node scripts/credits-live-purchase.mjs                      # simulate only: sends nothing
//   TEST_WALLET_KEY=0x… CONFIRM_MAINNET=yes node scripts/credits-live-purchase.mjs --send
//
// Env: CREDITS_QUOTE_SIGNER_KEY (server .env.production), CREDITS_CONTRACT_42220 or --contract, TEST_WALLET_KEY.
// Default $0.25 of credit; --usd to change (0.25 to 5).
import { createPublicClient, createWalletClient, encodeAbiParameters, formatEther, getAddress, http, keccak256, parseAbi, parseEventLogs, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const GD = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const contract = getAddress(arg("contract", process.env.CREDITS_CONTRACT_42220 ?? "0x800a4cb107f788fece1e7fa73aeeec1bce7e8c2f"));
const usd = Number(arg("usd", "0.25"));
if (!(usd >= 0.25 && usd <= 5)) throw new Error("--usd must be between 0.25 and 5 for this test.");
const signerKey = process.env.CREDITS_QUOTE_SIGNER_KEY;
const walletKey = process.env.TEST_WALLET_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(signerKey ?? "")) throw new Error("Set CREDITS_QUOTE_SIGNER_KEY.");
if (!/^0x[0-9a-fA-F]{64}$/.test(walletKey ?? "")) throw new Error("Set TEST_WALLET_KEY (the funded throwaway wallet).");
const signer = privateKeyToAccount(signerKey);
const buyer = privateKeyToAccount(walletKey);
const rpc = process.env.CELO_RPC_URL ? http(process.env.CELO_RPC_URL) : http();
const pub = createPublicClient({ chain: celo, transport: rpc });
const wallet = createWalletClient({ account: buyer, chain: celo, transport: rpc });

const price = (await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=gooddollar&vs_currencies=usd")).json()).gooddollar.usd;
const creditsMicro = BigInt(Math.round(usd * 1e6));
// +5% buffer, whole G$, rounded up: the same rule the app's quote uses.
const gdWei = ((creditsMicro * 105n * 10n ** 24n) / 100n / BigInt(Math.round(price * 1e12)) / 10n ** 18n + 1n) * 10n ** 18n;
const QUOTE = [{ name: "buyer", type: "address" }, { name: "gdAmount", type: "uint256" }, { name: "credits", type: "uint256" }, { name: "bonus", type: "uint256" }, { name: "ref", type: "bytes32" }, { name: "deadline", type: "uint256" }];
const quote = { buyer: buyer.address, gdAmount: gdWei, credits: creditsMicro, bonus: 0n, ref: keccak256(toHex(`live-test-${Date.now()}`)), deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
const signature = await signer.signTypedData({
  domain: { name: "GoodBuild Credits", version: "1", chainId: 42220, verifyingContract: contract },
  types: { Quote: QUOTE },
  primaryType: "Quote",
  message: quote,
});
const data = encodeAbiParameters([{ type: "tuple", components: QUOTE }, { type: "bytes" }], [quote, signature]);
const gdAbi = parseAbi(["function transferAndCall(address,uint256,bytes) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

const [gdBal, celoBal] = await Promise.all([pub.readContract({ address: GD, abi: gdAbi, functionName: "balanceOf", args: [buyer.address] }), pub.getBalance({ address: buyer.address })]);
console.log(`Buy $${usd} of credit for ${formatEther(gdWei)} G$ (G$ at $${price}) from ${buyer.address}, who holds ${formatEther(gdBal)} G$ and ${formatEther(celoBal)} CELO.`);
const sim = await pub.simulateContract({ account: buyer, address: GD, abi: gdAbi, functionName: "transferAndCall", args: [contract, gdWei, data] }).then(
  () => "OK",
  (e) => `FAILS: ${e.shortMessage ?? e.message}`,
);
console.log(`Simulation against mainnet G$ and the credits contract: ${sim}`);
if (sim !== "OK" || !process.argv.includes("--send")) {
  console.log(sim === "OK" ? "Dry run. Add --send (and CONFIRM_MAINNET=yes) to pay." : "Not sending.");
  process.exit(sim === "OK" ? 0 : 1);
}
if (process.env.CONFIRM_MAINNET !== "yes") throw new Error("Needs CONFIRM_MAINNET=yes");
const hash = await wallet.writeContract({ address: GD, abi: gdAbi, functionName: "transferAndCall", args: [contract, gdWei, data] });
const r = await pub.waitForTransactionReceipt({ hash });
if (r.status !== "success") throw new Error(`Payment ${hash} failed`);
const ev = parseEventLogs({ abi: parseAbi(["event Redeemed(address indexed account, uint256 credits, bytes32 ref)"]), logs: r.logs })[0];
console.log(`Paid. Tx ${hash}. Redeemed: ${ev ? `${ev.args.credits} units (${Number(ev.args.credits) / 1e6} credits) for ${ev.args.account}` : "NO EVENT (bad)"}`);
