# GoodBuildit games launch video

43 s, 1080×1920, 30 fps, H.264 + AAC. Built with Remotion; the music is synthesised in Python.

```
npm install
pip install numpy scipy pillow
npm run build        # music + render -> out/goodbuildit-games-launch.mp4
npm run studio       # live preview / scrub in the browser
```

## Editing

- **Copy and timings:** `src/timeline.json` (seconds). Change a line, a card's `start`/`end`, a chip, the URL, then `npm run build`. The music reads the same file, so hits move with the cuts.
- **Card look:** each card has a `theme` (`ink`, `purple`, `cream`, `pink`, `lilac`, see `src/theme.ts`) and a `visual` (`arcade`, `tiles3d`, `phone`, `wallets`, `contract`, `url`, `chain`, see `src/visuals/`).
- **Music:** `scripts/make_music.py`: key, chords per card (`CARD_CHORDS`), tempo (`beat` in the timeline), the drop at `slams.start`.
- **Safe area:** 8% sides, 12% top and bottom (`SAFE` in `src/theme.ts`). Headlines are auto-fitted to it.
- **Stills for checking:** `node scripts/render.mjs --stills 7.1,12,40` then `python3 scripts/sheet.py out/still-*.png` (draws the safe area).

The renderer uses the Chromium in `/opt/pw-browsers` if present (set `CHROME_PATH` to override), with software GL (`swangle`) for the three.js scene. A full render takes about 8 minutes on 4 cores.
