# Handoff: Stage 1 build status

Written 4 Nov 2026 at the end of the first build session (claude.ai), for whoever continues in Claude Code. Read CLAUDE.md and docs/BUILD_PROMPT_STAGE1.md first; this file only covers where things stand.

## Start here (5 Nov 2026)
**Live:** https://goodbuildit.xyz, on one VPS with Cloudflare in front. How it runs, how to reach it and what not to break: [DEPLOY.md](DEPLOY.md). Merging a PR to `main` deploys it, so every merge is a release.

**Working live:** email sign-in (Magic), a real AI build, deploying from an email wallet on Celo Sepolia with a Sourcify match (the fix was Magic's content security policy, see DEPLOY.md; the explicit gas in PR #11 wasn't what solved it), publishing to `<slug>.goodbuildit.xyz`, the firewall, and auto-deploy. Testnet only; mainnet is off.

**App data (D31, in review, not live):** published apps can save data for visitors who sign in with their wallet. Design, limits and what isn't verified: [APP_DATA.md](APP_DATA.md).

**Next: M6**, in this order, with design in [CREDITS.md](CREDITS.md) and [TOPUPS.md](TOPUPS.md):
1. GoodDollar face verification. Read `getWhitelistedRoot` on Celo mainnet (`0xC361…2F42`) with plain viem on the server, even for testnet apps, because the SDK has no Celo Sepolia. Key allowances by root, not wallet. Don't trust the callback: re-read the chain. Verification expires. Use redirect mode on phones. No testnet exists, so a real verified wallet is needed for the live test.
2. Ledger and balances, and the credits pill. The $0.20 cap (D28, `src/server/credits/cap.ts`) currently sums `usage_events`.
3. Paystack in test mode, then the admin treasury page. Exempt the signed webhook from the region block.

**Waiting on the owner before M6 can finish:**
- The verified allowance (Claude suggested $2 once).
- A daily budget for free usage and a per-IP sign-up limit (Claude suggested $5 a day and 3 accounts a day). New wallets are free, so the cap alone doesn't limit total spend.
- Whether M6 is prepaid credits or subscriptions. It's designed as prepaid.
- TOPUPS.md §10 points 3 to 7, including the refund policy. Paystack test keys.
- Whether the owner's wallet is exempt from the cap, and a wallet already verified with GoodDollar for testing.
- Whether GoodDollar requires approval for third-party use of face verification. Its docs don't say.

### Plan first (D32)
A project's first message now asks questions before building. The chat no longer shows the build log or file chips. Tried with the demo model only: real model question quality is **UNVERIFIED**, because no real provider was called.

### M5 gaps
**Wrong today:**
- The deploy success screen says addresses are in the Contract tab, but that tab doesn't show them.
- The ABI interaction panel (CONTRACTS_AND_DEPLOYMENT.md §5) isn't built.
- There's no deployment history in the UI (which version is active, older addresses).

**Built, not tested live:** MetaMask on the production site (it worked on a local build), WalletConnect, MiniPay, a multi-contract deploy, the `paris` rebuild, the test G$ faucet button, a transaction through a published app, and more than one build at a time.

**Left for later on purpose:** Celoscan verification (Sourcify works), paying fees in stablecoins, sponsored gas, a fee estimate that's only exact for the first argument-free contract, and mainnet.

**Launch and operations:**
- Auto-deploy doesn't run the tests first, and has no staging or rollback.
- Backups live on the same server.
- The preview depends on CodeSandbox, which sometimes fails until Try again (Q36).
- New email wallets start with no CELO, so a newcomer has to find the faucet (Q12).
- The landing page shows sample metrics.
- `/terms` and `/privacy` are unreviewed drafts, and `NEXT_PUBLIC_CONTACT_EMAIL` isn't set.

