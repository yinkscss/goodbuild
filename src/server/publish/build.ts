import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Message, Plugin } from "esbuild";

import { LOGO_32_DATA_URI } from "./logo-data";
import { publishRuntimeDir } from "./runtime";

import { CAN_BE_CHANGED_LABEL } from "@/lib/deploy/upgradeable";
import { hasMiniPayKit } from "@/lib/minipay-checklist";
import { ALLOWED_DEPENDENCIES, PLATFORM_DEPENDENCIES, WALLET_DIR } from "@/server/agent/template";

import { WALLETCONNECT_MODULE } from "./walletconnect-module";

export interface PublishedFile {
  path: string;
  mime: string;
  bytes: Uint8Array;
}

export interface BuildInput {
  /** The project's saved files. */
  files: Record<string, string>;
  /** Uploaded images to ship at /assets/<name>. Design references must not be passed in. */
  assets: Array<{ name: string; mime: string; bytes: Uint8Array }>;
  title: string;
  hasUndeployedContracts: boolean;
  /** A contract this app uses is behind a proxy its owner can still change (D33). */
  changeableContract?: boolean;
  /** A link for visitors to report this app, on the main site. */
  reportUrl?: string;
  /** Show the "Built with GoodBuild" badge. The owner can turn it off in Settings. Default on. Safety notices stay either way. */
  showBadge?: boolean;
  /** The public id src/lib/db.ts reads from the page. Its presence is also how the helper knows it isn't in the preview. */
  dataClientId?: string;
  /**
   * GoodBuild's WalletConnect project id (D36). With it, the app's wallet list offers phone wallets:
   * the page gets a goodbuild-walletconnect meta tag and the real WalletConnect module, as a chunk
   * that only loads when a visitor picks it. Without it, only browser wallets and MiniPay.
   */
  walletConnectProjectId?: string;
  /** Where the allowed packages are installed. */
  runtimeDir?: string;
  /**
   * A build for the run check (src/server/agent/run-check.ts), never served to visitors: not minified
   * and with React's development build, so an error names the component and says what went wrong.
   */
  forCheck?: boolean;
  /**
   * A build for the workspace's own preview (D69), served only to its owner on the project's preview
   * host. Like forCheck (readable errors), with no "Built with" pill, and with a small script that
   * tells the workspace when the app is up and what went wrong (src/server/preview/bridge.ts).
   */
  preview?: { bridge: (js: string, jsName: string) => string };
}

/** The whole app, assets included. */
export const MAX_PUBLISH_BYTES = 30 * 1024 * 1024;

export class PublishBuildError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

const ENTRY = "src/main.tsx";
/** The preview's bridge script. Not a path a project file can have. */
export const PREVIEW_BRIDGE_PATH = "__gb-preview.js";

/**
 * Where each module starts in a bundle that isn't minified: esbuild writes `// project:src/App.tsx`
 * above each one. `file` is empty for a package's module, which ends the project file above it.
 */
