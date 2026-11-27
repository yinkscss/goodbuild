// Shared Playwright launcher. Finds playwright (env PW_DIR, or the repo's node_modules, or ~/.showtime) and a Chromium build.
const fs = require('fs'), path = require('path'), os = require('os');
const { createRequire } = require('module');
function loadPlaywright() {
  const cands = [process.env.PW_DIR, path.join(__dirname, '../../../node_modules'), path.join(os.homedir(), '.showtime/node/node_modules')].filter(Boolean);
  for (const c of cands) { try { return createRequire(path.join(c, 'x.js'))('playwright'); } catch (e) {} }
  throw new Error('playwright not found; set PW_DIR to a node_modules dir containing it');
}
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (!fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const root = path.join(base, d);
    for (const sub of fs.readdirSync(root)) {
      const app = path.join(root, sub);
      if (!fs.statSync(app).isDirectory()) continue;
      for (const f of fs.readdirSync(app)) if (f.endsWith('.app')) {
        const mac = path.join(app, f, 'Contents/MacOS'); return path.join(mac, fs.readdirSync(mac)[0]);
      }
    }
  }
}
async function launch(extraArgs = []) {
  const { chromium } = loadPlaywright();
  return chromium.launch({ executablePath: findChrome(), args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force-color-profile=srgb', ...extraArgs] });
}
module.exports = { launch, loadPlaywright, findChrome };
