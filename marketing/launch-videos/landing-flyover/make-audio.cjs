// Landing fly-over score: pad + whooshes at 8.66 and 9.80 + hit at 9.97. Renders with Web Audio OfflineAudioContext inside headless Chromium, writes audio.wav (15 s, 44.1 kHz stereo).
const fs = require('fs'), path = require('path');
const { launch } = require('../_shared/launch.cjs');
(async () => {
  const b = await launch(); const p = await b.newPage();
  const b64 = await p.evaluate(async () => {
    const SR = 44100, DUR = 14.5, BEAT = .5; const ctx = new OfflineAudioContext(2, SR * DUR, SR);
    const out = ctx.createGain(); out.gain.value = .9; const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; out.connect(comp); comp.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, SR * 2, SR); { const d = noiseBuf.getChannelData(0); let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; } }
    const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); };
    const tone = (t, f0, f1, dec, peak, type = 'sine', pan = 0) => { const o = ctx.createOscillator(), g = ctx.createGain(), pn = ctx.createStereoPanner(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dec); env(g, t, .003, peak, dec); pn.pan.value = pan; o.connect(g); g.connect(pn); pn.connect(out); o.start(t); o.stop(t + dec + .05); };
    const noise = (t, dur, f, q, peak, type = 'highpass', sweepTo, pan = 0) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); fl.Q.value = q; const g = ctx.createGain(); env(g, t, Math.min(.01, dur / 4), peak, dur); const pn = ctx.createStereoPanner(); pn.pan.value = pan; s.connect(fl); fl.connect(g); g.connect(pn); pn.connect(out); s.start(t); s.stop(t + dur + .05); };
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    // airy pad (Am9 -> Fmaj7), slow swell, then a whoosh on the rise (8.66) and on the dive (9.80), track hit at 9.97
    const pad = (t0, t1, notes, peak) => notes.forEach((m, i) => { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = mtof(m) * (1 + (i % 2 ? .002 : -.002)); f.type = 'lowpass'; f.frequency.setValueAtTime(500, t0); f.frequency.linearRampToValueAtTime(1800, t1 - .5); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 1.2); g.gain.setValueAtTime(peak, t1 - 1); g.gain.linearRampToValueAtTime(0, t1); o.connect(f); f.connect(g); g.connect(out); o.start(t0); o.stop(t1 + .1); });
    pad(0, 8.0, [45, 57, 60, 64, 71], .03); pad(7.0, 14.5, [41, 53, 57, 60, 64], .03);
    for (let b = 0; b < 16; b++) { const t = b * .5; if (t < 8.2) { tone(t, 150, 42, .2, .35 * Math.min(1, t / 2 + .2)); } }
    const whoosh = (t, dur, f0, f1, peak) => noise(t - dur * .55, dur, f0, 1.1, peak, 'bandpass', f1);
    whoosh(8.66, 1.0, 250, 6000, .5); whoosh(9.80, .55, 500, 9000, .6);
    tone(9.97, 110, 36, .9, 1.0); noise(9.97, .5, 300, .6, .5, 'lowpass', 90); noise(9.97, .25, 4000, .7, .25, 'highpass');
    [76, 83, 88].forEach((m, i) => tone(9.97 + i * .07, mtof(m), mtof(m), 1.4, .09, 'sine'));
    // lifts: soft ticks as pieces float up in the first seconds
    [.3, .55, .8, 1.0, 1.2, 1.4].forEach((t, i) => tone(t, 1400 + i * 120, 900, .1, .08, 'triangle', (i % 2) * .4 - .2));
    // title words
    [10.12, 10.18, 10.24, 10.52, 10.57, 10.62, 10.67].forEach((t, i) => tone(t, 1800 + (i % 4) * 200, 1500, .12, .05, 'triangle', i % 2 ? .2 : -.2));
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1); const n = L.length; const ab = new ArrayBuffer(44 + n * 4); const dv = new DataView(ab);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); wr(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, n * 4, true);
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = .9 / pk;
    for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), true); dv.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), true); }
    let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s);
  });
  fs.writeFileSync(path.join(__dirname, 'audio.wav'), Buffer.from(b64, 'base64')); console.log('audio.wav written'); await b.close();
})();
