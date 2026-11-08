// Compiles contracts/GoodBuildCredits.sol with the pinned solc and writes contracts/build/GoodBuildCredits.json
// ({ abi, bytecode }). paris EVM and OpenZeppelin 5.1.0 (D17): no MCOPY, so it runs on every Celo node.
// Usage: node scripts/compile-credits.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");
const root = path.resolve(import.meta.dirname, "..");
const SOURCE = "contracts/GoodBuildCredits.sol";

function findImports(p) {
  if (p.includes("..")) return { error: `Invalid import ${p}` };
  const real = p.replace("@openzeppelin/contracts/", "@openzeppelin/contracts-paris/");
  try {
    return { contents: fs.readFileSync(path.join(root, "node_modules", real), "utf8") };
  } catch {
    return { error: `Not found: ${p}` };
  }
}

function compileFile(source, contract) {
  const input = {
    language: "Solidity",
    sources: { [source]: { content: fs.readFileSync(path.join(root, source), "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts[source][contract];
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

export const compileCredits = () => compileFile(SOURCE, "GoodBuildCredits");
/** The Sepolia stand-in for G$ (ERC-677 transferAndCall, faucet), compiled for tests and the Sepolia rehearsal. */
export const compileTestGd = () => compileFile("scripts/solidity/goodbuild/TestGoodDollar.sol", "TestGoodDollar");

if (process.argv[1] === import.meta.filename) {
  const artifact = compileCredits();
  fs.mkdirSync(path.join(root, "contracts/build"), { recursive: true });
  fs.writeFileSync(path.join(root, "contracts/build/GoodBuildCredits.json"), JSON.stringify(artifact));
  console.log(`GoodBuildCredits compiled: ${(artifact.bytecode.length - 2) / 2} bytes`);
}
