# Handoff: Stage 1 build status

Written 4 Nov 2026 at the end of the first build session (claude.ai), for whoever continues in Claude Code. Read CLAUDE.md and docs/BUILD_PROMPT_STAGE1.md first; this file only covers where things stand.

## Done (all on `main`)
| Milestone | Commit | Notes |
|---|---|---|
| M1 Scaffold + landing | 37a5941 … 7e85449 | Tailwind v4 tokens (P6), self-hosted fonts (P7), hero uses `hero-b.jpg` with float/glow/tilt |
| M2 Privy auth + gating | f1122d8 | Own SIWE session (P9), Drizzle + PGlite dev DB (P8), geo-block 451 |
| M3 Logged-in home | 37f17b1, 36307f4 | Contract-type tiles on cards; credits pill says "Testnet beta · free" until M6 |
| M4 Workspace + agent | 1d8d9bc | LiteLLM (D14, D16; being replaced by the AI SDK, D18), runner/checks/auto-fix/checkpoints, Sandpack (P12) |
| Pre-M5 fixes | 6efeeb9 | G$ = ERC-20 guardrails (D15), custom errors only, deduped summary, auto-fix step rows |

The user approved M1–M4 and the pre-M5 fixes.

## Next, first: D18 (replace LiteLLM with the Vercel AI SDK)
Decided by the user, not started in code (`main` still uses LiteLLM). Do this **before** the user's real build, so they don't have to set up the proxy at all.

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

## Then: M5 (compile + wallet-signed deploy)
After D18, the user does **one real build with their own keys** (`.env.local`: `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, then `pnpm dev`). Start M5 after they report back.

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
