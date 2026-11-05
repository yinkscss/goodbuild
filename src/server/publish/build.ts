import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Message, Plugin } from "esbuild";

import { ALLOWED_DEPENDENCIES } from "@/server/agent/template";

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
  /** Where the allowed packages are installed. */
  runtimeDir?: string;
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
const THEME_BLOCK = /<style type="text\/tailwindcss">([\s\S]*?)<\/style>/g;
const LOADERS = { tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", css: "css", json: "json" } as const;

function packageName(specifier: string) {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

/**
 * Keeps the bundle to the project's own files and the allowed packages. Project code is untrusted:
 * it never gets the filesystem, and `react/../../.env` style specifiers are refused outright.
 */
function projectPlugin(files: Record<string, string>, runtimeDir: string): Plugin {
  return {
    name: "goodbuild-project",
    setup(build) {
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
        if (args.path.split("/").includes("..") || !(packageName(args.path) in ALLOWED_DEPENDENCIES)) {
          return { errors: [{ text: `"${args.path}" isn't on the allowed package list.` }] };
        }
        return build.resolve(args.path, { resolveDir: runtimeDir, kind: args.kind });
      });
      build.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
        const loader = LOADERS[path.extname(args.path).slice(1) as keyof typeof LOADERS];
        return loader ? { contents: files[args.path], loader } : { errors: [{ text: `Can't import ${args.path}.` }] };
      });
    },
  };
}

function describeMessage(m: Message): string {
  return m.location ? `${m.location.file.replace(/^project:/, "")}:${m.location.line}: ${m.text}` : m.text;
}

async function bundle(files: Record<string, string>, runtimeDir: string) {
  const esbuild = await import("esbuild");
  try {
    const result = await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      jsx: "automatic",
      minify: true,
      logLevel: "silent",
      outdir: "/",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [projectPlugin(files, runtimeDir)],
    });
    const output = (ext: string) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? "";
    return { js: output(".js"), css: output(".css") };
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

async function compileTailwind(files: Record<string, string>, theme: string) {
  const [{ compile }, { Scanner }] = await Promise.all([import("tailwindcss"), import("@tailwindcss/oxide")]);
  const dir = path.join(process.cwd(), "node_modules", "tailwindcss");
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

const BAR_STYLE =
  "font:500 12px/1.4 system-ui,sans-serif;padding:6px 12px;text-align:center;background:#1a0d26;color:#fff";

function bar(hasUndeployedContracts: boolean) {
  const demo = hasUndeployedContracts ? " · Demo: this app's contract isn't deployed yet, so on-chain actions won't work." : "";
  return `<div data-goodbuild-bar role="note" style="${BAR_STYLE}">Built with GoodBuild · Unaudited${demo}</div>`;
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
  const { js, css: bundledCss } = await bundle(files, input.runtimeDir ?? path.join(process.cwd(), "publish-runtime"));
  const css = (await compileTailwind(files, theme)) + bundledCss;

  const jsName = hashed("app", "js", js);
  const cssName = hashed("app", "css", css);
  let page = html.replace(THEME_BLOCK, "").replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(input.title)}</title>`);
  page = page.replace("</head>", () => `<link rel="stylesheet" href="/${cssName}" />\n</head>`);
  page = page.replace(/<body[^>]*>/, (open) => `${open}\n${bar(input.hasUndeployedContracts)}`);
  page = page.replace("</body>", () => `<script type="module" src="/${jsName}"></script>\n</body>`);

  const encoder = new TextEncoder();
  const output: PublishedFile[] = [
    { path: "index.html", mime: "text/html; charset=utf-8", bytes: encoder.encode(page) },
    { path: jsName, mime: "text/javascript; charset=utf-8", bytes: encoder.encode(js) },
    { path: cssName, mime: "text/css; charset=utf-8", bytes: encoder.encode(css) },
    ...input.assets.map((a) => ({ path: `assets/${a.name}`, mime: a.mime, bytes: a.bytes })),
  ];
  const size = output.reduce((sum, f) => sum + f.bytes.length, 0);
  if (size > MAX_PUBLISH_BYTES) {
    throw new PublishBuildError(`The app is ${Math.ceil(size / 1024 / 1024)} MB, and the limit is ${MAX_PUBLISH_BYTES / 1024 / 1024} MB. Remove some images and try again.`);
  }
  return output;
}
