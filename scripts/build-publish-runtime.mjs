// Pack publish-runtime's locked dependencies into one file for deployments. File tracing skips
// node_modules folders and doesn't follow pnpm's symlinks, so a host would otherwise have nothing to
// bundle published apps with. src/server/publish/runtime.ts unpacks it. Run before `pnpm build`.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

if (process.env.BACKEND_ORIGIN) process.exit(0); // the edge never publishes (D26)

const out = mkdtempSync(path.join(tmpdir(), "goodbuild-runtime-"));
const root = path.join(out, "node_modules");
const skip = /\.(map|d\.ts|d\.cts|d\.mts|md|tsbuildinfo)$/i;
const hoisted = new Map(); // package name -> the version at the top level
const done = new Set();
// Reown AppKit is WalletConnect's own modal. Published apps draw their own QR code, and the publish build
// replaces any AppKit import with a stub (src/server/publish/build.ts, D35), so it's never needed here.
// It is about half of the pack.
const NEVER_BUNDLED = new Set(["@reown/appkit"]);

/** Each package's dependencies sit beside it in the pnpm store: .pnpm/<id>/node_modules/*. */
function modulesOf(real, name) {
  return name.includes("/") ? path.dirname(path.dirname(real)) : path.dirname(real);
}

const versionOf = (real) => JSON.parse(readFileSync(path.join(real, "package.json"), "utf8")).version;

function install(name, real, into) {
  const target = path.join(into, name);
  if (done.has(target)) return;
  done.add(target);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(real, target, { recursive: true, dereference: true, filter: (f) => !skip.test(f) && path.basename(f) !== "node_modules" });

  const pkg = JSON.parse(readFileSync(path.join(real, "package.json"), "utf8"));
  const beside = modulesOf(real, name);
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })) {
    if (NEVER_BUNDLED.has(dep)) continue;
    const link = path.join(beside, dep);
    if (!existsSync(link)) continue; // an optional peer nobody installed
    const depReal = realpathSync(link);
    const version = versionOf(depReal);
    if (!hoisted.has(dep)) {
      hoisted.set(dep, version);
      install(dep, depReal, root);
    } else if (hoisted.get(dep) !== version) {
      install(dep, depReal, path.join(target, "node_modules"));
    }
  }
}

const { dependencies } = JSON.parse(readFileSync("publish-runtime/package.json", "utf8"));
const tops = Object.keys(dependencies).map((name) => [name, realpathSync(path.join("publish-runtime/node_modules", name))]);
for (const [name, real] of tops) hoisted.set(name, versionOf(real));
for (const [name, real] of tops) install(name, real, root);
// Tailwind's stylesheets, read from disk when compiling an app's styles.
cpSync(realpathSync("node_modules/tailwindcss"), path.join(root, "tailwindcss"), { recursive: true, dereference: true, filter: (f) => statSync(f).isDirectory() ? path.basename(f) !== "node_modules" : f.endsWith(".css") });

// One gzipped JSON object: { "node_modules/react/index.js": "<base64>" }.
const files = {};
const collect = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) collect(f);
    else files[path.relative(out, f)] = readFileSync(f).toString("base64");
  }
};
collect(out);
rmSync(out, { recursive: true, force: true });
const packed = gzipSync(JSON.stringify(files));
writeFileSync("publish-runtime.pack.gz", packed);
console.log(`publish-runtime.pack.gz: ${done.size} packages, ${Object.keys(files).length} files, ${Math.round(packed.length / 1048576)} MB`);
