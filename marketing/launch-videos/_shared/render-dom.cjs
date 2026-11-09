#!/usr/bin/env node
// Render a seek(t) page to subframe PNGs with parallel pages, then blend with ffmpeg tmix.
// usage: node render-dom.cjs --page file.html --w 1440 --h 1440 --dur 14 --fps 60 --sub 4 --shutter 0.5 --workers 3 --out DIR [--frames a-b] [--at t1,t2,...] [--only-beats]
const path = require('path'), fs = require('fs');
const { launch } = require('./launch.cjs');
const a = {}; for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const W = +a.w, H = +a.h, DUR = +a.dur, FPS = +(a.fps || 60), SUB = +(a.sub || 4), SH = +(a.shutter || 0.5), NW = +(a.workers || 3);
const out = path.resolve(a.out); fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.resolve(a.page);
async function mk(b) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(a.dsf || 1) });
  const p = await ctx.newPage(); await p.goto(url); await p.evaluate(() => document.fonts.ready); await p.waitForFunction(() => window.ready !== false);
  return p;
}
(async () => {
  const b = await launch();
  if (a.at) { // stills at given times
    const p = await mk(b);
    for (const t of a.at.split(',')) { await p.evaluate(t => window.seek(t), +t); await p.screenshot({ path: `${out}/still_${(+t).toFixed(2)}.png` }); }
    await b.close(); return;
  }
  const N = Math.round(DUR * FPS);
  let [f0, f1] = a.frames ? a.frames.split('-').map(Number) : [0, N - 1];
  const frames = []; for (let f = f0; f <= f1; f += +(a.step || 1)) frames.push(f);
  let next = 0, done = 0;
  const worker = async () => {
    const p = await mk(b);
    while (next < frames.length) {
      const f = frames[next++];
      for (let j = 0; j < SUB; j++) {
        const t = (f + ((j + 0.5) / SUB - 0.5) * SH + 0.5 * SH * 0) / FPS; // centred shutter
        const fn = `${out}/f${String(f).padStart(5, '0')}_${j}.png`;
        if (fs.existsSync(fn)) continue;
        await p.evaluate(t => window.seek(t), t);
        await p.screenshot({ path: fn });
      }
      if (++done % 60 === 0) console.log(`${done}/${frames.length}`);
    }
  };
  await Promise.all(Array.from({ length: NW }, worker));
  await b.close();
  console.log('done');
})();
