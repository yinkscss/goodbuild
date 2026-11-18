/** Render the exact runnable template sources, not a parallel mock. Run with worker-preload.cjs. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PAGE_TEMPLATES } from "../src/config/page-template-data";
import { designTemplateFiles } from "../src/server/agent/design-templates";
import { templateImageFiles } from "../src/server/agent/template-images";
import { starterFiles } from "../src/server/agent/template";
import { buildPublishedApp } from "../src/server/publish/build";

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const htmlOnly = args.includes("--html-only");
  const root = path.join(tmpdir(), "gb-design-templates");
  const out = path.join(process.cwd(), "public/templates");
  const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  mkdirSync(root, { recursive: true }); mkdirSync(out, { recursive: true });
  const slidesPath = path.join(process.cwd(), "src/config/page-template-data/slides.json");
  const slides = JSON.parse(readFileSync(slidesPath, "utf8"));
  for (const t of PAGE_TEMPLATES.filter((t) => t.designSeed && (!only || only.includes(t.id)))) {
    const files = { ...starterFiles(), ...templateImageFiles(t.id), ...designTemplateFiles(t.id) };
    const built = await buildPublishedApp({ files, assets: [], title: t.label, hasUndeployedContracts: false, showBadge: false });
    let html = Buffer.from(built.find((f) => f.path === "index.html")!.bytes).toString();
    for (const f of built) {
      const text = Buffer.from(f.bytes).toString();
      if (f.path.endsWith(".css")) html = html.replace(`<link rel="stylesheet" href="/${f.path}" />`, () => `<style>${text}</style>`);
      if (f.path.endsWith(".js")) html = html.replace(`<script type="module" src="/${f.path}"></script>`, () => `<script type="module">${text.replace(/<\/script/gi, "<\\/script")}</script>`);
    }
    html = html.replace('<html lang="en">', '<html lang="en" data-fx="off">').replace("</body>", '<script>setTimeout(()=>document.documentElement.dataset.h=String(document.body.scrollHeight),500)</script></body>');
    const file = path.join(root, `${t.id}.html`); writeFileSync(file, html);
    if (htmlOnly) continue;
    const options = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--virtual-time-budget=2200"];
    const dom = execFileSync(chrome, [...options, "--window-size=1280,800", "--dump-dom", `file://${file}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const height = Math.max(800, Number(/data-h="(\d+)"/.exec(dom)?.[1] ?? 800));
    const raw = path.join(root, `${t.id}-raw.png`);
    execFileSync(chrome, [...options, `--window-size=1280,${height}`, `--screenshot=${raw}`, `file://${file}`], { stdio: "ignore" });
    const count = height > 1000 ? 2 : 1;
    for (let n = 0; n < count; n++) await sharp(raw).extract({ left: 0, top: n ? Math.min(800, height - 800) : 0, width: 1280, height: 800 }).resize(960,600).png({ palette: true, quality: 90 }).toFile(path.join(out, `${t.id}${n ? "-2" : ""}.png`));
    const mobile = path.join(root, `${t.id}-mobile.png`);
    const mobileFile = path.join(root, `${t.id}-mobile.html`);
    writeFileSync(mobileFile, html.replace("</head>", "<style>html,body,#root{width:390px;max-width:390px}</style></head>"));
    execFileSync(chrome, [...options, "--window-size=390,844", `--screenshot=${mobile}`, `file://${mobileFile}`], { stdio: "ignore" });
    slides[t.id] = count;
    console.log(`rendered ${t.id}: ${count} slides, mobile ${mobile}`);
  }
  if (!htmlOnly) writeFileSync(slidesPath, JSON.stringify(slides, null, 2) + "\n");
  console.log(`Runnable previews: ${root}`);
}
void main();