## Done (all on `main`)
| Milestone | Commit | Notes |
|---|---|---|
| M1 Scaffold + landing | 37a5941 … 7e85449 | Tailwind v4 tokens (P6), self-hosted fonts (P7), hero uses `hero-b.jpg` with float/glow/tilt |
| M2 Auth + gating (Privy then; Magic since D22 on `m5-deploy`) | f1122d8 | Own SIWE session (P9), Drizzle + PGlite dev DB (P8), geo-block 451 |
| M3 Logged-in home | 37f17b1, 36307f4 | Contract-type tiles on cards; credits pill says "Testnet beta · free" until M6 |
| M4 Workspace + agent | 1d8d9bc | Vercel AI SDK (D14, D16, D18; LiteLLM removed), runner/checks/auto-fix/checkpoints, Sandpack (P12) |
| Pre-M5 fixes | 6efeeb9 | G$ = ERC-20 guardrails (D15), custom errors only, deduped summary, auto-fix step rows |

The user approved M1–M4 and the pre-M5 fixes.

Agent harness (P17, branch `claude/agent-harness-a8a600`, stacked on the output-quality PR):
- asset uploads with palette and vision descriptions;
- `search_code`, `find_symbol` and ranged `read_file`;
- a file manifest and selective context;
- rolling conversation memory;
- file-naming rules;
- deeper design guides;
- a lucide icon check.

Live results are in [evals/HARNESS.md](evals/HARNESS.md). Run new evals with `scripts/eval-harness.mjs`.

## D18 (replace LiteLLM with the Vercel AI SDK): DONE
Implemented on branch `claude/vercel-ai-sdk-migration-46c76e`: `aiSdkClient()` and `withFallback()` in `src/server/agent/model.ts`, `runner.ts` unchanged, LiteLLM files and `pnpm llm` removed. `deepseek-flash` verified as a model ID in `@ai-sdk/deepseek`. The brief below is kept for reference.

Scope:
1. `pnpm add ai @ai-sdk/anthropic @ai-sdk/deepseek` and `pnpm remove openai`. Versions seen on 4 Nov 2026: ai 7.0.162, @ai-sdk/anthropic 4.0.96, @ai-sdk/deepseek 3.0.79.
2. Rewrite `src/server/agent/model.ts` as `aiSdkClient()`, **keeping the `ModelClient` interface** (`stream(req) -> AsyncIterable<ModelEvent>`, `ModelEvent` = text / tool_call / usage / done, `ModelUnavailableError`) so `runner.ts` doesn't change. Replace the `openai` type imports with local types of the same shape:
   - `ChatMessage`: OpenAI-style `system` / `user` / `assistant {content, tool_calls:[{id, type:"function", function:{name, arguments}}]}` / `tool {tool_call_id, content}` (what the runner already builds).
   - `ToolSpec`: `{type:"function", function:{name, description, parameters}}` (`demo-model.ts` reads `t.function.name`).
3. Inside the client, convert to AI SDK v7 shapes:
   - System message: pass it as `system`, or as a `{role:"system"}` message with `allowSystemInMessages: true` (the default rejects system messages in `messages`).
   - Assistant tool calls become `{type:"tool-call", toolCallId, toolName, input}` parts (parse `arguments` JSON). Tool results become `{role:"tool", content:[{type:"tool-result", toolCallId, toolName, output:{type:"text", value}}]}` (look up `toolName` from the matching call).
   - Tools: `tool({ description, inputSchema: jsonSchema(parameters) })` with **no `execute`**, so the SDK returns the calls and the runner keeps doing the edits. streamText's default stop condition is one step, which is what we want.
   - Call `streamText({ model, system, messages, tools, maxOutputTokens: req.maxTokens, maxRetries: 1, abortSignal: req.signal })` and iterate `fullStream`:
     - `text-delta` (`part.text`) becomes `text`
     - `tool-call` (`toolCallId`, `toolName`, `input`) becomes `tool_call` with `arguments: JSON.stringify(input)`
     - `finish-step` (`usage.inputTokens`, `usage.outputTokens`, `usage.inputTokenDetails.cacheReadTokens`, `response.modelId`, `response.id`) becomes `usage`, with a unique `callId` (response id, or a generated id if missing)
     - `finish` becomes `done`, and `error` is thrown and mapped
   - Models: strong is `anthropic("claude-sonnet-5-5")`, cheap is `deepseek("deepseek-flash")`. **UNVERIFIED:** check that `@ai-sdk/deepseek` accepts `deepseek-flash` as a model ID, and what model name it reports back, so `model-pricing.ts` matches it.
   - Keep Anthropic prompt caching on the system prompt (`providerOptions.anthropic.cacheControl`), so cache-read pricing applies.
