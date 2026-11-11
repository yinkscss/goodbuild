"""Synthesise the score for the infinite-zoom launch video -> public/music.wav

120 bpm deep-house pulse in F. Every zoom gets a whoosh that lands on the cut;
drops at the first landing (6 s), when the backend "goes live" and on the wallet scene.
All timings come from src/timeline.json.
"""
import json
import os
import sys

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import synth as S  # noqa: E402
from synth import add, bell, braam, clap, crash, hat, hp, kick, lp, midi, pad, pluck, reverse_swell, riser, stab, sub, sweep_lp, tick, tt  # noqa: E402

TL = json.load(open(os.path.join(ROOT, "src", "timeline.json")))
DUR = TL["duration"]
BEAT = TL["beat"]
ZOOM = TL["zoom"]
S.init(DUR)
SR = S.SR
rng = np.random.default_rng(11)
SC = {s["id"]: s for s in TL["scenes"]}

# one chord per bar (2 s): Fmaj9, Am7, Dm9, Bbmaj9
PROG = [
    (29, [53, 57, 60, 64, 67]),  # F
    (33, [52, 57, 60, 64, 67]),  # Am
    (26, [53, 57, 60, 62, 65]),  # Dm
    (34, [50, 53, 57, 60, 62]),  # Bb
]


