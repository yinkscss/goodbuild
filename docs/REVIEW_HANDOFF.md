# Review handoff: the web-builder roadmap (10 Nov 2026)

For a reviewer (human or another model) to judge the work before anything is merged. Nothing here was merged by the author except what the owner merged themselves. Read this, then the PRs, `docs/DECISIONS.md` (D62–D79) and `docs/evals/live/README.md`.

## Original goal
Review GoodBuild's web-builder agent harness, then build a five-phase roadmap: checks, preview and evals, an app-kind registry, new app kinds (games, dashboards, MiniPay, DAOs and vaults), and 3D with app-data upgrades. Owner decisions in force: D63 (entry-fee games are not gambling), D64 (keep Sandpack and the own build), D65 (Cloudflare R2 for uploads later, server disk meanwhile), D66 (full mainnet for new contract kinds). Users are non-technical. Nothing is merged without the owner.

## Phase 1: the builder checks its own work
| PR | State | What |
|---|---|---|
| [#62](https://github.com/yinkscss/goodbuild/pull/62) | merged | Run check: every build opens in headless Chromium; crashes go to auto-fix (D66) |
| [#64](https://github.com/yinkscss/goodbuild/pull/64) | merged | Type check and a `run_checks` tool, capped at 3 per turn (D68) |

## Phase 2: preview and evals
| PR | State | What |
|---|---|---|
| [#65](https://github.com/yinkscss/goodbuild/pull/65) | merged | Own-build preview beside Sandpack, chosen automatically (D69) |
| [#66](https://github.com/yinkscss/goodbuild/pull/66) | merged | Eval suite in CI: 21 real builds, scored, on demand (D70). Needs `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` repo secrets; no baseline yet |

## Phase 3: app kinds and wider uploads
| PR | State | What |
|---|---|---|
| [#67](https://github.com/yinkscss/goodbuild/pull/67) | merged | Kits: one registry for everything a new app kind needs (D71) |
| [#76](https://github.com/yinkscss/goodbuild/pull/76) | open | Uploads: sounds, fonts, 3D models; per-type limits (image 5 MB, audio 10 MB, font 2 MB, model 15 MB; 25 MB and 20 files per project) (D77) |

## Phase 4: new app kinds
| PR | State | What |
|---|---|---|
| [#68](https://github.com/yinkscss/goodbuild/pull/68) | merged | 2D games, no game engine (D72) |
| [#71](https://github.com/yinkscss/goodbuild/pull/71) | open | MiniPay kit and dollar-coin references in deploys (D73) |
| [#72](https://github.com/yinkscss/goodbuild/pull/72) | open | Dashboards: plain SVG charts and live data (D74) |
| [#74](https://github.com/yinkscss/goodbuild/pull/74) | open | DAOs and vaults: named exploit tests required; a gate blocks Celo mainnet deploys until they pass, error `exploit_tests_failed` (D75) |

## Phase 5: 3D, app data, multiplayer
| PR | State | What |
|---|---|---|
| [#75](https://github.com/yinkscss/goodbuild/pull/75) | open | 3D: plain three.js 0.187.0 with its own-build preview (D76) |
| [#77](https://github.com/yinkscss/goodbuild/pull/77) | open | App data: filtered, ordered, polling lists, and a multiplayer guide; visitor file uploads deliberately not built (D78) |

## Extra
- [#70](https://github.com/yinkscss/goodbuild/pull/70) (merged): fix for apps stuck on the starter page (owner-reported; reviewed, one test fix pushed).
- [#79](https://github.com/yinkscss/goodbuild/pull/79) (open): live-check scripts; logo-only closable bottom-left badge on published apps (D79); ready-made MiniPay info pages (edits the kit from #71); builder limits raised to 40 model calls and 20 tool rounds per pass (edits the runner).
- Not by the author: #60, #61, #63, #69, #73, #78.

**Stack and merge order:** #71 (base `main`), #72, #74, #75, #76, #77, #79, each based on the one before. Retarget each to `main` as the one below it lands.

## What was tested
- Every PR: unit tests, typecheck, lint. The first six stacked PRs: full vitest run and `pnpm build` too.
- Live runs with real models (mostly DeepSeek; OpenRouter for the first run, partly blocked by credit): about 13 of 15 scenarios passed, with video. Files are in `docs/evals/live/runs/` (git-ignored, on the author's machine only).
- Passed: runner game, puzzle game, bakery shop, bill splitter, two dashboards, DAO, vault, two 3D apps (one with an uploaded sound), multiplayer tic-tac-toe, guestbook, game edit, plus a full website flow (build, change, publish, play) for a mango game.
- Failing: the entry-fee game (game plus prize pot plus MiniPay payments) runs out of builder steps. Splitting it into two builds is untried.

## Please check
1. Exploit gate (#74): it shows attacks are tried and turned away; it is not an audit (guide, FAQ and D75 say so).
2. App-data queries (#77): filters compare only after the server applies its privacy rules, so hidden fields can't be guessed. See `src/server/app-data/query.attack.test.ts`.
3. Casino refusal: the model said it couldn't build a real-money slot machine yet wrote a play-money one with no money code, and the reply was misleading. D72 and D63 are the owner's call.
4. Builder limits (#79): more calls and rounds trade cost for finishing power; the fix budget still bounds cost.
5. MiniPay info pages (#79): Terms and Privacy are plain-words starter text, not legal advice.

## Not verified
Nothing was run with Claude (fix tier was DeepSeek). No MiniPay payment was completed and nothing was tried in the real MiniPay app. No Celo deploy, real phone or production-server test. Cloudflare passing the data route uncached is untested. The eval suite has never run in CI. After deploy: check `?preview=own` and the `type check:` and `run check:` log lines. Visitor file uploads are an open owner question (`docs/OPEN_QUESTIONS.md`).
