"""Synthesise the music bed for the games launch video.

Everything is generated from code (no samples, no licensed audio), and every
hit is placed from src/timeline.json, so if you move a cut the music follows.

    python3 scripts/make_music.py            -> public/music.wav

Structure
  0.0 - 7.0   dark D-minor pad, typewriter ticks on each typed character, riser, gated silence
  7.0         THE DROP: sub boom, braam, crash. One stab + hit per slam word
  11.2 - 37.6 driving 114 bpm groove; the bar restarts on every card so each cut lands on a downbeat
  37.6        final impact, D-major lift, long tail, fade
"""
import json
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TL = json.load(open(os.path.join(ROOT, "src", "timeline.json")))

SR = 48000
DUR = TL["duration"]
N = int(SR * DUR)
BEAT = TL["beat"]
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)
SEND_L = np.zeros(N)  # reverb send
SEND_R = np.zeros(N)
DUCK_TIMES = []


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def idx(t):
    return int(round(t * SR))


def add(sig, t, pan=0.0, gain=1.0, send=0.0, stereo=None):
    """Mix a mono (or (l, r) tuple) signal in at time t."""
    i = idx(t)
    if i >= N:
        return
    if stereo is None:
        sl = sig * gain * np.sqrt(0.5 * (1 - pan))
        sr = sig * gain * np.sqrt(0.5 * (1 + pan))
    else:
        sl, sr = stereo[0] * gain, stereo[1] * gain
    n = min(len(sl), N - i)
    if i < 0:
        sl, sr, n, i = sl[-i:], sr[-i:], min(len(sl) + i, N), 0
    L[i:i + n] += sl[:n]
    R[i:i + n] += sr[:n]
    if send:
        SEND_L[i:i + n] += sl[:n] * send
        SEND_R[i:i + n] += sr[:n] * send


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos"), x)


def sweep_lp(x, f0, f1, block=512, curve=2.0):
    """Time-varying 2-pole low-pass from f0 to f1 (exponential)."""
    out = np.zeros_like(x)
    zi = np.zeros(2)
    nb = max(1, len(x) // block + 1)
    for b in range(nb):
        s = x[b * block:(b + 1) * block]
        if not len(s):
            break
        p = (b / max(nb - 1, 1)) ** curve
        fc = f0 * (f1 / f0) ** p
        bb, aa = butter(2, min(fc, SR * 0.45), "low", fs=SR)
        o, zi = lfilter(bb, aa, s, zi=zi)
        out[b * block:b * block + len(s)] = o
    return out


def saw(f, t, phase=None):
    ph = rng.random() if phase is None else phase
    return 2.0 * np.mod(f * t + ph, 1.0) - 1.0


def env_adsr(n, a, d, s, r_, total):
    t = np.arange(n) / SR
    e = np.ones(n) * s
    e = np.where(t < a, t / max(a, 1e-4), e)
    dd = (t >= a) & (t < a + d)
    e[dd] = 1 - (1 - s) * (t[dd] - a) / max(d, 1e-4)
    rel = t > total - r_
    e[rel] *= np.clip((total - t[rel]) / max(r_, 1e-4), 0, 1)
    return e


# ---------------------------------------------------------------- instruments
def pad(notes, dur, f0=300, f1=2400, a=0.6, r_=0.8, detune=0.09):
    t = tt(dur)
    l = np.zeros(len(t))
    r = np.zeros(len(t))
    for m in notes:
        for k, cents in enumerate((-detune * 100, 0, detune * 100)):
            f = midi(m) * 2 ** (cents / 1200)
            s = saw(f, t)
            if k == 0:
                l += s
            elif k == 2:
                r += s
            else:
                l += 0.6 * s
                r += 0.6 * s
    e = env_adsr(len(t), a, 0.5, 0.85, r_, dur)
    l = sweep_lp(l * e, f0, f1)
    r = sweep_lp(r * e, f0, f1)
    g = 0.05 / max(1, len(notes)) ** 0.5
    return l * g, r * g


def kick(big=False):
    d = 1.1 if big else 0.42
    t = tt(d)
    f = 42 + (150 if big else 120) * np.exp(-t / (0.05 if big else 0.032))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / (0.45 if big else 0.16))
    click = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.004) * 0.25
    return np.tanh((body + click) * (2.4 if big else 1.8)) * (0.95 if big else 0.8)


