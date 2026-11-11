"""Shared synth voices (numpy). The mix buffers are created by init()."""
import numpy as np
from scipy.signal import butter, lfilter, sosfilt

SR = 48000
rng = np.random.default_rng(7)

N = 0
L = R = SEND_L = SEND_R = None
DUCK_TIMES = []


def init(duration):
    global N, L, R, SEND_L, SEND_R
    N = int(SR * duration)
    L, R, SEND_L, SEND_R = (np.zeros(N) for _ in range(4))


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