4. Fallback wrapper `withFallback(strong, cheap)`: a strong call that throws **before emitting any event** is retried once on cheap. Errors after output has streamed are rethrown, not replayed. Cheap-tier calls don't fall back.
5. Error mapping (`ModelUnavailableError`, plain words): a missing or invalid key (`LoadAPIKeyError`, `APICallError` with status 401 or 403) names `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY` in `.env.local` and says to restart `pnpm dev`. Network and 5xx errors say the provider is unreachable. Drop every `pnpm llm` mention, including `runner.test.ts:227`.
6. Billing: the usage event still goes through `recordUsage` and `costMicro` / `chargedMicro` (cost + 25%, D13). Update the comments in `src/config/model-pricing.ts` that mention LiteLLM.
7. `src/server/agent/index.ts`: `demoModel()` when `GOODBUILD_DEMO_MODEL=1`, otherwise `withFallback(aiSdkClient("strong"), aiSdkClient("cheap"))` or equivalent.
8. Tests: rewrite `model.test.ts` with the mock models from `ai/test` (`MockLanguageModelV2` or the current equivalent, plus `simulateReadableStream`). Cover the text and tool-call mapping, usage and callId, message conversion (tool results round-trip), fallback before output, no fallback after output, and the key-error message.
9. Delete `litellm/`, `scripts/llm-proxy.sh` and the `llm` script in package.json. Remove `LITELLM_*` from `.env.example` (keep `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GOODBUILD_DEMO_MODEL`).
10. Docs: README "AI builds" (no pip or proxy, just keys plus `pnpm dev`), AI_AGENT.md "Implementation (M4)" models line, ARCHITECTURE.md Models row and diagram, CREDITS.md §4 (option B now lives in our code), the Q34 note in OPEN_QUESTIONS.md, and the M4 row in this file.
11. `pnpm check` green, then commit (`D18: Vercel AI SDK replaces the LiteLLM proxy`) and push.

## M5 (compile + wallet-signed deploy): built on branch `m5-deploy`, awaiting review
Not merged. Code lives in its own modules so it doesn't collide with workspace work on `main`: `src/lib/deploy/`, `src/server/deploy/`, `src/components/deploy/`, `src/server/db/deploy-schema.ts`, and `src/app/api/projects/[id]/deploy*`.