export function moduleStarts(js: string): Array<{ line: number; file: string }> {
  const starts: Array<{ line: number; file: string }> = [];
  js.split("\n").forEach((text, i) => {
    const m = /^\s*\/\/ (.+)$/.exec(text);
    if (!m) return;
    const project = /^project:(.+)$/.exec(m[1]);
    if (project || /node_modules\//.test(m[1])) starts.push({ line: i + 1, file: project ? project[1] : "" });
  });
  return starts;
}
const THEME_BLOCK = /<style type="text\/tailwindcss">([\s\S]*?)<\/style>/g;
const LOADERS = { tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", css: "css", json: "json" } as const;

function packageName(specifier: string) {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

/**
 * Keeps the bundle to the project's own files and the allowed packages. Project code is untrusted:
 * it never gets the filesystem, and `react/../../.env` style specifiers are refused outright.
 */
/** The project's stand-in, replaced with WALLETCONNECT_MODULE when WalletConnect is on. */
export const WALLETCONNECT_PATH = `${WALLET_DIR}walletConnect.tsx`;

function projectPlugin(files: Record<string, string>, runtimeDir: string, walletConnect: boolean): Plugin {
  return {
    name: "goodbuild-project",
    setup(build) {
      // WalletConnect's own modal (Reown AppKit) is never used: the app draws its own QR code and
      // wallet links, so AppKit's large bundle and its outside images, fonts and frames stay out.
      build.onResolve({ filter: /^@reown\/appkit/ }, () => ({ path: "appkit", namespace: "goodbuild-empty" }));
      build.onLoad({ filter: /.*/, namespace: "goodbuild-empty" }, () => ({
        contents: "export function createAppKit() { throw new Error(\"WalletConnect's modal isn't included.\"); }",
        loader: "js",
      }));
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point") return { path: args.path, namespace: "project" };
        if (args.namespace !== "project") return null; // inside an allowed package
        if (args.path.startsWith("/assets/")) return { path: args.path, external: true };
        if (/^https?:\/\//.test(args.path) && (args.kind === "import-rule" || args.kind === "url-token")) return { path: args.path, external: true };
        if (args.path.startsWith(".")) {
          const base = path.posix.join(path.posix.dirname(args.importer), args.path);
          const match = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => c in files);
          return match ? { path: match, namespace: "project" } : { errors: [{ text: `Can't find "${args.path}" from ${args.importer}.` }] };
        }
        // Only GoodBuild's WalletConnect module may use the platform packages.
        const platform = walletConnect && args.importer === WALLETCONNECT_PATH && packageName(args.path) in PLATFORM_DEPENDENCIES;
        if (args.path.split("/").includes("..") || !(packageName(args.path) in ALLOWED_DEPENDENCIES || platform)) {
          return { errors: [{ text: `"${args.path}" isn't on the allowed package list.` }] };
        }
        return build.resolve(args.path, { resolveDir: runtimeDir, kind: args.kind });
      });
      build.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
        const loader = LOADERS[path.extname(args.path).slice(1) as keyof typeof LOADERS];
        if (walletConnect && args.path === WALLETCONNECT_PATH) return { contents: WALLETCONNECT_MODULE, loader: "tsx" };
        return loader ? { contents: files[args.path], loader } : { errors: [{ text: `Can't import ${args.path}.` }] };
      });
    },
  };
}

function describeMessage(m: Message): string {
  return m.location ? `${m.location.file.replace(/^project:/, "")}:${m.location.line}: ${m.text}` : m.text;
}

async function bundle(files: Record<string, string>, runtimeDir: string, walletConnect: boolean, forCheck = false) {
  const esbuild = await import("esbuild");
  try {
    const result = await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      jsx: "automatic",
      minify: !forCheck,
      logLevel: "silent",
      outdir: "/",
      // Code behind import() (WalletConnect) becomes its own file, fetched only when it's needed.
      splitting: true,
      entryNames: "entry",
      chunkNames: "chunk.[hash]",
      define: { "process.env.NODE_ENV": forCheck ? '"development"' : '"production"', global: "globalThis" },
      plugins: [projectPlugin(files, runtimeDir, walletConnect)],
    });
    const name = (f: { path: string }) => f.path.replace(/^\//, "");
    const js = result.outputFiles.find((f) => name(f) === "entry.js")?.text ?? "";
    const chunks = result.outputFiles.filter((f) => /^chunk\.[A-Z0-9]+\.js$/.test(name(f))).map((f) => ({ path: name(f), text: f.text }));
    const css = result.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
    return { js, chunks, css };
  } catch (error) {
    const errors = (error as { errors?: Message[] }).errors;
    if (errors) throw new PublishBuildError("The app didn't build.", errors.slice(0, 8).map(describeMessage));
    throw error;
  }
}

/** Only Tailwind's own stylesheets load. Project CSS can't @import a file from the server. */
const TAILWIND_STYLESHEETS: Record<string, string> = {
  tailwindcss: "index.css",
  "./theme.css": "theme.css",
  "./preflight.css": "preflight.css",
  "./utilities.css": "utilities.css",
};

