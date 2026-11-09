// Synthesised 120 BPM loop bed (original, no samples) + UI sounds on measured peaks. Output: audio.wav (14 s, 44.1 kHz stereo, wraps seamlessly).
const fs = require('fs'), path = require('path');
const SR = 44100, BPM = 120, BEAT = 60 / BPM, DUR = 28 * BEAT, N = Math.round(DUR * SR);
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 * 2 - 1;
function add(t0, len, fn, pan = 0, gain = 1) { // circular add so tails wrap for a seamless loop
  const n0 = Math.round(t0 * SR), n = Math.round(len * SR);
  for (let i = 0; i < n; i++) { const v = fn(i / SR, i) * gain; const k = (n0 + i) % N; L[k] += v * (1 - Math.max(0, pan)); R[k] += v * (1 + Math.min(0, pan)); }
}
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const env = (t, a, d) => Math.min(1, t / a) * Math.exp(-t / d);
function lp() { let y = 0; return (x, k) => (y += k * (x - y)); }
// ---- bed ----
const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G, one per bar, repeats
for (let b = 0; b < 28; b++) {
  const t = b * BEAT;
  add(t, .32, (x) => Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-x * 28)) * x * 1) * env(x, .002, .11) * 1.0, 0, 0.55); // kick (phase approx)
  // hat on the off-beat
  const lph = lp(); add(t + BEAT / 2, .07, (x) => { const n = rnd(); return (n - lph(n, .35)) * Math.exp(-x / .018); }, .15, 0.16);
  // bass pluck on 1 and the "and" of 2
  const bar = Math.floor(b / 4), ch = chords[bar % 4];
  if (b % 4 === 0 || b % 4 === 2) { const f = mtof(ch[0] - 24); const l2 = lp(); add(t, .45, (x) => l2(Math.sin(2 * Math.PI * f * x) + .4 * Math.sin(4 * Math.PI * f * x), .6) * env(x, .004, .22), 0, 0.35); }
  // arpeggio pluck every beat
  const note = ch[b % 3] + 12 + ((b % 8) > 3 ? 12 : 0); const f = mtof(note);
  add(t + BEAT / 2 * (b % 2), .4, (x) => (Math.sin(2 * Math.PI * f * x) + .25 * Math.sin(6 * Math.PI * f * x)) * env(x, .003, .12), (b % 2 ? .3 : -.3), 0.13);
}
// ---- analysis: measure the bed's onsets (energy flux, 5 ms hop) ----
function analyse(sig) {
  const hop = Math.round(.005 * SR), win = hop * 2, env = [];
  for (let i = 0; i + win < sig.length; i += hop) { let e = 0; for (let j = 0; j < win; j++) e += sig[i + j] * sig[i + j]; env.push(Math.sqrt(e / win)); }
  const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] || 0)));
  const mx = Math.max(...flux), peaks = [];
  for (let i = 2; i < flux.length - 2; i++) if (flux[i] > mx * .35 && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1] && (!peaks.length || (i - peaks[peaks.length - 1]) * .005 > .2)) peaks.push(i);
  return peaks.map(i => i * .005);
}
const bed = L.map((v, i) => (v + R[i]) / 2);
const pk = analyse(bed);
const ioi = pk.slice(1).map((v, i) => v - pk[i]).sort((a, b) => a - b)[Math.floor((pk.length - 1) / 2)];
console.log(`onsets: ${pk.length}, median interval ${ioi.toFixed(3)} s = ${(60 / ioi).toFixed(1)} BPM, first peak at ${pk[0].toFixed(3)} s`);
fs.writeFileSync(path.join(__dirname, 'beatgrid.json'), JSON.stringify({ bpm: 60 / ioi, firstPeak: pk[0], peaks: pk.slice(0, 40) }, null, 1));
const grid = b => { // nearest measured peak to beat b (UI sounds sit on measured peaks)
  const t = b * BEAT; return pk.reduce((a, p) => Math.abs(p - t) < Math.abs(a - t) ? p : a, pk[0]);
};
// ---- UI sounds, snapped to measured peaks. Click times mirror index.html (state change = beat + 0.04 for clicks) ----
const clicks = [2, 8, 11, 14, 16], morphs = [3, 4, 6, 13, 15, 17, 20, 22, 25], drag = [9, 10.4];
const tick = (t, g = 1) => { const l = lp(); add(t, .05, (x) => (rnd() - l(rnd(), .25)) * Math.exp(-x / .006) * .8 + Math.sin(2 * Math.PI * 1800 * x) * Math.exp(-x / .01) * .4, 0, .5 * g); };
const blip = (t, m, g = 1) => add(t, .3, (x) => Math.sin(2 * Math.PI * mtof(m) * x) * env(x, .002, .09) + .3 * Math.sin(4 * Math.PI * mtof(m) * x) * env(x, .002, .05), 0, .22 * g);
clicks.forEach(b => tick(grid(b) - 0.005));
const scale = [69, 72, 76, 79, 81, 84, 88, 91, 93];
morphs.forEach((b, i) => blip(grid(b), scale[i % scale.length]));
for (let t = drag[0] * BEAT; t < drag[1] * BEAT; t += .07) tick(t, .22 + (t - drag[0] * BEAT) * .1); // scrub ticks while dragging
// "Live on mainnet" chime (beat 22) + success on check (beat 3)
[76, 80, 83, 88].forEach((m, i) => blip(grid(22) + i * .06, m, 1.1));
// ---- normalise, soft clip, write wav ----
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.89 / peak, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(Math.tanh(L[i] * g * 1.1) * 32000), 44 + i * 4); buf.writeInt16LE(Math.round(Math.tanh(R[i] * g * 1.1) * 32000), 46 + i * 4); }
fs.writeFileSync(path.join(__dirname, 'audio.wav'), buf);
console.log('audio.wav', (buf.length / 1e6).toFixed(1), 'MB');
