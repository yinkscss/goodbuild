# GoodBuildit launch video v2: infinite zoom

44 s, 1080×1920, 30 fps, H.264 + AAC. One continuous camera move: each scene ends by diving into a detail (its `portal`) and the next scene is waiting inside it. Built with Remotion; the music is synthesised in Python.

```
npm install
pip install numpy scipy pillow
npm run build        # music + render -> out/goodbuildit-platform-launch.mp4
npm run studio       # live preview
```

- **Copy and timings:** `src/timeline.json`. Each scene has `start`/`end` (seconds), its copy, and a `portal` (`circle` {cx, cy, r} or `rect` {x, y, w, h, radius}) in 1080×1920 coordinates. Scenes place their portal element from that spec, so move both together. `zoom` is the dive length.
- **Camera:** `src/Video.tsx`. A dive is an exact zoom about a fixed point that maps the portal onto the screen, so the last zoom frame equals the next scene's first frame.
- **Scenes:** `src/scenes/` (prompt, build, minipay, gd, backend, wallet, outro). Visual: `src/visuals/Racer.tsx` (canvas racer).
- **Music:** `scripts/make_music.py` (arrangement) + `scripts/synth.py` (voices). 120 bpm, F major, whoosh into every dive, drops at 6 s, at the backend's "live" swap and at the wallet scene.
- **Stills:** `node scripts/render.mjs --stills 5.9,6,24` then `python3 scripts/sheet.py out/still-*.png`.