def chord_at(t):
    return PROG[int(t // (BEAT * 4)) % len(PROG)]


def whoosh(d):
    """Accelerating air + rising tone for a camera plunge of length d."""
    t = tt(d)
    n = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    blk = 256
    for b in range(0, len(t), blk):
        p = (b / len(t)) ** 2.6
        c = 400 * (25 ** p)
        out[b:b + blk] = S.bp(n[b:b + blk], c * 0.6, c * 1.6, 1)
    tone = np.sin(2 * np.pi * np.cumsum(220 * 6 ** ((t / d) ** 2.6)) / SR) * 0.08
    return (out * 1.4 + tone) * (t / d) ** 2.2 * 0.45


def bass(m, d):
    t = tt(d)
    s = S.saw(midi(m), t) + 0.6 * np.sin(2 * np.pi * midi(m) * t)
    s = lp(s * np.minimum(1, t / 0.004) * np.exp(-t / 0.18), 520)
    return np.tanh(s * 2.2) * 0.32


def groove(t0, t1, kick_on=True, arp=True, stabs=True, lift=1.0):
    t = t0
    b = int(round(t0 / BEAT))
    while t < t1 - 1e-6:
        root, notes = chord_at(t + 1e-3)
        if kick_on:
            add(kick(), t, gain=0.85)
            S.DUCK_TIMES.append(t)
            if b % 2 == 1:
                add(clap(), t, send=0.25, gain=0.9)
            add(bass(root + 12, BEAT / 2), t + BEAT / 2)
        for q in range(4):
            tq = t + q * BEAT / 4
            if q == 2:
                add(hat(True), tq, pan=0.15, gain=0.8 * lift)
            else:
                add(hat(), tq, pan=-0.35 if q % 2 else 0.35, gain=0.55 + 0.25 * (q == 0))
            if arp:
                n = notes[(b * 4 + q * 3) % len(notes)] + 12
                add(pluck(n, 0.2, 3200), tq, pan=-0.5 if q % 2 else 0.5, send=0.4, gain=0.55 * lift)
        if stabs and b % 2 == 0:
            st = stab(notes, 0.4)
            add(None, t + BEAT / 2, stereo=(st, st), send=0.5, gain=0.9 * lift)
        t += BEAT
        b += 1


def chord_pads(t0, t1, f0=600, f1=2400, gain=1.0):
    t = t0
    while t < t1 - 1e-6:
        root, notes = chord_at(t + 1e-3)
        d = min(BEAT * 4, t1 - t)
        pl, pr = pad(notes, d + 0.3, f0=f0, f1=f1, a=0.05, r_=0.3)
        add(None, t, stereo=(pl * gain, pr * gain), send=0.45)
        add(sub(midi(root), d, 0.18), t)
        t += d


def landing(t, big=False):
    add(kick(big=True), t, gain=1.0 if big else 0.85)
    S.DUCK_TIMES.append(t)
    add(crash(3.0 if big else 1.8, 0.34 if big else 0.22), t, send=0.5)
    if big:
        add(braam(29, 2.6), t, send=0.4, gain=0.75)
        add(sub(midi(29), 1.6, 0.6), t)


scenes = TL["scenes"]
ends = [s["end"] for s in scenes[:-1]]

# ---- 0 - 6: the prompt
p = SC["prompt"]
pl, pr = pad([41, 53, 57, 60, 64, 67], p["end"] + 0.2, f0=200, f1=1800, a=1.5, r_=0.1)
add(None, 0, stereo=(pl, pr), send=0.6)
for k in range(int(p["end"] / BEAT)):
    tb = k * BEAT
    n = [65, 69, 72, 76][k % 4] + (12 if k % 8 >= 4 else 0)
    add(pluck(n, 0.35, 1400 + 200 * k), tb, pan=(-0.4, 0.4)[k % 2], send=0.6, gain=0.35 + 0.03 * k)
    if tb >= 2.0:
        add(kick(), tb, gain=0.35 + 0.08 * (tb - 2))
for i, ch in enumerate(p["prompt"]):
    if ch != " ":
        add(tick(), p["typeFrom"] + i * p["charDur"], pan=rng.uniform(-0.3, 0.3), gain=0.8, send=0.2)
add(riser(1.4), p["pressAt"] - 1.1, send=0.3, gain=0.8)
add(pluck(84, 0.5, 5000), p["pressAt"], send=0.8, gain=0.8)  # button press
add(bell(77, 1.5, 0.05), p["pressAt"], send=0.8)

# ---- whooshes into every landing
for e in ends:
    add(whoosh(ZOOM), e - ZOOM, send=0.25, gain=1.0)
    add(reverse_swell(ZOOM), e - ZOOM, gain=0.6)

# ---- 6 - 24: build / minipay / gd
landing(6.0, big=True)
groove(6.0, SC["gd"]["end"] - ZOOM, arp=False)
groove(SC["minipay"]["start"], SC["gd"]["end"] - ZOOM, kick_on=False, stabs=False)  # add sparkle from 12 s
chord_pads(6.0, SC["gd"]["end"], f0=900, f1=2600, gain=0.8)
for s in ("minipay", "gd"):
    landing(SC[s]["start"])
# G$ coin: bright bell motif
g0 = SC["gd"]["start"]
for k, m in enumerate([77, 81, 84, 89]):
    add(bell(m, 2.2, 0.05), g0 + 0.5 + k * BEAT / 2, pan=(-0.4, 0.4, -0.2, 0.2)[k], send=0.8)

# ---- 24 - 31: backend: breakdown, then it goes live
b = SC["backend"]
landing(b["start"])
swap = b["start"] + b["swapAt"]
chord_pads(b["start"], swap, f0=500, f1=3000, gain=1.0)
groove(b["start"], swap, kick_on=False, stabs=False, lift=0.7)
add(riser(1.6), swap - 1.6, send=0.4)
landing(swap, big=True)
groove(swap, b["end"] - ZOOM)
chord_pads(swap, b["end"], f0=1200, f1=2800, gain=0.8)
for k in range(len(b["entries"])):
    add(pluck(96, 0.18, 6000), swap + k * BEAT, send=0.5, gain=0.5)  # each entry lands

# ---- 31 - 37: wallet, the biggest drop
w = SC["wallet"]
landing(w["start"], big=True)
groove(w["start"], w["end"] - ZOOM, lift=1.25)
chord_pads(w["start"], w["end"], f0=1600, f1=4000, gain=1.0)
lead = [72, 76, 79, 81, 79, 76, 77, 72, 74, 77, 81, 84]
for k, m in enumerate(lead):
    add(bell(m, 1.6, 0.045), w["start"] + 0.5 + k * BEAT, pan=0.25 * np.sin(k), send=0.7)

# ---- 37 - 44: outro
o = SC["outro"]
landing(o["start"], big=True)
pl, pr = pad([41, 53, 57, 60, 64, 67, 72], DUR - o["start"], f0=2600, f1=600, a=0.02, r_=1.5)
add(None, o["start"], stereo=(pl * 1.3, pr * 1.3), send=0.7)
add(sub(midi(29), 3.0, 0.5), o["start"])
for k, m in enumerate([77, 81, 84, 88, 89]):
    add(bell(m, 4.0, 0.05), o["start"] + 0.6 + k * BEAT / 2, pan=(-0.5, 0.5, -0.25, 0.25, 0)[k], send=0.9)
add(kick(), o["start"] + 20 / 30, gain=0.5)  # wordmark
add(bell(89, 3.0, 0.05), o["start"] + 52 / 30, send=0.9)  # cta

# ---- mix
N = S.N
t_all = np.arange(N) / SR
duck = np.ones(N)
for tk in S.DUCK_TIMES:
    i0 = S.idx(tk)
    seg = t_all[i0:i0 + S.idx(BEAT)] - tk
    duck[i0:i0 + len(seg)] = np.minimum(duck[i0:i0 + len(seg)], 1 - 0.55 * np.exp(-seg / 0.11))


def ir(d=2.8, seed=0):
    r = np.random.default_rng(seed)
    t = tt(d)
    return lp(r.standard_normal(len(t)) * np.exp(-t / (d / 6.0)), 6000) * 0.1


def conv(x, h):
    n = len(x) + len(h)
    nf = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(h, nf), nf)[: len(x)]


ml = S.L * duck + conv(S.SEND_L, ir(seed=1)) * (0.6 + 0.4 * duck)
mr = S.R * duck + conv(S.SEND_R, ir(seed=2)) * (0.6 + 0.4 * duck)
f0i = S.idx(o["fadeOutFrom"])
fade = np.ones(N)
fade[f0i:] = np.linspace(1, 0, N - f0i) ** 1.5
ml, mr = hp(ml * fade, 28), hp(mr * fade, 28)
pk = max(np.abs(ml).max(), np.abs(mr).max())
ml = np.tanh(ml / pk * 1.7) / np.tanh(1.7)
mr = np.tanh(mr / pk * 1.7) / np.tanh(1.7)
os.makedirs(os.path.join(ROOT, "public"), exist_ok=True)
wavfile.write(os.path.join(ROOT, "public", "music.wav"), SR, (np.stack([ml, mr], 1) * 0.7 * 32767).astype(np.int16))
print("wrote public/music.wav", f"{DUR}s")