def clap():
    t = tt(0.4)
    n = bp(rng.standard_normal(len(t)), 900, 3200)
    e = np.zeros(len(t))
    for o in (0, 0.011, 0.022):
        e += np.where(t >= o, np.exp(-(t - o) / (0.009 if o < 0.02 else 0.13)), 0)
    return n * e * 0.55


def hat(open_=False):
    t = tt(0.35 if open_ else 0.06)
    n = hp(rng.standard_normal(len(t)), 8000, 4)
    return n * np.exp(-t / (0.11 if open_ else 0.018)) * (0.22 if open_ else 0.16)


def crash(d=2.4, g=0.32):
    t = tt(d)
    n = hp(rng.standard_normal(len(t)), 4500, 2)
    return n * np.exp(-t / (d / 3.2)) * g


def reverse_swell(d=0.5):
    return crash(d * 2.2, 0.28)[: idx(d)][::-1] * np.linspace(0, 1, idx(d)) ** 1.5


def sub(f, d, g=0.5):
    t = tt(d)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    e = np.minimum(1, t / 0.005) * np.exp(-t / (d * 0.7))
    return np.tanh(s * 1.6) * e * g


def braam(root, d=2.6):
    t = tt(d)
    s = np.zeros(len(t))
    for m in (root - 12, root, root + 7, root + 12):
        for c in (-11, 0, 9):
            s += saw(midi(m) * 2 ** (c / 1200), t)
    e = np.minimum(1, t / 0.01) * np.exp(-t / 1.2)
    s = sweep_lp(s * e, 2600, 160, curve=0.6)
    return np.tanh(s * 0.25) * 0.55


def stab(notes, d=0.5):
    t = tt(d)
    s = np.zeros(len(t))
    for m in notes:
        for c in (-8, 8):
            s += saw(midi(m) * 2 ** (c / 1200), t)
    e = np.minimum(1, t / 0.003) * np.exp(-t / 0.16)
    return lp(s * e, 3200) * 0.09


def pluck(m, d=0.22, bright=2600):
    t = tt(d)
    s = saw(midi(m), t) + 0.5 * saw(midi(m) * 1.003, t)
    return sweep_lp(s * np.exp(-t / 0.075), bright, 400, block=128) * 0.11


def tick():
    t = tt(0.05)
    n = bp(rng.standard_normal(len(t)), 1800, 6000) * np.exp(-t / 0.004)
    thump = np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.01) * 0.3
    return (n + thump) * (0.16 + 0.06 * rng.random())


def bell(m, d=4.0, g=0.07):
    t = tt(d)
    f = midi(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.4)
    return s * np.exp(-t / 1.4) * np.minimum(1, t / 0.004) * g


def riser(d):
    t = tt(d)
    n = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    blk = 256
    for b in range(0, len(t), blk):
        p = b / len(t)
        c = 300 * (20 ** p)
        out[b:b + blk] = bp(n[b:b + blk], c * 0.7, c * 1.4, 1)
    glide = np.sin(2 * np.pi * np.cumsum(110 * 4 ** (t / d)) / SR) * 0.15
    return (out * 1.6 + glide) * (t / d) ** 2 * 0.35


# ------------------------------------------------------------------- chords
CH = {
    "Dm": [38, 45, 53, 57, 60, 64],
    "Bb": [34, 46, 50, 53, 57, 62],
    "F": [41, 48, 53, 57, 60, 64],
    "C": [36, 48, 52, 55, 59, 62],
    "Gm": [43, 50, 55, 58, 62, 65],
    "A": [45, 52, 57, 61, 64, 69],
    "D": [38, 45, 54, 57, 62, 64],
}
CARD_CHORDS = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm"]

