# UI morph loop

1440x1440, 14 s, 60 fps, 120 BPM, 7 bars (28 beats), seamless loop (frame 0 follows the last frame; cursor included). Output: `out/ui-morph-loop.mp4` (H.264, BT.709 limited range, AAC).

One black/white shape is never cut. Every state is that shape changing width, height, radius and colour (one closed-form spring per target change, summed), content swaps with a short blur, a cursor drives every change, and the camera scale springs so each state fills the frame.

## State list on the beat grid (assumed: 12 states, one accent = GoodBuild violet `#592E81`)
| Beat | Time | State | Driven by |
|---|---|---|---|
| 0 | 0.0 s | **Build it** pill (black, violet arrow disc) | cursor arrives, click on beat 2 |
| 2 | 1.0 s | Loader ring | click |
| 3 | 1.5 s | Check (draws itself) | beat |
| 4 | 2.0 s | Dynamic island "Live on testnet" / "Celo Sepolia", label swaps to "Test it first" on beat 5 | beat |
| 6 | 3.0 s | **Add credits** pill, "from $0.25, one signature" | beat, hover on the plus |
| 8 | 4.0 s | Credit card: amount scrubs $0.25 to $5.00 by dragging the knob (the knob is the cursor), then **Pay with G$** | click on beat 8, drag beats 9 to 10.5, click on beat 11 |
| 11 | 5.5 s | "Confirm in your wallet..." then "Added $5.00" (text swaps inside the container) | click |
| 13 | 6.5 s | Network toggle **Celo Sepolia / Celo**, knob flips on beat 14 | cursor click on the beat |
| 15 | 7.5 s | Tabs Preview / Code / Contract, indicator edges on two different springs | click on beat 16 |
| 17 | 8.5 s | Backend card "Your app saves data": line draws itself, tooltip | hover |
| 20 | 10.0 s | Command palette, types "Deploy", Enter | keys |
| 22 | 11.0 s | Toast "Live on Celo mainnet", "Signed in your wallet", then "GoodBuild never holds your keys" | Enter |
| 25 | 12.5 s | back to **Build it** (loop) | cursor returns |

Strings come from the app: `Build it`, `Add credits`, `Pay with G$`, `Confirm in your wallet…`, `Celo Sepolia`/`Celo`, `Backend`, `Your app saves data`, `Live on Celo`. The chart value ("14 saved") is sample data.

## Song and sounds (assumed)
No song was supplied, so the track is synthesised (`make-audio.cjs`, plain JS, no samples): 120 BPM kick, off-beat hat, bass and arpeggio. `make-audio.cjs` measures the bed's onsets with an energy-flux detector (28 onsets, median interval 0.500 s = 120.0 BPM, first peak at 0.010 s; `beatgrid.json`), and places the UI sounds (clicks, morph blips, drag ticks, "live" chime) on the nearest measured peak. numpy was not available, so the analysis is in Node. Swap in another ~120 BPM track by replacing `audio.wav` (start on a downbeat).

## Re-render
```bash
node ../_shared/render-dom.cjs --page index.html --w 1440 --h 1440 --dur 14 --fps 60 --sub 4 --shutter 0.5 --workers 3 --out ../.work/v1/frames
../_shared/encode.sh ../.work/v1/frames 4 out/ui-morph-loop.mp4 audio.wav
node make-audio.cjs   # regenerates audio.wav and beatgrid.json
```
Stills: `node ../_shared/render-dom.cjs --page index.html --w 1440 --h 1440 --dur 14 --out ../.work/v1/stills --at 0,0.9,1.9`.
Four subframes over half a frame are blended with ffmpeg `tmix` (motion blur). Banned list respected: no bounce, particles, glows or gradients on the UI; overshoot is under 2 percent.
