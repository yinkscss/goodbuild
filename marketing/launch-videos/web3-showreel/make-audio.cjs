// Renders the soundtrack with Web Audio OfflineAudioContext inside headless Chromium, writes audio.wav (15 s, 44.1 kHz stereo).
const fs = require('fs'), path = require('path');
const { launch } = require('../_shared/launch.cjs');
(async () => {
  const b = await launch(); const p = await b.newPage();
  const b64 = await p.evaluate(async () => {
    const SR = 44100, DUR = 15, BEAT = .5; const ctx = new OfflineAudioContext(2, SR * DUR, SR);
    const out = ctx.createGain(); out.gain.value = .9; const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; out.connect(comp); comp.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, SR * 2, SR); { const d = noiseBuf.getChannelData(0); let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; } }
    const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); };
    const tone = (t, f0, f1, dec, peak, type = 'sine', pan = 0) => { const o = ctx.createOscillator(), g = ctx.createGain(), pn = ctx.createStereoPanner(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dec); env(g, t, .003, peak, dec); pn.pan.value = pan; o.connect(g); g.connect(pn); pn.connect(out); o.start(t); o.stop(t + dec + .05); };
    const noise = (t, dur, f, q, peak, type = 'highpass', sweepTo, pan = 0) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); fl.Q.value = q; const g = ctx.createGain(); env(g, t, Math.min(.01, dur / 4), peak, dur); const pn = ctx.createStereoPanner(); pn.pan.value = pan; s.connect(fl); fl.connect(g); g.connect(pn); pn.connect(out); s.start(t); s.stop(t + dur + .05); };
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    for (let b = 0; b < 30; b++) {
      const t = b * BEAT;
      tone(t, 160, 42, .22, .95); // kick on every beat
      noise(t + BEAT / 2, .06, 7000, .7, .18, 'highpass', null, .2); // hat
      if (b % 4 === 0 || b % 4 === 2) { const root = [45, 41, 36, 43][Math.floor(b / 4) % 4]; tone(t, mtof(root), mtof(root) * .98, .45, .45, 'sine'); tone(t, mtof(root + 12), mtof(root + 12), .3, .12, 'triangle'); }
      if (b >= 4 && b % 2 === 1 && b < 28) { const ch = [57, 60, 64, 67][b % 4]; tone(t + .25, mtof(ch + 12), mtof(ch + 12), .18, .09, 'triangle', (b % 4 - 1.5) * .3); }
    }
    // scene-change hits at beats 4,8,12,16,20,24,28
    [4, 8, 12, 16, 20, 24, 28].forEach(bt => { const t = bt * BEAT; tone(t, 90, 38, .5, .9); noise(t, .35, 400, .5, .5, 'lowpass', 80); noise(t, .2, 3000, .8, .22, 'highpass'); });
    // riser into the last full bar (beat 20 -> 24)
    { const t0 = 20 * BEAT, t1 = 24 * BEAT; const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 3; fl.frequency.setValueAtTime(300, t0); fl.frequency.exponentialRampToValueAtTime(9000, t1); const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.5, t1 - .02); g.gain.linearRampToValueAtTime(0, t1 + .02); s.connect(fl); fl.connect(g); g.connect(out); s.start(t0); s.stop(t1 + .1);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t0); o.frequency.exponentialRampToValueAtTime(880, t1); const og = ctx.createGain(); og.gain.setValueAtTime(0, t0); og.gain.linearRampToValueAtTime(.12, t1 - .02); og.gain.linearRampToValueAtTime(0, t1 + .02); const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 2500; o.connect(lf); lf.connect(og); og.connect(out); o.start(t0); o.stop(t1 + .1); }
    // UI: word pulses (b0-3), typing (5.75-7.1), flood whooshes (zoom-through into each scene), toggle click, chimes
    for (let i = 0; i < 4; i++) tone(i * BEAT + .015, 900 + i * 150, 700 + i * 120, .08, .22, 'triangle');
    for (let c = 0; c < 26; c++) { const t = (5.75 + c * (1.35 / 26)) * BEAT; noise(t, .03, 2500, 1, .12, 'bandpass', null, (c % 2) * .3 - .15); }
    [3.45, 7.6, 11.55, 15.55, 19.9, 23.6, 27.55].forEach(bt => noise(bt * BEAT, .45, 400, 1.2, .35, 'bandpass', 5000));
    noise(25 * BEAT, .05, 2000, 2, .5, 'bandpass'); tone(25 * BEAT, 1200, 900, .12, .2, 'triangle');
    tone(13.25 * BEAT, mtof(84), mtof(84), .5, .12, 'sine'); tone(23 * BEAT, mtof(88), mtof(88), .6, .14, 'sine');
    [76, 79, 83, 88].forEach((m, i) => tone(26 * BEAT + i * .06, mtof(m), mtof(m), .7, .12, 'sine')); // "Live on mainnet" chime
    [28.7, 28.85, 29.0].forEach((bt, i) => tone(bt * BEAT, mtof(72 + i * 4), mtof(72 + i * 4), .5, .1, 'sine'));
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