# ---------------------------------------------------------------------- HOOK
hk = TL["hook"]
pl, pr = pad([26, 38, 45, 53, 57, 64], hk["end"] + 0.3, f0=180, f1=1400, a=1.4, r_=0.15)
add(None, 0, stereo=(pl * 1.2, pr * 1.2), send=0.5)
drone = sub(midi(26), hk["end"], 0.22) * np.minimum(1, tt(hk["end"]) / 1.5)
add(drone, 0)
for line in hk["lines"]:
    for i, ch in enumerate(line["text"]):
        if ch != " ":
            add(tick(), line["at"] + i * hk["charDur"], pan=rng.uniform(-0.3, 0.3), send=0.25)
add(bell(74, 3, 0.04), hk["lines"][1]["at"], pan=-0.3, send=0.8)
add(bell(69, 3, 0.04), hk["lines"][2]["at"], pan=0.3, send=0.8)
add(riser(2.25), hk["end"] - 0.15 - 2.25, send=0.4)
add(reverse_swell(0.6), hk["end"] - 0.6, gain=0.9)
# gate: a breath of silence right before the drop
g0, g1 = idx(hk["end"] - 0.12), idx(hk["end"])
L[g0:g1] *= np.linspace(1, 0, g1 - g0) ** 3
R[g0:g1] *= np.linspace(1, 0, g1 - g0) ** 3

# --------------------------------------------------------------------- DROP
sl = TL["slams"]
ds = sl["start"]
step = (sl["end"] - sl["start"]) / len(sl["words"])
add(braam(26), ds, send=0.35)
add(sub(midi(26), 2.0, 0.65), ds)
add(crash(3.2, 0.38), ds, send=0.5)
for k, chord in enumerate(["Dm", "Bb", "F", "C"]):
    t0 = ds + k * step
    add(kick(big=True), t0)
    DUCK_TIMES.append(t0)
    add(clap(), t0, send=0.35, gain=1.2)
    add(None, t0, stereo=(stab(CH[chord][1:]), stab(CH[chord][1:])), send=0.45, gain=1.3)
    add(sub(midi(CH[chord][0] - 12 if CH[chord][0] > 40 else CH[chord][0]), step, 0.45), t0)
    # 16th hats between slams
    for s in range(1, 8):
        add(hat(), t0 + s * step / 8, pan=0.35 if s % 2 else -0.35, gain=0.6 + 0.4 * (s % 2 == 0))
add(reverse_swell(0.5), sl["end"] - 0.5)

# -------------------------------------------------------------------- CARDS
cards = TL["cards"]
for ci, c in enumerate(cards):
    s0, s1 = c["start"], c["end"]
    chord = CH[CARD_CHORDS[ci % len(CARD_CHORDS)]]
    last = ci == len(cards) - 1
    groove_end = s1 - (0.25 if last else 0.0)
    # section hit
    add(kick(big=True), s0, gain=0.9)
    add(crash(1.6, 0.22), s0, send=0.4)
    add(sub(midi(chord[0] if chord[0] < 40 else chord[0] - 12), 0.9, 0.5), s0)
    # pad
    pl, pr = pad(chord[1:], s1 - s0 + 0.4, f0=900, f1=2600 if not last else 5200, a=0.02, r_=0.4)
    add(None, s0, stereo=(pl, pr), send=0.35)
    # groove, bar restarts at the cut
    b = 0
    while s0 + b * BEAT < groove_end - 0.01:
        t0 = s0 + b * BEAT
        if b > 0:
            add(kick(), t0)
        DUCK_TIMES.append(t0)
        if b % 2 == 1:
            add(clap(), t0, send=0.3)
        for q in range(4):
            tq = t0 + q * BEAT / 4
            if tq >= groove_end:
                break
            if q == 2:
                add(hat(True), tq, pan=0.2, send=0.1)
            else:
                add(hat(), tq, pan=-0.3 if q % 2 else 0.3, gain=0.7 + 0.3 * (q == 0))
            # arp
            arp = chord[2:] + [chord[3] + 12]
            note = arp[(b * 4 + q) % len(arp)] + 12
            add(pluck(note), tq, pan=-0.4 if q % 2 else 0.4, send=0.35, gain=0.8 + 0.4 * last)
        # bass 8ths
        bass_root = chord[0] if chord[0] < 40 else chord[0] - 12
        for e8 in range(2):
            te = t0 + e8 * BEAT / 2
            if te < groove_end:
                add(sub(midi(bass_root + (12 if e8 else 0)), BEAT / 2 * 0.95, 0.32), te)
        b += 1
    if not last:
        add(reverse_swell(0.45), s1 - 0.45, gain=0.8)
    else:
        add(riser(1.6), s1 - 1.65, send=0.4, gain=1.2)
        add(reverse_swell(0.7), s1 - 0.7, gain=1.0)

