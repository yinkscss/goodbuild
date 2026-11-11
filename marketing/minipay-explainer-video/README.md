# GoodBuildit: "How to put your game on MiniPay" (explainer with voiceover)

~86 s, 1080×1920, 30 fps, H.264 + AAC. A narrated walkthrough of the three steps (deploy a contract, publish, open it in MiniPay), with the real GoodBuild screens recreated and every action timed to the voice.

```
npm install
pip install numpy scipy pillow soundfile kokoro-onnx
# voice model files (Apache-2.0): https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
#   kokoro-v1.0.onnx + voices-v1.0.bin  -> any folder, then:
export KOKORO_DIR=/path/to/that/folder
npm run build        # voice -> music+mix -> render  =>  out/goodbuildit-minipay-explainer.mp4
npm run studio       # live preview
```

## How it stays editable

- **The script is the timeline.** Edit `src/script.json` (the words, the voice, pacing). `scripts/make_voice.py` speaks every line locally with Kokoro (nothing is uploaded) and writes `src/cues.json`: the start/end of every line and an estimate for every word. Scenes read those cues (`wt("d4", /^Sign$/)` = "when the word Sign is spoken"), so buttons, ticks, toggles and captions re-time themselves. If you rewrite a line and a cue word is missing, the build fails loudly instead of desyncing.
- **Change the voice:** `voice` in `script.json` (`af_heart`, `af_bella`, `am_michael`, `bf_emma`, ...) and `speed`.
- **Music:** `scripts/make_music.py` (synthesised from the same cues, ducked under the voice, loudness-normalised to −15 LUFS). Voices in `scripts/synth.py`.
- **Scenes:** `src/scenes/` (hook, what, deploy, publish, minipay, list, outro). UI text such as the slug and contract name lives in `script.json` → `ui`.
- **Stills:** `node scripts/render.mjs --stills 20,44,60` then `python3 scripts/sheet.py out/still-*.png` (draws the safe area).

## What is real and what isn't

The steps, labels and rules come from the product and the MiniPay kit (PR #71, D74) and from the MiniPay posts in `src/content/blog/minipay.ts`. The deploy and publish screens are recreations of the real modals. The MiniPay phone screens (Settings, Developer Settings, Load Test Page) are illustrations written from MiniPay's developer docs as summarised there; menu labels can differ between MiniPay versions. Numbers on screen (fee, balance, version) are examples. Not yet checked in the real MiniPay app (D74 lists this as unverified).
