// Compile Solidity in a child process so solc's synchronous work never blocks the web
// server. Reads {sources, settings} JSON on stdin, writes solc's standard JSON output.
// OpenZeppelin imports resolve from the pinned @openzeppelin/contracts in node_modules.
const fs = require("node:fs");
const path = require("node:path");
const solc = require("solc");

const root = path.join(__dirname, "..", "node_modules");
const ALLOWED_PREFIX = "@openzeppelin/contracts/";
// Upgradeable projects (D33) also get OpenZeppelin's initializer-based contracts. Others are refused.
const UPGRADEABLE_PREFIX = "@openzeppelin/contracts-upgradeable/";
// Platform-owned test helpers (Test, Actor, MockGoodDollar) for contracts/test/*.t.sol.
const GOODBUILD_PREFIX = "@goodbuild/";
const goodbuildRoot = path.join(__dirname, "solidity", "goodbuild");

// Imports the compile actually read, returned so a deploy can submit exact sources for verification.
const usedImports = {};
// D17 paris fallback: resolve @openzeppelin/contracts from a pinned older release without MCOPY.
let ozPackage = "@openzeppelin/contracts";
let allowUpgradeable = false;

function findImports(importPath) {
  if (importPath.includes("..")) return { error: `Invalid import "${importPath}".` };
  if (importPath.startsWith(GOODBUILD_PREFIX)) {
    try {
      return { contents: fs.readFileSync(path.join(goodbuildRoot, importPath.slice(GOODBUILD_PREFIX.length)), "utf8") };
    } catch {
      return { error: `Not found: ${importPath}. Available: @goodbuild/Test.sol, @goodbuild/MockGoodDollar.sol` };
    }
  }
  if (allowUpgradeable && importPath.startsWith(UPGRADEABLE_PREFIX)) {
    try {
      const contents = fs.readFileSync(path.join(root, importPath), "utf8");
      usedImports[importPath] = contents;
      return { contents };
    } catch {
      return { error: `Not found: ${importPath}` };
    }
  }
  if (!importPath.startsWith(ALLOWED_PREFIX)) {
    return { error: `Only @openzeppelin/contracts imports are available (got "${importPath}").` };
  }
  try {
    const real = ozPackage === "@openzeppelin/contracts" ? importPath : ozPackage + importPath.slice(ALLOWED_PREFIX.length - 1);
    const contents = fs.readFileSync(path.join(root, real), "utf8");
    usedImports[importPath] = contents;
    return { contents };
  } catch {
    return { error: `Not found: ${importPath}` };
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const { sources, settings, ozPackage: oz, upgradeable } = JSON.parse(raw);
  allowUpgradeable = Boolean(upgradeable);
  if (oz === "@openzeppelin/contracts-paris") ozPackage = oz;
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { content: v }])),
    settings,
  };
  const out = solc.compile(JSON.stringify(input), { import: findImports });
  process.stdout.write(JSON.stringify({ version: solc.version(), output: JSON.parse(out), imports: usedImports }));
});
