# "Vibe code any Web3 app" showreel (for X)

1920x1080 (and a 1080x1080 centre crop), 15 s, 60 fps, 120 BPM, loops (last frame follows into frame 0). Outputs: `out/web3-showreel-1920x1080.mp4`, `out/web3-showreel-1080x1080.mp4`. Geist only; violet, pink, lilac plus black and white. Storyboard: [STORYBOARD.md](STORYBOARD.md).

**Concept:** "One dot, zoomed through": the full stop of "Vibe code any Web3 app." grows to fill the frame, becomes the next scene's colour and the next shape, and is the full stop again at the end. One camera language only (zoom-through, plus a 1.8 percent breathing push).

Readable muted: every beat carries its message in type. Claims used: vibe code any Web3 app, test on testnet first (no duration claimed), the Backend window ("Your app saves data"; the "128 entries" counter and chart are sample data), no subscription, pay as you go, from $0.25 in G$, one signature, live on Celo mainnet.

## Re-render
```bash
node make-audio.cjs                       # Web Audio OfflineAudioContext -> audio.wav (kick on every beat, riser 20 to 24, hit per scene change)
node ../_shared/render-dom.cjs --page index.html --w 1920 --h 1080 --dur 15 --fps 60 --sub 3 --shutter 0.5 --workers 3 --out ../.work/v3/frames
../_shared/encode.sh ../.work/v3/frames 3 out/web3-showreel-1920x1080.mp4 audio.wav
../_shared/encode.sh ../.work/v3/frames 3 out/web3-showreel-1080x1080.mp4 audio.wav "crop=1080:1080:420:0"
../_shared/motion-energy.sh out/web3-showreel-1920x1080.mp4 30     # per-beat motion, to check nothing is dead
```
The square crop is the centre 1080 px; all essential type sits inside it. A 1080x1350 crop is not possible from a 1080 px tall frame.
