"""Narration -> public/voice.wav + src/cues.json  (text-to-speech runs locally, nothing is uploaded).

Voice: Kokoro-82M (Apache-2.0) through kokoro-onnx.
  pip install kokoro-onnx soundfile numpy scipy
  KOKORO_DIR=/path/with/{kokoro-v1.0.onnx,voices-v1.0.bin}  python3 scripts/make_voice.py
Model files: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

cues.json holds, for every line, its start/end (seconds, frame-aligned) and an estimated start/end per word.
The scenes read these, so changing the script re-times the whole video.
"""
import json, os, re
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
S = json.load(open(os.path.join(ROOT, "src", "script.json")))
FPS = 30
KD = os.environ.get("KOKORO_DIR", os.path.join(ROOT, "models"))
k = Kokoro(os.path.join(KD, "kokoro-v1.0.onnx"), os.path.join(KD, "voices-v1.0.bin"))
SR = 24000
q = lambda t: round(t * FPS) / FPS  # frame-align


def trim(x, thr=0.012):
    a = np.abs(x)
    idx = np.where(a > thr)[0]
    return x[idx[0]:idx[-1] + 1] if len(idx) else x


def words_of(text, t0, t1):
    toks = text.split()
    wts = []
    for w in toks:
        core = re.sub(r"[^A-Za-z0-9']", "", w)
        wt = max(2.0, len(core) + 0.6)
        if w.endswith((".", "?", "!", ":")): wt += 4.5
        elif w.endswith(","): wt += 2.5
        wts.append(wt)
    tot = sum(wts)
    out, t = [], t0
    for w, wt in zip(toks, wts):
        d = (t1 - t0) * wt / tot
        out.append({"w": w, "start": round(t, 3), "end": round(t + d, 3)})
        t += d
    return out


pieces, cues, scenes = [], {"lines": {}, "scenes": {}}, []
cursor = S["leadIn"]
pieces.append(np.zeros(int(cursor * SR), dtype=np.float32))
for si, sc in enumerate(S["scenes"]):
    s_start = None
    for li, ln in enumerate(sc["lines"]):
        wav, _ = k.create(ln["text"], voice=S["voice"], speed=S["speed"], lang="en-us")
        wav = trim(wav.astype(np.float32))
        wav = np.concatenate([np.zeros(int(0.03 * SR), np.float32), wav, np.zeros(int(0.05 * SR), np.float32)])
        t0 = q(cursor)
        pad = t0 - cursor
        if pad > 0: pieces.append(np.zeros(int(pad * SR), np.float32))
        pieces.append(wav)
        dur = len(wav) / SR
        t1 = t0 + dur
        voice_start, voice_end = t0 + 0.03, t1 - 0.05
        cues["lines"][ln["id"]] = {"scene": sc["id"], "text": ln["text"], "start": round(voice_start, 3), "end": round(voice_end, 3), "words": words_of(ln.get("display", ln["text"]), voice_start, voice_end)}
        if s_start is None: s_start = voice_start
        last = li == len(sc["lines"]) - 1
        gap = S["sceneGap"] if last else S["lineGap"]
        cursor = t1 + gap
        pieces.append(np.zeros(int((cursor - t1) * SR), np.float32))
    scenes.append({"id": sc["id"], "voiceStart": s_start})
total = q(cursor - S["sceneGap"] + S["tail"])
# scene boundaries: each scene starts a hair before its first word, and runs to the next scene's start
for i, sc in enumerate(scenes):
    start = q(max(0.0, sc["voiceStart"] - (0.0 if i == 0 else 0.30)))
    end = q(scenes[i + 1]["voiceStart"] - 0.30) if i + 1 < len(scenes) else total
    cues["scenes"][sc["id"]] = {"start": start if i else 0.0, "end": end}
cues["duration"] = total
voice = np.concatenate(pieces)
voice = np.concatenate([voice, np.zeros(max(0, int(total * SR) - len(voice)), np.float32)])[: int(total * SR)]
os.makedirs(os.path.join(ROOT, "public"), exist_ok=True)
sf.write(os.path.join(ROOT, "public", "voice.wav"), voice, SR)
json.dump(cues, open(os.path.join(ROOT, "src", "cues.json"), "w"), indent=1)
print(f"voice {total:.1f}s,", sum(len(s['lines']) for s in S['scenes']), "lines")
for sid, v in cues["scenes"].items(): print(f"  {sid:8s} {v['start']:6.2f} -> {v['end']:6.2f}")
