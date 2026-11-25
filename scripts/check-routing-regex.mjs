import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = new Map(
  Object.entries({
    "src/server/agent/delivery.ts": ["requestedMilestones", "extendDelivery", "deliveryFor"],
    "src/server/agent/plan-intake.ts": [
      "isGameRequest",
      "isMultiplayerGame",
      "looksLikeWebsite",
      "looksLikeGame",
      "asksLeaderboard",
      "asksMiniPay",
      "gamePartOf",
      "styleFromWords",
    ],
    "src/server/agent/runner.ts": ["soundsUnfinished", "wantsSpec", "planStepFor"],
    "src/server/agent/kits/registry.ts": ["detectKits"],
    "src/server/agent/contract-templates.ts": ["templatesFor"],
    "src/lib/contract-kind.ts": ["inferKind"],
    "src/server/agent/jev.ts": ["classifyTurn"],
  }),
);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const base = git("merge-base", process.argv[2] || "HEAD", "HEAD").trim();
const changes = new Map(),
  removed = new Map();
let file;
for (const line of git("diff", "--no-ext-diff", "--unified=0", base, "--", "src").split("\n")) {
  if (line.startsWith("+++ b/")) {
    file = line.slice(6);
    changes.set(file, new Set());
    removed.set(file, []);
  }
  if (file && line.startsWith("-") && !line.startsWith("---")) removed.get(file).push(line.slice(1));
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (hunk && file) for (let i = 0; i < Number(hunk[2] ?? 1); i++) changes.get(file).add(Number(hunk[1]) + i);
}
for (const f of git("ls-files", "--others", "--exclude-standard", "--", "src").trim().split("\n").filter(Boolean)) {
  if (/\.[jt]sx?$/.test(f))
    changes.set(
      f,
      new Set(
        readFileSync(f, "utf8")
          .split("\n")
          .map((_, i) => i + 1),
      ),
    );
}
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
const changed = [...changes.keys()].filter((f) => existsSync(f) && /\.[jt]sx?$/.test(f) && !f.includes(".test."));
if (!changed.length) process.exit(0);
const program = ts.createProgram([...roots.keys(), ...changed], options);
const checker = program.getTypeChecker(),
  seen = new Set(),
  failures = new Set();
function symbolOf(n) {
  const s = checker.getSymbolAtLocation(n);
  return s && (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
}
function walk(n, reason) {
  if (seen.has(n)) return;
  seen.add(n);
  const sf = n.getSourceFile(),
    f = path.relative(process.cwd(), sf.fileName);
  if (!f.startsWith("src/") || sf.isDeclarationFile) return;
  const method =
    ts.isPropertyAccessExpression(n) &&
    ["test", "exec"].includes(n.name.text) &&
    checker.typeToString(checker.getTypeAtLocation(n.expression)).includes("RegExp");
  if (
    n.kind === ts.SyntaxKind.RegularExpressionLiteral ||
    ((ts.isNewExpression(n) || ts.isCallExpression(n)) && n.expression.getText(sf) === "RegExp") ||
    method
  ) {
    const first = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      end = sf.getLineAndCharacterOfPosition(n.end).line + 1;
    const unchanged = removed.get(f)?.some((line) => line.includes(n.getText(sf)));
    if (!unchanged) for (let l = first; l <= end; l++) if (changes.get(f)?.has(l)) failures.add(`${f}:${l} — ${reason}`);
  }
  if (ts.isIdentifier(n)) {
    for (const d of symbolOf(n)?.declarations ?? []) {
      if (
        ts.isFunctionDeclaration(d) ||
        ts.isVariableDeclaration(d) ||
        ts.isMethodDeclaration(d) ||
        ts.isPropertyAssignment(d)
      )
        walk(d, reason);
    }
  }
  ts.forEachChild(n, (child) => walk(child, reason));
}
for (const [f, names] of roots) {
  const sf = program.getSourceFile(f);
  if (sf)
    ts.forEachChild(sf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) walk(n, n.name.text);
      if (ts.isVariableStatement(n))
        for (const d of n.declarationList.declarations) if (names.includes(d.name.getText(sf))) walk(d, d.name.getText(sf));
    });
}
// New inline routing rules can also appear outside an existing routing function.
for (const f of changed) {
  const sf = program.getSourceFile(f);
  if (!sf) continue;
  function visit(n) {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "keywords" && f.includes("/kits/")) walk(n, "kit selection");
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ["test", "exec", "match", "search"].includes(n.expression.name.text) &&
      /\b(request|prompt|kitWords|userText|reply|goal|answerWords)\b/.test(n.getText(sf))
    )
      walk(n, "request or reply routing");
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
if (failures.size) {
  console.error([...failures].join("\n"));
  process.exitCode = 1;
}
