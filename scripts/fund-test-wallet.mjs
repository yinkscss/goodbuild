// Funds a throwaway test wallet on Celo MAINNET with G$ and a little CELO, from the gas wallet. Meant to run ON THE SERVER,
// where the gas wallet's key lives, by the owner (D56). Dry run by default: it only quotes and prints.
//
//   node scripts/fund-test-wallet.mjs --to 0xTestWallet [--celo 5] [--gas 0.05]           # quote only, sends nothing
//   GAS_WALLET_PRIVATE_KEY=0x… CONFIRM_MAINNET=yes node scripts/fund-test-wallet.mjs --to 0x… --send
//
// What --send does, in order: (1) approves Uniswap's SwapRouter02 for --celo CELO (CELO is also an ERC-20 on Celo), (2) swaps it
// to G$ in the CELO/G$ 1% pool with the G$ delivered straight to the test wallet, with 3% max slippage, (3) sends --gas CELO
// to the test wallet for network fees. Refuses more than 10 CELO. Addresses were read from the chain on 9 Nov 2026 (router and
// quoter have code, the pool's tokens are CELO and G$); the pool is thin (about $90 to $660 of liquidity, per DEX aggregators),
// so keep amounts small and read the quote.
import { createPublicClient, createWalletClient, formatEther, getAddress, http, isAddress, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const CELO_TOKEN = "0x471EcE3750Da237f93B8E339c536989b8978a438";
const GD = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const ROUTER = "0x5615CDAb10dc425a742d643d949a7F474C01abc4"; // Uniswap SwapRouter02 on Celo
const QUOTER = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8"; // Uniswap QuoterV2 on Celo
const FEE = 10_000;
const MAX_CELO = parseEther("10");

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const to = arg("to");
if (!to || !isAddress(to)) throw new Error("Pass --to 0x… (the test wallet address).");
const celoIn = parseEther(arg("celo", "5"));
const gas = parseEther(arg("gas", "0.05"));
if (celoIn > MAX_CELO) throw new Error("Refusing more than 10 CELO in one swap.");

const rpc = process.env.CELO_RPC_URL ? http(process.env.CELO_RPC_URL) : http();
const pub = createPublicClient({ chain: celo, transport: rpc });
const quoterAbi = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)"]);
const gasOnly = process.argv.includes("--gas-only"); // just send --gas CELO, no swap
const q = gasOnly ? { result: [0n] } : await pub.simulateContract({ address: QUOTER, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: CELO_TOKEN, tokenOut: GD, amountIn: celoIn, fee: FEE, sqrtPriceLimitX96: 0n }] });
const quoted = q.result[0];
const minOut = (quoted * 97n) / 100n;
if (gasOnly) console.log(`Gas only: send ${formatEther(gas)} CELO to ${getAddress(to)}, no swap.`);
else console.log(`Swap ${formatEther(celoIn)} CELO -> about ${formatEther(quoted)} G$ (minimum ${formatEther(minOut)} G$), delivered to ${getAddress(to)}; then ${formatEther(gas)} CELO for fees.`);
console.log("A $0.25 purchase needs about 2,300 G$ at today's price (it moves); check the quote above covers it.");
if (!process.argv.includes("--send")) {
  console.log("Dry run. Add --send (and GAS_WALLET_PRIVATE_KEY, CONFIRM_MAINNET=yes) to do it.");
  process.exit(0);
}
if (process.env.CONFIRM_MAINNET !== "yes") throw new Error("Needs CONFIRM_MAINNET=yes");
const key = process.env.GAS_WALLET_PRIVATE_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("Set GAS_WALLET_PRIVATE_KEY.");
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: celo, transport: rpc });
const wait = (hash) => pub.waitForTransactionReceipt({ hash }).then((r) => {
  if (r.status !== "success") throw new Error(`Transaction ${hash} failed`);
  return r;
});

const balance = await pub.getBalance({ address: account.address });
if (gasOnly) {
  await wait(await wallet.sendTransaction({ to: getAddress(to), value: gas }));
  console.log(`Sent. Test wallet now holds ${formatEther(await pub.getBalance({ address: getAddress(to) }))} CELO.`);
  process.exit(0);
}
if (balance < celoIn + gas + parseEther("0.2")) throw new Error(`The gas wallet has ${formatEther(balance)} CELO, not enough.`);
await wait(await wallet.writeContract({ address: CELO_TOKEN, abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [ROUTER, celoIn] }));
console.log("approved");
const routerAbi = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);
const swap = await wait(await wallet.writeContract({ address: ROUTER, abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn: CELO_TOKEN, tokenOut: GD, fee: FEE, recipient: getAddress(to), amountIn: celoIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }));
console.log("swapped, tx", swap.transactionHash);
const send = await wait(await wallet.sendTransaction({ to: getAddress(to), value: gas }));
console.log("gas CELO sent, tx", send.transactionHash);
const gdBal = await pub.readContract({ address: GD, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [getAddress(to)] });
console.log(`Test wallet now holds ${formatEther(gdBal)} G$ and ${formatEther(await pub.getBalance({ address: getAddress(to) }))} CELO.`);
