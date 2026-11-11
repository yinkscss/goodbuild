"""Music bed + final mix -> public/audio.wav.

Reads src/cues.json (written by make_voice.py), so every hit follows the narration.
Warm 104 bpm bed that sits under the voice: pad and soft pluck arpeggio, a light pulse from the
"three steps" line on, a bell on every step, small UI ticks on the taps. The music is ducked under the voice.
"""
import json, os, re, subprocess, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import synth as S
from synth import add, bell, clap, crash, hat, hp, kick, lp, midi, pad, pluck, reverse_swell, riser, stab, sub, tick

CU = json.load(open(os.path.join(ROOT, "src", "cues.json")))
DUR = CU["duration"]; SR = S.SR
S.init(DUR)
BEAT = 60 / 104
rng = np.random.default_rng(5)


def wt(line, pat, nth=0):
    hits = [w for w in CU["lines"][line]["words"] if re.search(pat, w["w"], re.I)]
    h = hits[nth] if nth >= 0 else hits[nth]
    return h["start"]


sc = lambda i: CU["scenes"][i]["start"]
PROG = [(29, [53, 57, 60, 64, 67]), (26, [53, 57, 60, 62, 65]), (34, [50, 53, 57, 60, 62]), (31, [48, 55, 59, 62, 67])]  # F  Dm  Bb  Gsus-ish
chord_at = lambda t: PROG[int(t // (BEAT * 4)) % len(PROG)]


def music(t0, t1, pulse=True, arp=True, pads=True, lift=1.0):
    t = t0 - (t0 % (BEAT * 4)) if False else t0
    b = 0
    while t < t1 - 1e-6:
        root, notes = chord_at(t)
        d = min(BEAT * 4, t1 - t) if b % 4 == 0 else 0
        if pads and b % 4 == 0:
            pl, pr = pad(notes, BEAT * 4 + 0.4, f0=500, f1=1800 * lift, a=0.25, r_=0.5)
            add(None, t, stereo=(pl * 0.9, pr * 0.9), send=0.5)
            add(sub(midi(root), BEAT * 3.8, 0.16), t)
        if pulse:
            add(kick(), t, gain=0.5 if b % 2 == 0 else 0.35)
            S.DUCK_TIMES.append(t)
            if b % 2 == 1: add(clap(), t, send=0.3, gain=0.5)
        for q in range(2):
            add(hat(), t + q * BEAT / 2 + BEAT / 4 * 0, pan=-0.3 if q else 0.3, gain=0.35)
        if arp:
            for q in range(4):
                n = notes[(b * 4 + q * 2) % len(notes)] + 12
                add(pluck(n, 0.22, 2600), t + q * BEAT / 4 * 1.0, pan=(-0.45, 0.45)[q % 2], send=0.55, gain=0.36 * lift)
        t += BEAT; b += 1


# 0 - hook: sparse
pl, pr = pad([41, 53, 57, 60, 64], sc("what") + 0.8, f0=250, f1=1500, a=1.2, r_=0.2)
add(None, 0, stereo=(pl, pr), send=0.6)
for k in range(int(sc("what") / BEAT)):
    add(pluck([65, 69, 72, 76][k % 4] + 12, 0.3, 1800), k * BEAT, pan=(-0.4, 0.4)[k % 2], send=0.7, gain=0.22)
add(riser(1.5), sc("what") - 1.45, send=0.4, gain=0.7)
add(reverse_swell(0.5), sc("what") - 0.5, gain=0.5)
add(bell(77, 2.5, 0.05), CU["lines"]["h3"]["start"], send=0.8)

# what: bed arrives
w0 = sc("what")
add(kick(big=True), w0, gain=0.7); S.DUCK_TIMES.append(w0)
add(crash(2.0, 0.2), w0, send=0.5)
music(w0, sc("deploy"), pulse=False, arp=True)
s4 = CU["lines"]["w4"]["start"]
music(s4 - (s4 % BEAT), sc("deploy"), pulse=True, arp=False, pads=False)

# the three steps: a bell + hit on each step's scene start
steps = ["deploy", "publish", "minipay"]
for i, sid in enumerate(steps):
    t0 = sc(sid)
    add(kick(big=True), t0, gain=0.7); S.DUCK_TIMES.append(t0)
    add(reverse_swell(0.4), t0 - 0.4, gain=0.5)
    for k, m in enumerate([72 + 4 * i, 76 + 4 * i, 79 + 4 * i][: 2 + i]):
        add(bell(m + 5, 2.2, 0.06), t0 + 0.05 + k * 0.11, pan=(-0.3, 0.3, 0)[k], send=0.8)
music(sc("deploy"), sc("list"), pulse=True, arp=True)

# ui ticks tied to the narration (button presses, toggles, taps)
def click(t, hi=False):
    add(pluck(96 if hi else 88, 0.12, 6000), t, pan=0.0, send=0.35, gain=0.5)
    add(tick(), t, gain=0.9)
click(wt("d4", r"^Sign$"), True)
for pat, ln in [(r"^Broadcast", "d5"), (r"^Verified", "d5")]:
    add(bell(84, 1.6, 0.07), wt(ln, pat), send=0.7)
add(bell(88, 2.5, 0.08), wt("d5", r"^live$"), send=0.8); add(bell(93, 2.5, 0.06), wt("d5", r"^live$") + 0.12, send=0.8)
for ln, pat in [("p2", r"^tick$"), ("p2", r"^Publish\.?$")]: click(wt(ln, pat))
add(bell(88, 2.5, 0.08), wt("p3", r"^own$"), send=0.8); add(bell(95, 2.5, 0.06), wt("p3", r"^own$") + 0.12, send=0.8)
for ln, pat, n in [("m2", r"^Developer$", 0), ("m2", r"^Mode\.?$", 0), ("m2", r"^Testnet$", 0), ("m3", r"^Load$", 0), ("m3", r"^Go\.?$", 0)]: click(wt(ln, pat, n))
add(bell(91, 3.0, 0.09), CU["lines"]["m4"]["start"], send=0.8); add(bell(96, 3.0, 0.07), CU["lines"]["m4"]["start"] + 0.12, send=0.8)
for sid_i, w in enumerate(["About,?$", "How$", "Terms,?$", "Privacy$", "Support$", "^footer$"]):
    add(pluck(84 + sid_i * 2, 0.15, 5000), wt("l2", w), pan=-0.3 + 0.12 * sid_i, send=0.4, gain=0.45)

# outro lift
o0 = sc("outro")
add(kick(big=True), o0, gain=0.8); S.DUCK_TIMES.append(o0)
add(crash(3.5, 0.22), o0, send=0.6)
pl, pr = pad([41, 53, 57, 60, 64, 67, 72], DUR - o0, f0=1800, f1=700, a=0.05, r_=1.2)
add(None, o0, stereo=(pl * 1.2, pr * 1.2), send=0.7)
add(sub(midi(29), 3.5, 0.4), o0)
t_logo = CU["lines"]["o2"]["start"]
for k, m in enumerate([77, 81, 84, 88, 89]):
    add(bell(m, 3.5, 0.05), t_logo + k * 0.14, pan=(-0.5, 0.5, -0.25, 0.25, 0)[k], send=0.9)

# ---- voice + mix
vr, vx = wavfile.read(os.path.join(ROOT, "public", "voice.wav"))
v = vx.astype(np.float32) / (32768.0 if vx.dtype == np.int16 else 1.0)
if v.ndim > 1: v = v.mean(1)
v = resample_poly(v, SR // vr, 1)
v = hp(v, 70)
N = S.N
v = np.pad(v, (0, max(0, N - len(v))))[:N]
v = np.tanh(v / max(np.abs(v).max(), 1e-6) * 1.4) / np.tanh(1.4) * 0.8  # gentle level + soft peaks
# duck the music from a smoothed voice envelope, plus the beat pump
env = lp(np.abs(v), 6, 1)
env = np.clip(env / (np.percentile(env, 95) + 1e-9), 0, 1)
t_all = np.arange(N) / SR
pump = np.ones(N)
for tk in S.DUCK_TIMES:
    i0 = S.idx(tk); seg = t_all[i0:i0 + S.idx(BEAT)] - tk
    pump[i0:i0 + len(seg)] = np.minimum(pump[i0:i0 + len(seg)], 1 - 0.4 * np.exp(-seg / 0.09))
duck = (1 - 0.72 * env) * pump


def ir(d=2.4, seed=0):
    r = np.random.default_rng(seed); t = S.tt(d)
    return lp(r.standard_normal(len(t)) * np.exp(-t / (d / 6.0)), 6000) * 0.09


def conv(x, h):
    n = len(x) + len(h); nf = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(h, nf), nf)[: len(x)]


ml = (S.L + conv(S.SEND_L, ir(seed=1))) * duck
mr = (S.R + conv(S.SEND_R, ir(seed=2))) * duck
fade = np.ones(N); f0 = S.idx(DUR - 1.4); fade[f0:] = np.linspace(1, 0, N - f0) ** 1.4
mix_l = (v + ml * 0.5) * fade; mix_r = (v + mr * 0.5) * fade
pk = max(np.abs(mix_l).max(), np.abs(mix_r).max())
out = np.stack([mix_l, mix_r], 1) / pk * 0.89
raw = os.path.join(ROOT, "public", "mix_raw.wav")
wavfile.write(raw, SR, (out * 32767).astype(np.int16))
# loudness-normalise to a social-friendly level
final = os.path.join(ROOT, "public", "audio.wav")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af", "loudnorm=I=-15:TP=-1.5:LRA=9", "-ar", "48000", final], check=True)
os.remove(raw)
print("wrote public/audio.wav", f"{DUR:.1f}s")