# -------------------------------------------------------------------- OUTRO
ot = TL["outro"]
o0 = ot["start"]
add(kick(big=True), o0)
DUCK_TIMES.append(o0)
add(braam(26, 3.0), o0, send=0.5, gain=0.9)
add(crash(4.5, 0.36), o0, send=0.6)
add(sub(midi(26), 3.5, 0.6), o0)
pl, pr = pad(CH["D"] + [69, 76], DUR - o0, f0=2400, f1=700, a=0.02, r_=1.6)
add(None, o0, stereo=(pl * 1.4, pr * 1.4), send=0.6)
for k, m in enumerate([74, 78, 81, 86]):
    add(bell(m, 4.5, 0.05), o0 + 0.9 + k * BEAT / 2, pan=(-0.5, 0.5, -0.2, 0.2)[k], send=0.9)
add(kick(), o0 + 1.6, gain=0.5)  # wordmark landing
add(bell(86, 3.5, 0.06), o0 + 2.6, send=0.9)  # url / cta

# ---------------------------------------------------------- sidechain ducking
t_all = np.arange(N) / SR
duck = np.ones(N)
for tk in DUCK_TIMES:
    i0 = idx(tk)
    seg = t_all[i0:i0 + idx(0.3)] - tk
    duck[i0:i0 + len(seg)] = np.minimum(duck[i0:i0 + len(seg)], 1 - 0.45 * np.exp(-seg / 0.09))

# ------------------------------------------------------------------- reverb
def ir(d=2.6, seed=0):
    r = np.random.default_rng(seed)
    t = tt(d)
    x = r.standard_normal(len(t)) * np.exp(-t / (d / 6.5))
    return lp(x, 5500) * 0.11


def conv(x, h):
    n = len(x) + len(h)
    nf = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(h, nf), nf)[: len(x)]


wet_l = conv(SEND_L, ir(seed=1))
wet_r = conv(SEND_R, ir(seed=2))

mix_l = L * duck + wet_l
mix_r = R * duck + wet_r

# fade out tail
f0i = idx(ot["fadeOutFrom"])
fade = np.ones(N)
fade[f0i:] = np.linspace(1, 0, N - f0i) ** 1.6
mix_l *= fade
mix_r *= fade

# master: gentle low-end cleanup + soft clip
mix_l = hp(mix_l, 28)
mix_r = hp(mix_r, 28)
peak = max(np.abs(mix_l).max(), np.abs(mix_r).max())
mix_l = np.tanh(mix_l / peak * 1.6) / np.tanh(1.6)
mix_r = np.tanh(mix_r / peak * 1.6) / np.tanh(1.6)
out = np.stack([mix_l, mix_r], 1) * 0.89
os.makedirs(os.path.join(ROOT, "public"), exist_ok=True)
wavfile.write(os.path.join(ROOT, "public", "music.wav"), SR, (out * 32767).astype(np.int16))
print("wrote public/music.wav", f"{DUR}s")
