# 3D landing-page fly-over

1440x1152, 14.5 s, 60 fps, H.264 + synthesised score. Output: `out/landing-flyover-1440x1152.mp4`. One continuous WebGL2 camera over https://goodbuildit.xyz laid flat on a studio floor, never a cut.

## Pipeline
1. `capture.cjs`: Playwright, 1440 wide, device scale 2, scrolls the whole page once, marks the liftable pieces with `data-layer`, screenshots the page with them hidden (`capture/base.png`) and each piece alone, transparent, 28 px padding (`capture/layers/*.png`), positions in `capture/layers.json`. 45 pieces: hero cards, prompt box, example chips, badge chip, Build it button, how-it-works cards, 11 template cards with their photos, safety/pricing cards, FAQ, CTA. The capture is committed so the film re-renders without the network.
2. `film.html`: WebGL2, every frame from `seek(t)`. Page is a mipmapped, 16x anisotropic textured quad; each piece its own quad at its own height with its own shadow (same picture in `#1a2133`, offset (0.10z, 4+0.36z), blur 7+0.5z, 26 percent). Depth of field per pixel (75 x (focus-depth)/depth in front, 6 x (depth-focus)/depth behind, cap 120 px, 40 golden-angle taps from matched mip levels). 16 subframes across 0.7 of a frame accumulated in a float target (40 subframes during the rise and dive, where the speed is highest). Four logo tiles (quadrants of the logo mark) lift beside the Build it button and stay to the end card.
3. `render-gl.cjs` renders the frames over a local http server (textures would be tainted from `file://`), `encode.sh`-style ffmpeg muxes `audio.wav` (`make-audio.cjs`: pad, whooshes at 8.66 s and 9.80 s, hit at 9.97 s).

![Stills at 0, 1.6, 2.5, 5, 6.5, 9.3 and 11 s](stills.jpg)

## Timeline (as implemented)
| Time | |
|---|---|
| 0 to 8.2 s | flight, camera 56 degrees off straight-down, 1360 px from the look-at point easing to 1700 px (never back in), focal 1880 px, speed curve as a share of 770 px/s: 0 at 0 s, 0.5 by 0.6 s, held to 1.25 s, 1.0 by 1.6 s, held 0.90 to 1.06 to 7.3 s, 0.12 by 8.3 s |
| 7.75 to 9.25 s | rise: log-scale zoom with a trapezoid speed profile; the page bottom edge settles 42 px above the frame bottom |
| 9.25 to 9.47 s | overhead, whole page as one strip |
| 9.47 to 9.97 s | dive: quadratic ease in-out, rounded-rect mask morphs from the page to the hero (corner radius 24 page px to 38 px on screen); the hero (first fold) lands as a 1018 px card at y 283 |
| 10.02 s / 10.12 s | badge pill (logo + GoodBuild); "Live on mainnet." one word per 0.06 s, then the italic tail "Pay as you build." one word per 0.05 s (Instrument Serif, `#8b8b92`), each rising 16 px out of a 12 px blur |
| 10.6 to 14.5 s | hold |

## Assumptions and deviations
- Closing line: **"Live on mainnet." + "Pay as you build."** (the brief's example). The title is a DOM overlay, so words are not motion-blurred beyond the page.
- The "hero" the dive lands on is the whole first fold (three cards plus the prompt box, 1296x765), so the Build it button and the logo tiles are inside the end card. The hero card alone would have left both outside the frame.
- The speed hold is 0.90 to 1.06 of cruise, a little under the requested 0.94 to 1.1. Page position is integrated from the curve exactly as asked.
- The page has no testimonial, so the standing-up pieces are the example chips, the badge chip, the Build it button and the template photos.
- Checks: no optical-flow tool was available (no OpenCV). The glide and zoom are checked analytically from the camera function (`pf(t)`, `cam(t)` in `film.html`): speed never reaches zero before 8.3 s and the camera distance is non-decreasing.
- The one-string copy fix (CELO to G$) is described in the top-level README.
- A first render hit a lost WebGL context in the 40-subframe stretch (frames after 7.9 s came out blank). Fixed with `gl.finish()` per subframe and automatic reload in `render-gl.cjs`.

## Re-render
```bash
node capture.cjs capture                       # optional, needs network (URL=... to point at a local dev server)
node ../_shared/render-gl.cjs --page landing-flyover/film.html --w 1440 --h 1152 --dur 14.5 --fps 60 --out ../.work/v2/frames --part 0/2 &
node ../_shared/render-gl.cjs --page landing-flyover/film.html --w 1440 --h 1152 --dur 14.5 --fps 60 --out ../.work/v2/frames --part 1/2
# run from marketing/launch-videos; about 40 minutes on an Intel UHD 630
ffmpeg -framerate 60 -i .work/v2/frames/f%05d.png -i landing-flyover/audio.wav -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -crf 14 -preset slow -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a aac -shortest landing-flyover/out/landing-flyover-1440x1152.mp4
```
Stills: `node _shared/render-gl.cjs --page landing-flyover/film.html --w 1440 --h 1152 --out .work/v2/stills --sub 4 --at 0,1.6,2.5,5,6.5,9.3,11`.
