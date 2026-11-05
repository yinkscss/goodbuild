// Safety checks for upgradeable contracts (D33), in a child process like solc: the compile is heavy
// and @openzeppelin/upgrades-core shouldn't enter the web server's bundle. Reads JSON on stdin and
// writes JSON on stdout.
//
//   { op: "analyse", input, output, names: [{ file, name }] }  solc standard input and output
//     -> { results: { [name]: { layout, errors: [{ kind, name?, src }] } } }
//   { op: "compare", original, updated }                       two layouts from analyse
//     -> { ok, problems: [{ kind, label }], explanation }
const solc = require("solc");
const {
  concatRunData,
  getContractVersion,
  getErrors,
  getStorageLayout,
  getStorageUpgradeReport,
  makeNamespacedInput,
  solcInputOutputDecoder,
  validate,
  withValidationDefaults,
} = require("@openzeppelin/upgrades-core");

const OPTIONS = withValidationDefaults({});

// OpenZeppelin 5.6's ReentrancyGuard has no upgradeable version on purpose (it's marked stateless):
// its data lives in a named slot and its check only compares with "entered", so the constructor never
// reaching the proxy doesn't matter. The evm test proves re-entry is still blocked through the proxy.
// This exact file is the one exception; a constructor anywhere else stays an error.
const SAFE_CONSTRUCTOR = /^@openzeppelin\/contracts\/utils\/ReentrancyGuard\.sol:/;
const isSafe = (e) => e.kind === "constructor" && SAFE_CONSTRUCTOR.test(e.src);

function analyse({ input, output, names }) {
  // OpenZeppelin keeps its own data in named slots (ERC-7201) that solc's layout output leaves out.
  // This second compile is how upgrades-core sees them, so dropping a parent contract is noticed too.
  const namespaced = JSON.parse(solc.compile(JSON.stringify(makeNamespacedInput(input, output, "0.8.28"))));
  const failed = (namespaced.errors ?? []).filter((e) => e.severity === "error");
  if (failed.length) throw new Error(`The storage check couldn't read this contract: ${failed[0].message}`);
  const run = validate(output, solcInputOutputDecoder(input, output), "0.8.28", input, namespaced);
  const data = concatRunData(run);
  const results = {};
  for (const { file, name } of names) {
    const version = getContractVersion(run, `${file}:${name}`);
    results[name] = {
      layout: getStorageLayout(data, version),
      errors: getErrors(data, version, OPTIONS)
        .filter((e) => !isSafe(e))
        .map((e) => ({ kind: e.kind, name: e.name, src: e.src })),
    };
  }
  return { results };
}

function compare({ original, updated }) {
  const report = getStorageUpgradeReport(original, updated, OPTIONS);
  return {
    ok: report.ok,
    problems: report.ok ? [] : report.ops.map((o) => ({ kind: o.kind, label: o.original?.label ?? o.updated?.label ?? "" })),
    explanation: report.ok ? "" : report.explain(false),
  };
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const request = JSON.parse(raw);
  try {
    const result = request.op === "analyse" ? analyse(request) : compare(request);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ fatal: String(error?.message ?? error) }));
  }
});
