# Live check

Builds real apps with real keys, then opens each one in a browser, plays it and records a video. Run it before merging, so a break shows here and not in production.

```bash
node node_modules/playwright-core/cli.js install chromium-headless-shell   # once
node scripts/live-check.mjs                     # asks (hidden) for ANTHROPIC_API_KEY and DEEPSEEK_API_KEY if not saved
node scripts/live-check.mjs --only game-runner,minipay-shop
node scripts/live-check.mjs --each 2 --headed
```

It builds the app, starts its own throwaway server on port 3100 (run check and type check on) and stops it at the end. Results are in `docs/evals/live/runs/<time>/` (git-ignored): `report.md`, `results.json`, a `.webm` video and screenshots per app.

Scenarios: `scenarios.json` (games, MiniPay apps, dashboards, a DAO, a vault, 3D, an upload, multiplayer, app data, an edit, a refusal). `--demo` tests the runner with the scripted demo model (free; the demo always builds the same app, so its failures mean nothing).

A scenario fails if the build doesn't end ready, the app shows the starter page, is blank, throws, or (MiniPay) asks to connect or sign a message, or pays with a non-legacy transaction. MiniPay is a stand-in wallet answering like MiniPay; it does not replace trying the app in the real MiniPay app (Developer Mode).
