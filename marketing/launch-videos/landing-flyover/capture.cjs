// Captures https://goodbuildit.xyz (or $URL) into a flat page texture + one transparent PNG per liftable piece.
// usage: node capture.cjs [outDir]
const fs = require('fs'), path = require('path');
const { launch } = require('../_shared/launch.cjs');
const URL = process.env.URL || 'https://goodbuildit.xyz';
const out = path.resolve(process.argv[2] || path.join(__dirname, 'capture'));
fs.rmSync(out + '/layers', { recursive: true, force: true }); fs.mkdirSync(out + '/layers', { recursive: true });
const PAD = 28;
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} header{position:static!important}' });
  const H0 = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H0; y += 300) { await p.evaluate(y => scrollTo(0, y), y); await p.waitForTimeout(120); }
  await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(600);
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(800);
  await p.evaluate(async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); });
  // the live copy still says "add credits with CELO"; the purchase is G$ (src/components/credits). Fix that one string in this capture only.
  await p.evaluate(() => { document.querySelectorAll('p,span,div').forEach(e => { if (e.children.length === 0 && /add credits with CELO\./.test(e.textContent)) e.textContent = e.textContent.replace('add credits with CELO.', 'add credits with G$.'); }); });
  // mark liftable pieces
  const marked = await p.evaluate(() => {
    const L = []; const mark = (el, name, lift) => { if (!el || el.hasAttribute('data-layer')) return; el.setAttribute('data-layer', name); el.setAttribute('data-lift', lift); };
    const q = s => [...document.querySelectorAll(s)];
    q('section.rounded-card').forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.top + scrollY < 700 && r.width > 250) mark(e, 'hero-card-' + i, 16); });
    const ta = document.querySelector('textarea'); mark(ta && (ta.closest('form') || ta.closest('div.rounded-card') || ta.parentElement.parentElement.parentElement), 'prompt', 20);
    q('img').forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.width > 200 && r.top + scrollY < 700 && !/mix-blend/.test(e.className)) mark(e, 'hero-art-' + i, 44); });
    q('button').forEach(e => { const t = e.textContent.trim(); const r = e.getBoundingClientRect(); if (r.top + scrollY > 700 && r.top + scrollY < 860 && r.width > 40) { if (/^Build it/.test(t)) mark(e, 'cta-button', 70); else if (/savings circle|tip jar|Event tickets/.test(t)) mark(e, 'chip-' + t.slice(0, 6), 52); } });
    q('span,div').forEach(e => { if (e.children.length === 0 && /AI dApp builder/.test(e.textContent)) mark(e, 'chip-badge', 56); });
    q('ol > li').forEach((e, i) => mark(e, 'step-' + i, 24));
    q('section ul[class*="lg:grid-cols-3"] > li').forEach((e, i) => mark(e, 'tile-' + i, 26));
    q('article').forEach((e, i) => mark(e, 'article-' + i, 22));
    q('div.rounded-card.shadow-card').forEach((e, i) => { if (e.querySelector('details')) mark(e, 'faq', 18); });
    q('section[class*="bg-violet"]').forEach((e, i) => mark(e, 'cta-' + i, 24));
    q('img').forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.width > 200 && r.height > 200 && r.top + scrollY > 900) mark(e, 'photo-' + i, 40); });
    return q('[data-layer]').map(e => { const r = e.getBoundingClientRect(); return { name: e.getAttribute('data-layer'), lift: +e.getAttribute('data-lift'), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, radius: parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0 }; });
  });
  const H = await p.evaluate(() => document.documentElement.scrollHeight);
  // base: layers hidden
  await p.addStyleTag({ content: '[data-layer]{visibility:hidden!important}' });
  await p.screenshot({ path: out + '/base.png', fullPage: true });
  // each layer alone, transparent, padded
  await p.addStyleTag({ content: 'html.solo,html.solo body{background:transparent!important} html.solo body *{visibility:hidden!important} html.solo .solo-on,html.solo .solo-on *{visibility:visible!important} html.solo .solo-on [data-layer]{visibility:hidden!important} html.solo .solo-on [data-layer] *{visibility:hidden!important}' });
  await p.evaluate(() => document.documentElement.classList.add('solo'));
  const meta = [];
  for (let i = 0; i < marked.length; i++) {
    const m = marked[i];
    // re-resolve by order
    await p.evaluate(i => { document.querySelectorAll('.solo-on').forEach(e => e.classList.remove('solo-on')); const e = document.querySelectorAll('[data-layer]')[i]; e.classList.add('solo-on'); }, i);
    // hide the page's own style [data-layer]{visibility:hidden}: the solo rule needs higher specificity
    await p.addStyleTag({ content: 'html.solo .solo-on[data-layer]{visibility:visible!important}' });
    const clip = { x: Math.max(0, m.x - PAD), y: Math.max(0, m.y - PAD), width: Math.min(1440, m.w + 2 * PAD), height: m.h + 2 * PAD };
    clip.width = Math.min(clip.width, 1440 - clip.x);
    const file = `layers/${String(i).padStart(2, '0')}-${m.name.replace(/[^a-z0-9-]/gi, '_')}.png`;
    await p.screenshot({ path: `${out}/${file}`, clip, fullPage: true, omitBackground: true });
    meta.push({ ...m, file, cx: clip.x, cy: clip.y, cw: clip.width, ch: clip.height });
  }
  fs.writeFileSync(out + '/layers.json', JSON.stringify({ url: URL, pageW: 1440, pageH: H, pad: PAD, layers: meta }, null, 1));
  console.log('page', H, 'layers', meta.length); meta.forEach(m => console.log(m.name, Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h), m.lift));
  await b.close();
})();
