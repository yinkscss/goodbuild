// Render the video (or stills) headlessly.
//   node scripts/render.mjs                 -> out/goodbuildit-platform-launch.mp4
//   node scripts/render.mjs --stills 3,8.5  -> out/still-3.png, out/still-8.5.png
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "out");
fs.mkdirSync(out, { recursive: true });

// Prefer an existing headless Chromium (set CHROME_PATH to override); else Remotion downloads its own.
const candidates = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium_headless_shell-1243/chrome-linux/headless_shell", "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"].filter(Boolean);
const browserExecutable = candidates.find((p) => fs.existsSync(p)) ?? null;
const chromiumOptions = { gl: "swangle" };

const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "PlatformLaunch", browserExecutable, chromiumOptions });

let last = -1;
const i = process.argv.indexOf("--stills");
if (i > -1) {
  for (const s of process.argv[i + 1].split(",")) {
    const frame = Math.round(Number(s) * composition.fps);
    const output = path.join(out, `still-${s}.png`);
    await renderStill({ serveUrl, composition, frame, output, browserExecutable, chromiumOptions, scale: 0.5 });
    console.log("still", output);
  }
} else {
  const master = path.join(out, "master.mp4");
  const output = path.join(out, "goodbuildit-platform-launch.mp4");
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    crf: 16,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: "320k",
    outputLocation: master,
    browserExecutable,
    chromiumOptions,
    imageFormat: "jpeg",
    jpegQuality: 95,
    concurrency: Number(process.env.CONCURRENCY ?? 4),
    onProgress: ({ progress }) => {
      const p = Math.round(progress * 100);
      if (p % 10 === 0 && p !== last) process.stdout.write(`${(last = p)}% `);
    },
  });
  // Delivery encode: H.264 High, ~12 Mbps, AAC 320k, faststart for social uploads.
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", master, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-maxrate", "16M", "-bufsize", "32M", "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output], { stdio: "inherit" });
  console.log("\nwrote", output);
}
