// Type-check a generated app's files (src/server/agent/type-check.ts runs this in a child process,
// like scripts/solc-compile.cjs: viem's types are heavy, and a child can be timed out and capped).
// stdin:  { files: { "src/App.tsx": "..." }, runtimeDir, typesDir }
// stdout: { diagnostics: [{ file, line, code, message }], files, ms }
const path = require("node:path");
const ts = require("typescript");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    process.stdout.write(JSON.stringify(run(JSON.parse(input))));
  } catch (error) {
    process.stdout.write(JSON.stringify({ fatal: String((error && error.stack) || error).slice(0, 2000) }));
  }
});

function run({ files, runtimeDir, typesDir }) {
  const started = Date.now();
  // The project sits, in memory only, in a folder beside the allowed packages, so a bare import
  // ("viem", "lucide-react") resolves to the same versions a published app is bundled with.
  const root = path.join(runtimeDir, ".gb-typecheck");
  const virtual = new Map(Object.entries(files).map(([p, content]) => [path.join(root, p), content]));
  const dirs = new Set();
  for (const file of virtual.keys()) {
    for (let d = path.dirname(file); d.startsWith(root); d = path.dirname(d)) dirs.add(d);
  }

  const options = {
    target: ts.ScriptTarget.ES2020,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // Not strict: the aim is code that is wrong (a prop that doesn't exist, a missing export, the
    // wrong arguments), not code that is merely loose. Strict null checks flag a lot that runs fine.
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    isolatedModules: true,
    types: [],
    // Apps run React 18; GoodBuild itself is on 19, whose types differ (no global JSX, useRef needs an argument).
    paths: {
      react: [path.join(typesDir, "react-18", "index.d.ts")],
      "react/*": [path.join(typesDir, "react-18", "*")],
      "react-dom": [path.join(typesDir, "react-dom-18", "index.d.ts")],
      "react-dom/*": [path.join(typesDir, "react-dom-18", "*")],
    },
  };

  const host = ts.createCompilerHost(options, true);
  const real = { fileExists: host.fileExists, readFile: host.readFile, getSourceFile: host.getSourceFile, directoryExists: host.directoryExists };
  host.getCurrentDirectory = () => root;
  host.fileExists = (f) => virtual.has(f) || (!f.startsWith(root + path.sep) && real.fileExists(f));
  host.readFile = (f) => (virtual.has(f) ? virtual.get(f) : f.startsWith(root + path.sep) ? undefined : real.readFile(f));
  host.directoryExists = (d) => dirs.has(d) || (!d.startsWith(root) && (real.directoryExists ? real.directoryExists(d) : true));
  host.getDirectories = () => [];
  host.realpath = (f) => (f.startsWith(root) ? f : ts.sys.realpath ? ts.sys.realpath(f) : f);
  host.getSourceFile = (f, languageVersion, onError) =>
    virtual.has(f) ? ts.createSourceFile(f, virtual.get(f), languageVersion, true) : real.getSourceFile(f, languageVersion, onError);
  host.writeFile = () => undefined;

  const roots = [...virtual.keys()].filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
  const program = ts.createProgram({ rootNames: roots, options, host });
  const diagnostics = [];
  const seen = new Set();
  for (const file of roots) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    for (const d of [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      const line = d.start === undefined ? undefined : source.getLineAndCharacterOfPosition(d.start).line + 1;
      // The first line says what is wrong; the rest is the chain of types that led there.
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n").split("\n").slice(0, 2).join(" ").replace(/\s+/g, " ").slice(0, 320);
      const key = `${file}:${line}:${d.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push({ file: path.relative(root, file).split(path.sep).join("/"), line, code: d.code, message });
    }
  }
  return { diagnostics, files: roots.length, ms: Date.now() - started };
}
