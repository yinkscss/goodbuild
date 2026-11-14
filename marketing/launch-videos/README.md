# GoodBuild mainnet launch videos

Three films for GoodBuild going live on Celo mainnet. All are plain HTML pages whose every frame is a function of time (`seek(t)`), rendered with Playwright and ffmpeg. No CSS transitions, timers or carried state.

| Folder | Film | Size | Length |
|---|---|---|---|
| [`ui-morph-loop/`](ui-morph-loop) | UI morph loop (one shape, 12 UI states, loops) | 1440x1440 | 14 s |
| [`landing-flyover/`](landing-flyover) | 3D fly-over of the live landing page | 1440x1152 | 14.5 s |
| [`web3-showreel/`](web3-showreel) | "Vibe code any Web3 app" showreel for X | 1920x1080 (+1080x1080 crop) | 15 s |

Shared code is in [`_shared/`](_shared): `launch.cjs` (finds Playwright + Chromium), `render-dom.cjs` (DOM pages, parallel workers, subframes), `render-gl.cjs` (WebGL page, served over local http), `encode.sh` (tmix blend, BT.709, mux), and the Geist and Instrument Serif fonts (SIL OFL, licences included).

## Requirements
- Node 20+ with `playwright` (set `PW_DIR` to a `node_modules` that has it, or install it in the repo root) and a Chromium build Playwright can launch (`CHROME=/path/to/chrome` to override the lookup).
- `ffmpeg` with `tmix` (any full build). Python 3 is only used by the helper snippets in the READMEs.
- WebGL2 with `EXT_color_buffer_float` (the fly-over). Rendered here on Metal (Intel UHD 630).

## Copy and claims
- No em dashes in any on-screen copy.
- Only product facts the repo supports: credits are bought with G$ in one signature from $0.25 (`src/components/credits/add-credits.tsx`, D56/D61), $1 of credit is $1 of AI builds, test on Celo Sepolia first, deploy is signed in the user's wallet, apps can save data (Backend window). "Test on testnet first" is used without any time claim.
- Any number in a chart or counter ("14 saved", "128 entries") is sample data for the picture, not a product statistic.
- UI shown follows `docs/DESIGN_SYSTEM.md` colours, radii and component shapes (violet `#592E81`, pink pop, 24/16/pill radii). Type in the films is Geist (and Instrument Serif for the fly-over's closing tail) as the brief asks, which is not the app's own Inter/Unbounded.
- The live landing page still said "add credits with CELO". The purchase is G$, so the fly-over capture rewrites that one string to "G$" in memory (it never touches the site). Remove the line in `landing-flyover/capture.cjs` to capture the page verbatim.

## Voice-over (added on request)
The UI morph loop and the Web3 showreel (both sizes) have `*-vo.mp4` versions with a voice-over. The 3D fly-over has none, by request. The voice is macOS `say` (Samantha), which is a plain system voice: swap it for a recorded or studio voice before a paid launch push.
