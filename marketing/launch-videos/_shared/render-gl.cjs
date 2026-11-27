#!/usr/bin/env node
// Render a WebGL seek(t) page (served over local http so textures aren't tainted).
// usage: node render-gl.cjs --page landing-flyover/film.html --w 1440 --h 1152 --dur 14.5 --fps 60 --out DIR [--sub 16] [--at t1,t2] [--frames a-b]
const http = require('http'), fs = require('fs'), path = require('path');
const { launch } = require('./launch.cjs');
const a = {}; for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const W = +a.w, H = +a.h, FPS = +(a.fps || 60), DUR = +a.dur, out = path.resolve(a.out); fs.mkdirSync(out, { recursive: true });
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const port = srv.address().port, b = await launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
  p.on('console', m => { const t = m.text(); if (!/GPU stall|ReadPixels/.test(t)) console.log('[page]', t); }); p.on('pageerror', e => console.log('[err]', e.message));
  await p.goto(`http://localhost:${port}/${a.page}`); await p.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  if (a.sub) await p.evaluate(s => window.SUB = s, +a.sub);
  const shot = async fn => p.screenshot({ path: fn });
  if (a.at) { for (const t of a.at.split(',')) { const t0 = Date.now(); await p.evaluate(t => window.seek(t), +t); await shot(`${out}/still_${(+t).toFixed(2).padStart(6, '0')}.png`); console.log('t', t, Date.now() - t0, 'ms'); } }
  else {
    const N = Math.round(DUR * FPS); let [f0, f1] = a.frames ? a.frames.split('-').map(Number) : [0, N - 1];
    // optional worker split: --part k/n
    const [pk, pn] = (a.part || '0/1').split('/').map(Number);
    for (let f = f0; f <= f1; f++) { if (f % pn !== pk) continue; const fn = `${out}/f${String(f).padStart(5, '0')}.png`; if (fs.existsSync(fn)) continue; for (let tries = 0; ; tries++) { await p.evaluate(t => window.seek(t), f / FPS); if (!(await p.evaluate(() => !!window.__lost)) ) break; console.log('context lost at frame', f, '- reloading'); await p.reload(); await p.waitForFunction(() => window.ready === true, null, { timeout: 120000 }); } await shot(fn); if (f % 30 === 0) console.log('frame', f); }
  }
  await b.close(); srv.close(); console.log('done');
});
