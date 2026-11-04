# Decisions

Format: decision, date, who decided, rationale. **User** decisions are fixed unless the user changes them. **Recommended (Ego)** decisions are adopted unless changed and may be challenged with reasons (see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)). Add new decisions at the bottom.

## User decisions (fixed)

### D1. Build an app builder, not a "pay for LLMs with G$" router
- Date: 4 Nov 2026 · Decided by: user (Olayinka)
- Rationale: GoodDollar already builds G$-to-AI-credits: repo https://github.com/GoodDollar/antseed-integration and https://aicredits.gooddollar.org. A router would overlap with GoodDollar's own work.

### D2. Stage 1 MVP is dApps only
- Date: 4 Nov 2026 · Decided by: user
- AI generates the Solidity contract and a React front end. The user deploys to Celo by signing from their own wallet (GoodBuild never holds deploy keys).
- Rationale: smallest useful scope; app state lives on-chain, so no backend is needed.

### D3. Backend and database support for generated apps is deferred to Season 5
- Date: 4 Nov 2026 · Decided by: user
- Rationale: keeps Stage 1 small; adds hosting and cost complexity.

### D4. Sports betting rejected
- Date: 4 Nov 2026 · Decided by: user
- Rationale: grey or illegal. GoodDollar ToS §6.3 bans use that violates applicable law; Lagos requires an LSLGA licence for betting (LSLGA Law 2021). See [RESEARCH.md](RESEARCH.md#legal-and-terms).

### D11. GoodBuild builds its own credit system
- Date: 4 Nov 2026 · Decided by: user (Olayinka)
- Rationale: GoodDollar AI credits have no usable inference API/API keys yet ("not yet implemented"; see [GOODDOLLAR_AI_CREDITS.md](GOODDOLLAR_AI_CREDITS.md)). Users deposit G$ to a GoodBuild vault on Celo; an off-chain ledger funds LLM spend via LiteLLM. Design: [CREDITS.md](CREDITS.md). GoodDollar/AntSeed may become an optional future provider (P3).

### D12. Design direction: light bento (Design B)
- Date: 4 Nov 2026 · Decided by: user (Olayinka)
- GoodBuild uses the light bento style of [design/landing/index.html](../design/landing/index.html): #F5F5F5 canvas, white cards, violet #592E81 primary, a sparing pink #FF85D9 pop, Unbounded display caps with Inter for body. The dark Design A is archived in `design/landing/explorations/`.
- All UI must follow [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- Rationale: the user chose it over the dark exploration.

### D13. Credits are USD-denominated; builds billed at actual LLM cost + 25%
- Date: 4 Nov 2026 · Decided by: user (Olayinka) · Resolves Q26 (and Q18, Q21 for Stage 1)
- **Unit:** USD is the primary credit unit everywhere in the UI. G$ is shown alongside, converted at the rate snapshotted when the deposit was made (CREDITS.md §3).
- **Price:** each build is billed at the actual LLM cost of its calls plus a 25% markup. Cost comes from the token usage the provider reports, priced with GoodBuild's own table (`src/config/model-pricing.ts`), not LiteLLM's cost map, which may lag new models.
- **Preflight:** an estimate is shown before Build, and the balance check and reservation follow CREDITS.md §4.
- Rationale: users see a stable price while G$ moves; billing at real cost keeps the platform from losing money on large builds.

### D14. Stage 1 models via LiteLLM, direct providers only
- Date: 4 Nov 2026 · Decided by: user (Olayinka) · Refines D9 · **LiteLLM part superseded by D18** (the model choices still stand)
- Strong (planning and code): `anthropic/claude-sonnet-5-5`. Cheap and fallback (titles, summaries, first auto-fix attempt): DeepSeek (user asked for `deepseek/deepseek-chat`; Claude proposed `deepseek/deepseek-flash` because DeepSeek's current docs list only Flash and V4 Pro, see Q34). No OpenRouter.
- Keys: `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` in `.env.local`, read by the LiteLLM proxy only. The app calls two aliases, `gb-strong` and `gb-cheap`, so models change in `litellm/config.yaml` alone.

### D15. Generated contracts: G$ is the ERC-20, custom errors only
- Date: 4 Nov 2026 · Decided by: user (Olayinka)
- "G$" / GoodDollar in a prompt always means the G$ ERC-20 on Celo, never native CELO or `msg.value`. G$ payments use ERC-677 `transferAndCall` (receiver implements `onTokenTransfer` and checks `msg.sender` is the token) or `approve` + `safeTransferFrom`, always with SafeERC20. The token address is a constructor argument.
- Contracts use custom errors only: no `require(...)` without a custom error, no `revert("text")`.
- Enforced in the agent's system prompt and by build-blocking guardrails on the compiler AST (`src/server/agent/checks.ts`). Native CELO is allowed only when the user explicitly writes "CELO".

### D16. Cheap model is DeepSeek Flash; generated apps use viem
- Date: 4 Nov 2026 · Decided by: user (Olayinka) · Resolves Q34, adopts P10
- `gb-cheap` = `deepseek/deepseek-flash`. Generated apps use viem directly (no wagmi).

### D17. EVM target and source verification
- Date: 4 Nov 2026 · Decided by: user (Olayinka) · Resolves Q35
- Compile for `cancun`. The M5 pre-deploy simulation on Celo must fail loudly if Celo rejects the bytecode (for example an unsupported opcode), and then offer a rebuild for `evmVersion: paris`. OpenZeppelin 5.6 needs Cancun (MCOPY), so the paris fallback also means a pinned older OpenZeppelin release (version to confirm in M5).
- Source verification starts with Sourcify (no API key); Celoscan comes later.

### D18. Vercel AI SDK in the app replaces the LiteLLM proxy
- Date: 4 Nov 2026 · Decided by: user (Olayinka) · Supersedes the LiteLLM part of D14 (and of D9 for Stage 1) · Status: decided, implementation pending (see HANDOFF.md)
- Model calls go through the Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/deepseek`) from Next.js server code. No proxy process, no `pnpm llm`, no `LITELLM_BASE_URL` or `LITELLM_MASTER_KEY`.
- Routing is unchanged: strong (`claude-sonnet-5-5`) for planning and code; cheap (`deepseek-flash`) for titles, summaries, the first auto-fix attempt, and as the fallback.
- A fallback wrapper retries a strong call on the cheap model when the strong call fails before streaming any output. A call that already streamed text or tool calls is not replayed.
- Cost is computed from our per-model price table (`src/config/model-pricing.ts`) at cost + 25% (D13) and written to the existing `usage_events` ledger. No dependency on an external cost map.
- Keys: `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` in `.env.local`, now read by the app server itself.
- Trade-offs Claude flagged: provider keys now live in the web process (keep them server-only, never `NEXT_PUBLIC_`); LiteLLM's per-user virtual-key budgets (CREDITS.md §4 option A) are gone, so spending limits are enforced by our own preflight reservation and ledger (option B, done in our code instead of a LiteLLM callback). One less service to run and deploy.

## Recommended decisions (Ego; adopted unless changed)

### D5. In-browser preview via Sandpack
- Date: 4 Nov 2026 · Recommended by: Ego
- Use Sandpack (open source, free). No E2B or WebContainers for now.
- Rationale: WebContainers needs a commercial licence for for-profit production use (https://webcontainers.io/enterprise). E2B Hobby has a $100 one-time credit and costs about $0.17/hr per default sandbox; Pro is $150/mo (figures as given, re-check https://e2b.dev/pricing). Stage 1 front ends are static React, which Sandpack handles.

### D6. Build our own small builder; don't fork Open Lovable
- Date: 4 Nov 2026 · Recommended by: Ego
- Rationale: Open Lovable (https://github.com/firecrawl/open-lovable) is MIT but built around E2B/Vercel sandboxes and has no contract or wallet flow. Borrow ideas (prompting, file-edit format), not the codebase.

### D7. Generated apps default to shadcn/ui + React Bits
- Date: 4 Nov 2026 · Recommended by: Ego
- Rationale: Lovable-quality UI out of the box.

### D8. Persistence split
- Date: 4 Nov 2026 · Recommended by: Ego
- Project code and chat history live in our own DB. App data lives on-chain; the deployed contract address (and chain id) is stored per project.

### D9. AI calls via GoodDollar AI credits if allowed, else providers via LiteLLM
- Date: 4 Nov 2026 · Recommended by: Ego
- Not OpenRouter: its ToS bans access "for purposes of reselling API access to Models or otherwise developing a competing service" (https://openrouter.ai/terms).
- No public API exposing Claude without Anthropic approval (Anthropic Commercial Terms forbid reselling "except as expressly approved").

### D10. 18+ only; block US persons
- Date: 4 Nov 2026 · Recommended by: Ego
- Rationale: GoodDollar ToS §6.2 (18+) and §8 "NO U.S. PERSONS MAY USE THE SERVICES". Gemini API also requires 18+. Also exclude sanctioned jurisdictions.

## Proposed decisions (not adopted; Claude and the user may change them)

### P1. Testnet is Celo Sepolia, not Alfajores (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · Alfajores retired 30 Sep 2025 (https://docs.celo.org/operate/notices/archive/celo-sepolia-launch).

### P2. Audited-template-first contracts, non-upgradeable by default (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See CONTRACTS_AND_DEPLOYMENT.md §4. Open: Q1, Q4, Q15.

### D19. DeepSeek builds first, Claude fixes
- Date: 4 Nov 2026 · Decided by: user (Olayinka) · Refines D14 and D18
- Routing: `deepseek-flash` for planning and the first build pass; `claude-sonnet-5-5` for every auto-fix attempt (compile errors, guardrail and app-check failures). The fallback wrapper still retries a failed strong call on cheap.
- Why: the first live runs cost about $0.02 on DeepSeek and $0.10 on Sonnet for a similar small contract, and both compiled clean. Claude is kept for the step where a cheap model has already failed.
- Open: whether follow-up edits (reprompts on an existing project) should use Claude. Claude recommends yes, see AI_AGENT.md. One line in `TIER_FOR` (`src/server/agent/model.ts`).

### D20. Websites and pages are in scope alongside dApps
- Date: 4 Nov 2026 · Decided by: user (Olayinka), in chat: vibe-coding a website is also something GoodBuild does · Widens D2 (Stage 1 = dApps only).
- The agent builds plain websites and pages (landing, about, signup, event or shop sites) as well as dApps, and writes a contract only when the app needs on-chain state or payments. Still no backend or database (D3): forms that must store data either use an on-chain registry or say storage is coming later.
- Flag for the user: CLAUDE.md item 3 still reads "Stage 1 = dApps only"; update it if this stands.

### P3. Off-chain deployments table is the source of truth; on-chain factory optional later (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See CONTRACTS_AND_DEPLOYMENT.md §3. Open: Q11.

### P4. Agent uses tool-based diff edits, checks + auto-fix (max 3), checkpoint per prompt, plan/build modes (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See AI_AGENT.md. Open: Q14.

### P5. Auth: Privy (email embedded wallets + external wallets + SIWE), fallback thirdweb (proposed)
- Date: 4 Nov 2026 · Proposed by: Ego · User requirement: wallet sign-in before sending a prompt, plus email login.
- Privy supports Celo mainnet and Celo Sepolia (any EVM chain), email OTP that creates an embedded wallet, external wallets, built-in SIWE and user key export. Free up to 499 MAU, then $299/mo.
- Fallback: thirdweb in-app wallets (1,000 MAU free, $0.015/MAU). Keep providers behind a wagmi-based adapter.
- Details and sources: [AUTH.md](AUTH.md).

### P6. Tailwind v4 with tokens in CSS `@theme` (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · DESIGN_SYSTEM §6 tokens mapped 1:1 into `src/app/globals.css`; default palette reset. See Q23.

### P7. Self-hosted fonts (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · Unbounded, Inter and JetBrains Mono are vendored variable woff2 files (OFL) loaded with `next/font/local`, so builds and page loads don't depend on Google Fonts.

### P8. Postgres via Drizzle, embedded PGlite for development (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · Pulled forward from M4 because M2 needs `users` and `sessions`, and the gated prompt needs `projects`/`messages` (D8). `DATABASE_URL` selects Postgres; without it, dev and tests use PGlite (in `.data/`, or in memory for tests), so there's nothing to install. Production refuses to start without `DATABASE_URL`.

### P9. GoodBuild owns the session; Privy only connects wallets (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · Implements P5. Privy handles email OTP, embedded wallets and the external-wallet connectors. The session is ours: SIWE (EIP-4361) verified server-side, a signed httpOnly cookie (7 days, rotated daily, revocable via a `sessions` row). Every API route checks this session, never a client-supplied address. Keeping Privy out of the session is what makes the thirdweb fallback a one-folder swap (`src/lib/auth/privy`).
- The sign-in signature is silent for email wallets; all other embedded-wallet signatures (deploys, top-ups) keep Privy's confirmation screen.

### P10. Generated apps use viem directly, not wagmi (adopted: D16)
- Date: 4 Nov 2026 · Proposed by: Claude · Generated apps run in Sandpack's in-browser bundler, where wagmi's dependency tree is heavy and slow to resolve. The starter template ships `src/lib/chain.ts` (viem clients, connect, chain switch, simulate-then-write) and a `useWallet` hook. CONTRACTS_AND_DEPLOYMENT §5 says "uses wagmi hooks"; revisit when apps get a real build step (publishing).

### P11. Agent checks: solc + guardrails, syntax and imports; no full type-check (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · Implements P4. After the model's edits: solc 0.8.28 (OpenZeppelin 5.6.1 vendored, EVM cancun, in a child process so it never blocks the server), the CONTRACTS §4 guardrails on the compiler AST, a TypeScript syntax check, and import resolution against project files and the package allowlist. A full `tsc` type-check is left out: the in-browser bundler has no node_modules types, and Sandpack's own errors reach the agent through "Fix it". Auto-fix: up to 3 attempts, the first on the cheap model; identical errors twice stop the loop.

### P12. Preview uses Sandpack's hosted bundler (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · Implements D5. Sandpack's classic `react-ts` bundler is loaded from CodeSandbox's servers, and generated apps get Tailwind from the `@tailwindcss/browser` CDN build. Fine for previews; it is an external dependency (Q36).

### P13. Designed-per-prompt output: layout-free starter, helper hooks, follow-ups, quiet fix passes (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · The user reported generated pages looked hardcoded: the starter `App.tsx` (header bar with "My dApp" plus a card) was being copied. The starter is now a one-line placeholder, and the system prompt gains design rules (layout by app type, verb-labelled main action, real copy, per-app accent colour) plus `useRead`/`useTx`/`formatAmount`/`errorMessage`, `Skeleton` and `Notice` so a cheap model gets loading, error and success states right. Build and plan replies end with one or two follow-up questions (Lovable style). Auto-fix passes no longer add text to the reply, so the follow-ups stay last; the fix steps already show what happened.
- Runner changes, each from a live DeepSeek run: (1) fix passes are quiet, because a fix note appended after the follow-ups buried them; (2) text that comes with tool calls in build mode ("I'll start by planning this out.") is dropped as narration, because DeepSeek kept writing it despite the prompt; (3) if a pass runs out of tool rounds or ends with nothing shown, one more call asks for the reply (plan summary as a last resort), because a turn that looped on no-op edits saved an empty reply; (4) an `edit_file` that changes nothing returns "No change ... stop and reply" so the model breaks the loop. Plan answers are capped at about 120 words with no code blocks.
- `checkApp` now rejects using `<Name>Address` (a chain-id map) as an address; it must be indexed (`TipJarAddress[chain.id]`). This was the cause of viem's `Address "[object Object]" is invalid` in the preview.

### P14. Front-end guides loaded on demand (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · `src/server/agent/guides.ts` holds short guides (pages-and-routing, landing-page, forms-and-signup, design-tokens, content-pages, dashboard-and-data). The system prompt lists each with one line on when it applies; the model picks them in `set_plan` (`guides` field, so no extra round) or with `read_guide`, and the runner logs which were loaded. No regex classification of the request: the model decides, the guide teaches. Modelled on Dyad's AI_RULES and the Lovable prompt's design-system rules (semantic tokens, variants, SEO-ish single h1), kept small for a cheap model.
- Multi-page apps use react-router-dom 6.30.6 with HashRouter (now a base dependency), pages in `src/pages/`, a shared `Layout`. Starter `@theme` gains card, ring, accent-foreground and display-font tokens; the guides ban raw palette classes.

### P3. GoodDollar AI credits via AntSeed gateway behind LiteLLM (DEFERRED by D11)
- Status: deferred. GoodDollar/AntSeed is an optional future provider only, revisit once GoodDollar ships its proxy/API keys.
- Date: 4 Nov 2026 · Proposed by: Grok Bot · Users fund credits with the GoodWidget AI credits widget; GoodBuild runs an AntSeed gateway registered as an OpenAI-compatible LiteLLM provider, falling back to direct providers. Blocked on buyer-key custody / GoodDollar proxy (see [GOODDOLLAR_AI_CREDITS.md](GOODDOLLAR_AI_CREDITS.md), Q17).