What exists:
- **Deploy manifest (D23)**: the agent writes `contracts/deploy.json` (constructor args by parameter name, refs `${Name.address}`, `${GOODDOLLAR}`, `${DEPLOYER}`). `checkContracts` validates it in the normal auto-fix loop; `planManifest` sorts it topologically and fails on a cycle.
- **Compile for deploy** (`src/server/deploy/compile.ts`): cancun by default; `paris` fallback (D17) first with the current OpenZeppelin, then with the pinned **5.1.0** (`@openzeppelin/contracts-paris`, the newest 5.x without MCOPY) if a dependency needs Cancun. Returns bytecode, ABI and a Sourcify-ready standard JSON.
- **Simulation** (`src/lib/deploy/simulate.ts`): scans runtime code for post-Paris opcodes and asks the chain whether each exists (an `eth_call` with a state override), then `eth_estimateGas` on the creation. An opcode failure shows "Rebuild for older Celo", which re-runs prepare with `paris`.
- **Deploy run** (`src/lib/deploy/run.ts`): one wallet signature per contract in order, references filled from real addresses. Partial failure keeps finished contracts and "Try again" resumes: it never re-signs a finished contract, and a transaction already sent is picked up again rather than sent twice. Sent transactions are also kept in the browser (`src/lib/deploy/pending.ts`), so a reload or closed modal picks them up too. On another device they aren't known, and that deploy creates a new contract.
- **Reuse rule:** a contract counts as already deployed only for the same `.sol` sources, `contracts/deploy.json` and EVM target (`sourceKey`). When nothing is left to sign, the modal shows the live addresses.
- **Server record** (`recordDeployment`): reads the receipt and transaction itself (sender must be the session wallet, creation input must start with GoodBuild's compiled bytecode), then writes the `deployments` row (migration `0004_m5_deployments`) and the addresses into `src/contracts/<Name>.ts`. Rebuilds and reverts re-apply those addresses.
- **After a deploy:** the preview remounts when an address lands (`contractAddressKey`), the chat gets a "live at" note, and every later turn tells the agent what is deployed (`deploymentsBlock`). If no page reads any `<Name>Address`, a wiring turn is queued automatically (`contractsToWire`). A rebuild that changes a contract's ABI drops its old address until it is deployed again; a revert doesn't apply that check yet.
- **Verification**: Sourcify v2 (both Celo chains are in its live chain list), polled after the response; Celoscan later.
- **Deploy modal** per DESIGN_SYSTEM §4 (preview states at `/dev/preview?deploy=ready|replace|signing|second|opcode|failed|manifest|done`).
- **Test G$** (`scripts/solidity/goodbuild/TestGoodDollar.sol`, 18 decimals, ERC-677 `transferAndCall`, 1,000 per wallet per day faucet) plus `pnpm deploy:test-gd`.

**Needs you (nothing below could be done from this session):**
1. Open `/dev/test-gd` in development and deploy from your wallet (D24; get testnet CELO from the Celo Sepolia faucet), then set `NEXT_PUBLIC_TEST_GD_ADDRESS`. `pnpm deploy:test-gd` also works. Until then testnet deploys that use `${GOODDOLLAR}` stop with "no test G$ yet".
2. Magic dashboard: create the app, set `NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY` and `MAGIC_SECRET_KEY`, and allow `https://forno.celo.org` and `https://forno.celo-sepolia.celo-testnet.org` in its content security policy.
3. One real end-to-end deploy (email wallet, then MetaMask) on Sepolia. **Not verified live yet:** Magic's Celo Sepolia behaviour and confirmation UI, WalletConnect/MiniPay connection, whether Celo's RPC accepts state overrides (if not, only the creation estimate runs), and a real Sourcify match.

Known gaps: the fee estimate is exact for the first argument-free contract and scaled by size for the rest; mainnet deploys stay behind `NEXT_PUBLIC_ENABLE_MAINNET`.

`main` (through the background runner, P18) is merged into this branch. The M5 migration is now `0004`, after main's `0003`. A local `.data/` database that ran the old M5 `0003` needs resetting: it would try to create `deployments` again.

## Publish (P19), landing sections, /docs and preview pop-out
Publish code lives in `src/server/publish/`, `src/server/db/publish-schema.ts` (migration `0005`), `src/proxy.ts`, `src/lib/published-host.ts`, `src/app/published-app/` and `src/components/workspace/publish-modal.tsx`.

**Verified on a production build (5 Nov 2026), on `<slug>.localhost`, with a demo tip jar and no contract deployed:**
- API: publish (4s), update, unpublish (app returns 404), reserved and taken slugs refused, 451 on a blocked region.
- Isolation: no main API or `/home` on an app host, a session cookie gets nothing there, and the main host can't reach `/published-app`. Published apps are same-site with the main site, so the browser does send the session cookie on their requests to it. What protects the API is `isForeignWrite` in `src/proxy.ts`, which returns 403 for writes from another site or subdomain, plus CORS for reads. Before that check, a text/plain POST from an app host created a project as the signed-in user (reproduced on the server, 201).
- Browser: the app runs under its CSP with the demo notice, the modal publishes and unpublishes, and the pop-out preview loads.
- Sign-in with `__Host-` cookies, using an external wallet.

**To run it locally:** production mode with `PUBLISHED_APPS_DOMAIN=localhost`, `ALLOW_PGLITE=true`, `SESSION_SECRET` and `APP_DOMAIN`.

**Verified with a real deploy (5 Nov 2026):** a throwaway wallet deployed `TipJar` on Celo Sepolia at `0xAC81a96393eF4306E3885aC7868EBd6a0aAa7BEA` through the deploy modal on a production build on Postgres, with an exact Sourcify match. The preview went live with no reload, the chat got its "live at" note, and "Publish app" on the success screen published it with the address baked in and no demo notice. The test signer stood in for a browser wallet, so MetaMask's own UI wasn't part of this.

**Not verified:**
- A contract deploy from a Magic email wallet.
- A real host: `*.goodbuildit.xyz` needs wildcard DNS. Q16 and Q31 stay open.

**Running now (D27):** live at https://goodbuildit.xyz on one VPS, see [DEPLOY.md](DEPLOY.md). Tested live on 5 Nov 2026: a real AI build, a Celo Sepolia deploy with a Sourcify match, publishing, the firewall, and the workspace and preview in a browser. A test signer stood in for the wallet. Email sign-in with Magic works live (the owner signed in on 5 Nov 2026). Not tested live: a deploy from an email wallet (the first attempt had no CELO), and more than one build at a time. The rest of this section describes the Vercel and Railway setup (D26), which is on hold.

**Hosting (D26, amends D25):** Vercel serves pages and forwards `/api/*`, `/a/*` and published apps to Railway, which runs the `Dockerfile`, with Postgres alongside.

| | Vercel (edge) | Railway (backend) |
|---|---|---|
| Required | `BACKEND_ORIGIN`, `EDGE_SECRET`, `DATABASE_URL` (public), `DATABASE_POOL_MAX=2`, `SESSION_SECRET`, `APP_DOMAIN`, `PUBLISHED_APPS_DOMAIN` | `EDGE_SECRET`, `DATABASE_URL`, `SESSION_SECRET`, `APP_DOMAIN`, `PUBLISHED_APPS_DOMAIN`, `MAGIC_SECRET_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `NEXT_PUBLIC_TEST_GD_ADDRESS` |
| Build-time | every `NEXT_PUBLIC_*` value | the same, as Docker build arguments |

- `APP_DOMAIN=goodbuildit.xyz` and `PUBLISHED_APPS_DOMAIN=goodbuildit.xyz` on both, with the same `SESSION_SECRET`.
- Trial: one Railway service, using the inline worker. After upgrading: add a `pnpm worker` service and set `GOODBUILD_INLINE_WORKER=0` on web.
- Migrations: `pnpm db:migrate` before each deploy.
- `*.goodbuildit.xyz` needs Vercel's nameservers.
- Serverless and `output: standalone` can't compile contracts, because solc, OpenZeppelin imports and contract tests run in child processes that read `node_modules` directly. That's why this work is on Railway.
- Rehearsed locally (5 Nov 2026): the backend image capped at 1 GB behind a separate edge server. Sign-in, pages, compiling, publishing, the app host, the 451, the secret check and turn events all worked through the edge. Peak memory was 657 MiB with a first publish and compiles running together, with no out-of-memory kill. A full AI turn with contract tests wasn't part of that, and Vercel's own forwarding is still to be checked on the first deploy.
- Checked locally with Docker (5 Nov 2026): migrations, web and worker as separate containers, compiling with OpenZeppelin, publishing and serving an app, and the worker claiming a job (it then stopped at the AI call, because that test had no keys). Not yet run on Railway or Fly.
- Serverless and `output: standalone` can't compile contracts, because solc, OpenZeppelin imports and contract tests run in child processes that read `node_modules` directly.

**Publish's packages:** file tracing skips `node_modules` and pnpm's symlinks, so `pnpm build` first packs the runtime packages and Tailwind's stylesheets into `publish-runtime.pack.gz` (`scripts/build-publish-runtime.mjs`, about 22 MB), and the first publish unpacks it to the temp folder (`src/server/publish/runtime.ts`). Checked with `NEXT_OUTPUT=standalone pnpm build`, run outside the repo on Postgres. `PGlite` doesn't start in standalone output, and production doesn't use it. Don't set `HOSTNAME` to `127.0.0.1` on a standalone server: the route then sees the wrong Host and refuses to serve apps (`0.0.0.0` is fine).

**Other gaps:** `/terms` and `/privacy` are drafts that no lawyer has reviewed, and legal pages and `/report` need `NEXT_PUBLIC_CONTACT_EMAIL`. `scripts/takedown.mjs` takes a published app down. The Unpublish button uses `window.confirm`, which blocks browser automation. A self-reload of `/home` and the workspace under `next dev` was reported by the session that built this, and didn't reproduce here over 30s on each page without a Magic key.

Then M6 (credits, D13: USD primary, cost + 25%; usage is already recorded in `usage_events`). **Top-ups (D21) are designed in [TOPUPS.md](TOPUPS.md), waiting for your review: no code until then.**

## Open questions worth reading
Q36 (preview depends on CodeSandbox and the Tailwind CDN), Q37 (chat width), Q38 (read-only code tab), Q40 (top-ups) and Q41 (Magic) in OPEN_QUESTIONS.md. Q39 is resolved (D23).

## Test wallet
Throwaway wallet for live deploy tests, kept on purpose: `0x80fB54faA246dd4E75A000D88eC9BF2aBD7407AD` on Celo Sepolia (about 0.97 test CELO on 5 Nov 2026). Its key is in `.data/throwaway-wallet.key` in the `landing-publish` worktree (gitignored). Never use it on mainnet or for anything of value.

## Working conventions used so far
- Post a short plan before each milestone; commit after each; stop when the user asks for a review.
- `pnpm check` (lint, typecheck, tests, build) must pass before every commit.
- The user's preference: **never use em dashes** in any writing (docs, UI copy, commit messages).
- Commit trailers used so far: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Testing without real accounts
- `GOODBUILD_DEMO_MODEL=1` asks plan-first questions, then replays a scripted G$ tip-jar build, or a one-page site for a website prompt (development only).
- `node scripts/demo-session.mjs [--seed]` signs in a throwaway wallet against a running server and prints the session cookie, so you can test without Magic.
- `pnpm smoke:auth` runs 14 end-to-end sign-in checks against a running server (`BASE_URL`).
- Production-mode local runs need `SESSION_SECRET`, `APP_DOMAIN` and `ALLOW_PGLITE=true` (or a `DATABASE_URL`).

## Gotchas found the hard way
- `pnpm build` failing with "binding to a port: Operation not permitted" in the PostCSS (Tailwind) loader: measured on 5 Nov 2026, the cause was a stale `.next` left by `next dev` in the same folder, not the code or the sandbox. Move `.next` aside and the build passes. Stop the dev server first.
- Background turns (P18): the worker is a `globalThis` singleton started from `src/instrumentation.ts`, and hot reload doesn't replace it. Restart `pnpm dev` after changing `src/server/agent/runner.ts` or `src/server/jobs/`, and after any migration.
- Next 16: GET route handlers are prerendered unless they call `await connection()` (outside `try`). The SIWE nonce route relies on this.
- PGlite and solc must stay in `serverExternalPackages` (next.config.ts); bundling PGlite breaks restarts on an existing `.data/` database.
- Sandpack injects unlayered CSS that beats Tailwind's layered utilities, so its layout overrides live in plain CSS in `globals.css` (`.gb-sp-section`, `.gb-sandpack`).
- The `@tailwindcss/browser` CDN and CodeSandbox's bundler are unreachable from sandboxed environments, so the live preview can only be checked in a normal browser.