async function compileTailwind(files: Record<string, string>, theme: string, runtimeDir: string) {
  const [{ compile }, { Scanner }] = await Promise.all([import("tailwindcss"), import("@tailwindcss/oxide")]);
  // In the deployed runtime pack, or the app's own install in development.
  const packed = path.join(runtimeDir, "node_modules", "tailwindcss");
  const dir = existsSync(path.join(packed, "index.css")) ? packed : path.join(process.cwd(), "node_modules", "tailwindcss");
  try {
    const compiler = await compile(`@import "tailwindcss";\n${theme}`, {
      base: dir,
      loadStylesheet: async (id) => {
        const file = TAILWIND_STYLESHEETS[id];
        if (!file) throw new Error(`@import "${id}" isn't allowed in the theme.`);
        return { path: path.join(dir, file), base: dir, content: await readFile(path.join(dir, file), "utf8") };
      },
    });
    const sources = Object.entries(files)
      .filter(([p]) => p.startsWith("src/") && /\.(tsx|ts|jsx|js)$/.test(p))
      .map(([p, content]) => ({ content, extension: path.extname(p).slice(1) }));
    return compiler.build(new Scanner({}).scanFiles(sources));
  } catch (error) {
    throw new PublishBuildError("The app's styles didn't compile.", [error instanceof Error ? error.message : String(error)]);
  }
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const PILL_STYLE =
  "position:fixed;left:12px;bottom:12px;z-index:2147483000;display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:calc(100vw - 24px);padding:5px 6px 5px 6px;border-radius:999px;background:#fff;color:#1a0d26;box-shadow:0 2px 12px rgba(26,13,38,.18);font:500 12px/1.4 system-ui,sans-serif;text-decoration:none";

/** Hides the bar and the space under it when the visitor taps the cross. Pure CSS, so it works under the published page's script rules. */
// The checkbox is the control keyboards and screen readers use (Tab, then Space); the cross is its label for
// taps, and shows a focus ring while the checkbox has keyboard focus.
const BAR_DISMISS_CSS =
  "#gb-bar-off:checked~[data-goodbuild-bar],#gb-bar-off:checked~[data-goodbuild-bar-space]{display:none!important}" +
  "#gb-bar-off:focus-visible~[data-goodbuild-bar] label[for=gb-bar-off]{outline:2px solid #1a0d26;outline-offset:2px;opacity:1}";
const BAR_TOGGLE_STYLE = "position:fixed;left:12px;bottom:12px;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0;z-index:2147483000";

/** False when the owner turned the badge off and the app has nothing visitors must be told. */
export const hasBar = (hasUndeployedContracts: boolean, changeableContract: boolean, showBadge: boolean) => showBadge || hasUndeployedContracts || changeableContract;

/**
 * Just the logo at the bottom left, with a cross to close it (D56). The words "Built with GoodBuild" are in the
 * link's label for screen readers. Notices that matter (demo, changeable, report) sit beside the logo when there are any.
 * With the badge off (the owner's choice, D90) the logo goes, but the notices stay when there is a demo or changeable-contract
 * notice, because visitors need to know. With none of those, no bar at all (see hasBar).
 */
export function bar(hasUndeployedContracts: boolean, reportUrl?: string, changeableContract = false, sameTab = false, showBadge = true) {
  if (!hasBar(hasUndeployedContracts, changeableContract, showBadge)) return "";
  // MiniPay has no tabs, so in a MiniPay app (D88) the bar's links open in the same view.
  const blank = sameTab ? "" : ` target="_blank"`;
  const report = reportUrl ? `<a href="${escapeHtml(reportUrl)}"${blank} rel="noreferrer" style="color:inherit;text-decoration:underline">Report</a>` : "";
  const demo = hasUndeployedContracts ? "Demo: this app's contract isn't deployed yet, so on-chain actions won't work." : "";
  const notices = [changeableContract ? CAN_BE_CHANGED_LABEL : "", demo, report].filter(Boolean).join(" · ");
  const note = notices ? `<span style="padding:0 4px">${notices}</span>` : "";
  const logo = `<a href="https://goodbuildit.xyz"${blank} rel="noreferrer" aria-label="Built with GoodBuild" title="Built with GoodBuild" style="display:inline-flex;align-items:center;padding:2px"><img src="${LOGO_32_DATA_URI}" alt="" width="20" height="20" style="display:block;width:20px;height:20px" /></a>`;
  const close = `<label for="gb-bar-off" aria-hidden="true" title="Close" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;cursor:pointer;font-size:15px;line-height:1;opacity:.6">&times;</label>`;
  return `<input type="checkbox" id="gb-bar-off" aria-label="Close the Built with GoodBuild badge" style="${BAR_TOGGLE_STYLE}" /><style>${BAR_DISMISS_CSS}</style><div data-goodbuild-bar role="note" style="${PILL_STYLE}">${showBadge ? logo : ""}${note}${close}</div>`;
}

/**
 * The bar is fixed to the bottom of the screen, so on a phone it sat on top of whatever the app put last
 * (a Play button, a Pay button). This empty block at the end of the page gives the app's last content room
 * to scroll up clear of it. It is taller when notices make the bar wrap onto more lines. On a full-screen game it adds a
 * short strip to scroll into; that is the price of the Play button never sitting under the badge (D80).
 */
function barSpace(hasNotices: boolean) {
  return `<div data-goodbuild-bar-space aria-hidden="true" style="height:calc(${hasNotices ? 96 : 60}px + env(safe-area-inset-bottom,0px));pointer-events:none"></div>`;
}

function hashed(name: string, ext: string, content: string) {
  return `${name}.${createHash("sha256").update(content).digest("hex").slice(0, 12)}.${ext}`;
}

/** Turn a project's saved files into a static site. Runs no project code. */
export async function buildPublishedApp(input: BuildInput): Promise<PublishedFile[]> {
  const { files } = input;
  const html = files["public/index.html"];
  if (!html || !(ENTRY in files)) throw new PublishBuildError("This project has no app to publish yet.");

  const theme = [...html.matchAll(THEME_BLOCK)].map((m) => m[1]).join("\n");
  const runtimeDir = input.runtimeDir ?? (await publishRuntimeDir());
  const walletConnect = !!input.walletConnectProjectId;
  const { js, chunks, css: bundledCss } = await bundle(files, runtimeDir, walletConnect, input.forCheck || !!input.preview);
  const css = (await compileTailwind(files, theme, runtimeDir)) + bundledCss;

  const jsName = hashed("app", "js", js);
  const cssName = hashed("app", "css", css);
  let page = html.replace(THEME_BLOCK, "").replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(input.title)}</title>`);
  const dataMeta = input.dataClientId ? `<meta name="goodbuild-data" content="${escapeHtml(input.dataClientId)}" />\n` : "";
  const walletMeta = input.walletConnectProjectId ? `<meta name="goodbuild-walletconnect" content="${escapeHtml(input.walletConnectProjectId)}" />\n` : "";
  page = page.replace("</head>", () => `${dataMeta}${walletMeta}<link rel="stylesheet" href="/${cssName}" />\n</head>`);
  const bridge = input.preview?.bridge(js, jsName);
  if (!input.preview) page = page.replace(/<body[^>]*>/, (open) => `${open}\n${bar(input.hasUndeployedContracts, input.reportUrl, input.changeableContract, hasMiniPayKit(files), input.showBadge ?? true)}`);
  // The bridge is a classic script, so it is listening before the app's module runs.
  const showBadge = input.showBadge ?? true;
  const space = input.preview || !hasBar(input.hasUndeployedContracts, !!input.changeableContract, showBadge) ? "" : `${barSpace(input.hasUndeployedContracts || !!input.reportUrl || !!input.changeableContract)}\n`;
  page = page.replace("</body>", () => `${space}${bridge ? `<script src="/${PREVIEW_BRIDGE_PATH}"></script>\n` : ""}<script type="module" src="/${jsName}"></script>\n</body>`);

  const encoder = new TextEncoder();
  const output: PublishedFile[] = [
    { path: "index.html", mime: "text/html; charset=utf-8", bytes: encoder.encode(page) },
    { path: jsName, mime: "text/javascript; charset=utf-8", bytes: encoder.encode(js) },
    { path: cssName, mime: "text/css; charset=utf-8", bytes: encoder.encode(css) },
    ...chunks.map((c) => ({ path: c.path, mime: "text/javascript; charset=utf-8", bytes: encoder.encode(c.text) })),
    ...(bridge ? [{ path: PREVIEW_BRIDGE_PATH, mime: "text/javascript; charset=utf-8", bytes: encoder.encode(bridge) }] : []),
    ...input.assets.map((a) => ({ path: `assets/${a.name}`, mime: a.mime, bytes: a.bytes })),
  ];
  const size = output.reduce((sum, f) => sum + f.bytes.length, 0);
  if (size > MAX_PUBLISH_BYTES) {
    throw new PublishBuildError(`The app is ${Math.ceil(size / 1024 / 1024)} MB, and the limit is ${MAX_PUBLISH_BYTES / 1024 / 1024} MB. Remove some images and try again.`);
  }
  return output;
}
