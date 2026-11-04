# Handoff: Stage 1 build status

Written 4 Nov 2026 at the end of the first build session (claude.ai), for whoever continues in Claude Code. Read CLAUDE.md and docs/BUILD_PROMPT_STAGE1.md first; this file only covers where things stand.

## Done (all on `main`)
| Milestone | Commit | Notes |
|---|---|---|
| M1 Scaffold + landing | 37a5941 … 7e85449 | Tailwind v4 tokens (P6), self-hosted fonts (P7), hero uses `hero-b.jpg` with float/glow/tilt |
| M2 Privy auth + gating | f1122d8 | Own SIWE session (P9), Drizzle + PGlite dev DB (P8), geo-block 451 |
| M3 Logged-in home | 37f17b1, 36307f4 | Contract-type tiles on cards; credits pill says "Testnet beta · free" until M6 |
| M4 Workspace + agent | 1d8d9bc | LiteLLM (D14, D16), runner/checks/auto-fix/checkpoints, Sandpack (P12) |
| Pre-M5 fixes | 6efeeb9 | G$ = ERC-20 guardrails (D15), custom errors only, deduped summary, auto-fix step rows |

The user approved M1–M4 and the pre-M5 fixes.

## Next: M5 (compile + wallet-signed deploy)
The user is doing **one real build with their own keys first**; start M5 after they report back.

Agreed requirements:
- Deploy modal (DESIGN_SYSTEM §4): summary, then the Sign → Broadcast → Verified stepper; the user signs on Celo Sepolia from their own wallet.
- **Pre-deploy simulation must fail loudly** if Celo rejects the bytecode (for example an unsupported opcode), then offer a rebuild for `evmVersion: paris`, which needs a pinned older OpenZeppelin release (D17).
- Verification: **Sourcify first**, Celoscan later (D17).
- After deploy: write addresses into the platform-owned `src/contracts/<Name>.ts`, record the deployment row, and show the success state.

Open blocker, needs the user's answer (Q39): **there is no G$ on Celo Sepolia.** The proposal is that M5 deploys one test G$ (an ERC-20 with ERC-677 `transferAndCall` and a rate-limited faucet) and prefills it for testnet deploys.

Then M6 (credits, D13: USD primary, cost + 25%; usage is already recorded in `usage_events`).

## Open questions worth reading
Q36 (preview depends on CodeSandbox and the Tailwind CDN), Q37 (chat width), Q38 (read-only code tab) and Q39 in OPEN_QUESTIONS.md.

## Working conventions used so far
- Post a short plan before each milestone; commit after each; stop when the user asks for a review.
- `pnpm check` (lint, typecheck, tests, build) must pass before every commit.
- The user's preference: **never use em dashes** in any writing (docs, UI copy, commit messages).
- Commit trailers used so far: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Testing without real accounts
- `GOODBUILD_DEMO_MODEL=1` replays a scripted G$ tip-jar build (development only).
- `node scripts/demo-session.mjs [--seed]` signs in a throwaway wallet against a running server and prints the session cookie, so you can test without Privy.
- `pnpm smoke:auth` runs 14 end-to-end sign-in checks against a running server (`BASE_URL`).
- Production-mode local runs need `SESSION_SECRET`, `APP_DOMAIN` and `ALLOW_PGLITE=true` (or a `DATABASE_URL`).

## Gotchas found the hard way
- Next 16: GET route handlers are prerendered unless they call `await connection()` (outside `try`). The SIWE nonce route relies on this.
- PGlite and solc must stay in `serverExternalPackages` (next.config.ts); bundling PGlite breaks restarts on an existing `.data/` database.
- Sandpack injects unlayered CSS that beats Tailwind's layered utilities, so its layout overrides live in plain CSS in `globals.css` (`.gb-sp-section`, `.gb-sandpack`).
- The `@tailwindcss/browser` CDN and CodeSandbox's bundler are unreachable from sandboxed environments, so the live preview can only be checked in a normal browser.
