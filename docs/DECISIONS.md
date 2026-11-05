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

### D21. Naira top-ups via Paystack; treasury is backend-only (part of M6)
- Date: 5 Nov 2026 · Decided by: user (Olayinka) · **Numbered D21 here:** the user wrote "D14", but D14 is already the models decision.
- Users top up in NGN through Paystack (Starter Business, test mode only for now). A verified webhook (signature check, idempotent by reference) credits the USD ledger instantly at the day's NGN→USD rate minus Paystack fees. The UI shows only "Top up" in NGN and the credit balance: never G$ conversion, batching or treasury details. Copy says users buy GoodBuild credits, not crypto.
- Treasury is admin-only: record NGN inflows, list unconverted totals, and a manual weekly batch (NGN→USDT off platform → USDT to the Celo treasury → G$ via the GoodDollar reserve with `minReturn`), logging each batch's tx hash against the top-ups it covers.
- Keys: `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`. Design and open points: [TOPUPS.md](TOPUPS.md) (written first; **no code until the user reviews it**). The conflict with D13 is settled in D24.

### D22. Auth: Magic replaces Privy (supersedes P5 and P9's provider choice)
- Date: 5 Nov 2026 · Decided by: user (Olayinka) · **Numbered D22 here:** the user wrote "D18", but D18 is already the Vercel AI SDK decision.
- Email login uses Magic's embedded wallet on Celo (custom EVM network config for Celo mainnet and Celo Sepolia). External wallets stay: MetaMask, MiniPay/Valora (injected provider) and WalletConnect. Deploy signing must work with both through the same viem wallet client.
- Keys: `NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY` (client) and `MAGIC_SECRET_KEY` (server, DID token validation). `@privy-io/*` and `NEXT_PUBLIC_PRIVY_APP_ID` are removed.
- Unchanged from P9: GoodBuild owns the session (SIWE, our cookie). For email sign-ins the server also validates the Magic DID token and requires its wallet address to equal the SIWE address.
- Trade-offs Claude flagged: the user's wallet list omits Coinbase Wallet, so it is dropped from the connect modal (it can still connect through WalletConnect); Magic's pricing and key-export options differ from Privy's and are not compared here (UNVERIFIED).

### D17 (update). Approved
- 5 Nov 2026: the user approved D17 as written, including the `paris` fallback with a pinned older OpenZeppelin release.

### D23. M5 deploy answers
- Date: 5 Nov 2026 · Decided by: user (Olayinka) · Resolves Q39.
- **Test G$:** GoodBuild deploys a test G$ on Celo Sepolia (ERC-20 + ERC-677 `transferAndCall`, 18 decimals like mainnet G$, rate-limited faucet) and prefills it for testnet deploys. On mainnet always the real G$ address `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`.
- **Deploy order:** the agent emits a deploy manifest (contracts, order, constructor args including references like `${RTXToken.address}`). GoodBuild topologically sorts it, deploys one signature per contract in that order, shows each step in the stepper, and fails on a cycle.

### D24. Test G$ deployment, credits display and treasury
- Date: 5 Nov 2026 · Decided by: user (Olayinka) · Refines D21 and D23, resolves TOPUPS.md §10 points 1 and 2.
- **Test G$:** deployed from the user's own browser wallet through the development-only page `/dev/test-gd`, so no private key is in a file or env var. `pnpm deploy:test-gd` stays as an alternative.
- **G$ in the UI:** the user asked for "any option that promotes G$", which Claude took as this: D21's "never show G$" covers the top-up flow only (no conversion, batching or treasury details). D13 stands: the credits pill shows G$ beside USD, and the G$ vault deposit stays.
- **Treasury:** the weekly batch keeps about one month of provider bills in USDT and converts only the surplus to G$, because credits are USD liabilities and provider bills are paid in USD.
- **Live test:** both the Magic email wallet and MetaMask, on Celo Sepolia.

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
- Amendment (4 Nov 2026, decided by: user, implemented with the model.ts owner): when every failure is a contract test (P16), the first auto-fix attempt uses `TIER_FOR.testFix` (cheap). Mixed failures and any later attempt still use `TIER_FOR.fix` (strong). Why: in the RTX eval run 4, Sonnet's five fix calls cost $0.44 of $0.50, and most were test fixes. See [evals/RTX.md](evals/RTX.md). Runner: `fixTier()` in `runner.ts`.
- **Second amendment (proposed by Claude on 4 Nov 2026; approved by the user (Olayinka) in chat on 5 Nov 2026):** a compile error inside a contract test file (`contracts/test/`) also counts as a test failure, so when every failure is a test or a test compile error, the first fix attempt uses `TIER_FOR.testFix` (cheap). Mixed failures and later attempts still use `TIER_FOR.fix` (strong). Why: in HARNESS.md E5, Sonnet's fix of a test compile error was $0.20 of a $0.26 build. It is already in the code (`fixTier()` in `runner.ts`, commit 2a690fe, covered by unit tests), `TIER_FOR` in `model.ts` is unchanged, and it has not been measured live yet.
- Open: whether follow-up edits (reprompts on an existing project) should use Claude. Claude recommends yes, see AI_AGENT.md. One line in `TIER_FOR` (`src/server/agent/model.ts`).

### D20. Websites and pages are in scope alongside dApps
- Date: 4 Nov 2026 · Decided by: user (Olayinka), in chat: vibe-coding a website is also something GoodBuild does · Widens D2 (Stage 1 = dApps only).
- The agent builds plain websites and pages (landing, about, signup, event or shop sites) as well as dApps, and writes a contract only when the app needs on-chain state or payments. Still no backend or database (D3): forms that must store data either use an on-chain registry or say storage is coming later.
- Flag for the user: CLAUDE.md item 3 still reads "Stage 1 = dApps only"; update it if this stands.

### P3. Off-chain deployments table is the source of truth; on-chain factory optional later (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See CONTRACTS_AND_DEPLOYMENT.md §3. Open: Q11.

### P4. Agent uses tool-based diff edits, checks + auto-fix (max 3), checkpoint per prompt, plan/build modes (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See AI_AGENT.md. Open: Q14.

### P5. Auth: Privy (email embedded wallets + external wallets + SIWE), fallback thirdweb (SUPERSEDED by D22: Magic)
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

### P9. GoodBuild owns the session; the wallet provider only connects wallets (adopted; provider is Magic per D22)
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

### P15. Follow-ups are clickable chips from a suggest_next tool (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · Requested by the user (Lovable-style follow-ups). The model calls `suggest_next` with one or two next steps, phrased as the request the user would send, in the same response as its final reply. The runner keeps that reply (not treated as narration), ends the pass without another round, saves the chips on the turn record and appends them to later history so "yes, the first one" resolves. The chat shows them on the newest turn only; a click sends the step as a build prompt. Structured, so nothing parses the reply text. Fix passes can't change them.

### P16. Contract tests in a local EVM, plus checks for complex apps (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude · From the RTX eval ([evals/RTX.md](evals/RTX.md)): a buy/sell/swap contract compiled cleanly, but every sell and every liquidity add would have reverted. Compiling proves nothing about behaviour.
- The agent writes `contracts/test/<Name>.t.sol` for contracts that move tokens. GoodBuild compiles it with the project and runs each `test*()` in a fresh in-memory EVM, using `@ethereumjs/evm` 10.1.3 with Cancun, in a child process with a 60s timeout. Platform helpers live under `@goodbuild/`: `Test` (asserts and expectRevert), `Actor` (acts as another wallet) and `MockGoodDollar` (ERC-20 plus `transferAndCall`). Reverts are decoded by name from every compiled ABI. Failures feed the existing auto-fix loop. Test contracts are never deployable, never written to `src/contracts/`, and don't count for G$ guardrails.
- Not M5: nothing touches a network. M5's pre-deploy simulation against Celo stays separate.
- Also added:
  - an AST guardrail: an ERC20 contract may not call its own public `transfer` or `transferFrom`;
  - an EIP-170 size check (24,576 bytes of runtime code);
  - recovery for responses cut off at the output limit;
  - the guides `tokens`, `swaps-and-markets`, `multi-contract`, `cross-chain` and `contract-tests`;
  - `Math`, `ERC20Burnable` and `ERC20Capped` on the import list.
- Open for M5: deploy order and constructor wiring between project contracts (for example RTXPool needs the RTXToken address), and a test G$ on Sepolia (Q39).

### P17. Agent harness: assets, code search, selective context, rolling memory, naming (proposed)
- Date: 4 Nov 2026 · Proposed by: Claude, scope (L1) approved by the user (Olayinka) in chat · Evals: [evals/HARNESS.md](evals/HARNESS.md)
- **Assets.** Users upload logos, images and design references (PNG, JPEG, WebP, SVG, up to 5 MB, 20 per project) from the composer. The type is sniffed from the bytes. SVGs with scripts, entities, `foreignObject`, external refs, `@import` or `javascript:` are rejected; event handlers, doctypes and stylesheet PIs are stripped before anything parses them. Bytes live in a new `project_assets` table behind an `AssetStore` interface (object storage later). sharp (0.35.5, now a direct dependency) reads dimensions and a 5-colour palette that discounts near-white and near-black.
- **How apps reference assets: a stable path, a data URL in the preview only.** Code uses `/assets/<name>`, directly or through the GoodBuild-written `src/assets/index.ts` (`assets.logo.src`, width, height, alt). The preview swaps those literal paths for data URLs in `toSandpack`. Why not a platform URL: measured on 4 Nov 2026, an `<img>` on an https page (Sandpack's origin) failed to load `http://localhost:3001/...`, while a data URL loaded. Chrome blocks public pages from loading localhost resources. Binaries stay out of the model's file map, checkpoints and context. Publishing later copies real files to `/assets/`. A check rejects `/assets/` paths that weren't uploaded. Design references are never shipped.
- **Vision.** Measured the same day: both `deepseek-flash` and `claude-sonnet-5-5` read an image through the AI SDK. Each upload is described once with the cheap model (`TIER_FOR.build`): a sentence for logos and images, and a text layout spec for references. The model sees a manifest of name, kind, size, palette and description. A reference's image is also attached to the next turn's message, once. D19 routing is unchanged, and `model.ts` gained image parts (its owner made that change).
- **Code search.** New tools: `search_code` (literal or regex, `file:line: text`), `find_symbol` (components, hooks, routes, contract functions, events, errors, plus the files that use them), and `read_file` with line ranges. `list_files` returns a manifest with a one-line summary per file. Summaries are computed from the code (exports, routes, h1, sections, contract functions) and cached by content hash, so they cost no model calls. Reads and searches are logged, so evals can count them.
- **Selective context.** The context block has a manifest of every file, then the files picked for the request. If the whole project fits the 40k-char budget it is sent whole, because a read round trip re-sends the conversation and costs more than the files. Otherwise the block holds:
  - the entry, the theme, contracts and the assets module;
  - files ranked by request terms matched against path, symbols and text;
  - files changed last turn, then import neighbours;
  - small starter helpers, smallest first, with whatever budget is left.

  Platform ABI modules (`src/contracts/*.ts`) are left out, because the contract source is in and the manifest names their exports.

  Measured: a realistic 30-file project is about 28k chars, so most projects today are sent whole. This replaces "everything up to 100k".
- **No vector search.** Lexical search plus the symbol index found the file in every case of the offline 10-request set and the live E3 run, so embeddings would add a provider, a cost and staleness for no measured gain. Revisit if projects outgrow the 80-file cap or a request misses in evals.
- **Rolling memory.** The last 8 messages are sent verbatim. Older ones are folded by the cheap model into `projects.memory`: a summary under 120 words, plus a separate list of the user's decisions and constraints with exact values. A prose summary alone is what loses an early decision. This costs at most one cheap call per turn, and the user's own words are kept as a fallback if that call fails.
- **File naming.** A `file-structure` guide covers:
  - `src/pages/PascalCase.tsx`;
  - `src/components/PascalCase.tsx` (sections in `src/components/sections/`);
  - `src/lib/useCamelCase.ts` and `src/lib/camelCase.ts`;
  - `contracts/PascalCase.sol` and `contracts/test/PascalCase.t.sol`;
  - uploads at `/assets/`.

  `namingProblem()` in `checks.ts` enforces these for new files and renames only, so older projects keep working. `pathProblem()` also blocks `src/assets/`.
- **Design guides.** Deeper `landing-page` (six archetypes, a section library, imagery), `pages-and-routing` (responsive sticky nav, multi-page dApp layout) and `design-tokens` (font pairings via `--font-display`, a type scale). New guides: `brand-and-assets`, `match-reference`, `ui-states` and `file-structure`. The model still picks which to load; nothing classifies the request.
- **Also found by the evals:** lucide-react 1.68 has no brand icons, so `import { Instagram }` is `undefined` and blanks the preview. The app check now rejects icon names lucide doesn't export, and a test keeps the platform's lucide version equal to the one apps pin.
- **Additions after the first evals (commit 2a690fe and later).** See the gap checklist in [evals/HARNESS.md](evals/HARNESS.md#gap-checklist) for how each was tested.
  - **Uploads:** the attach menu's Logo, Image and Design reference items set the kind; drag-and-drop and paste upload images; each chip's "Use as" menu re-classifies a file, which re-describes it and, for a new reference, attaches the image to the next turn.
  - **SVG sanitising:** DOMPurify on jsdom with checks before and after, replacing the regex rules. New runtime dependencies: `dompurify` and `jsdom`.
  - **Signed asset URLs:** `/a/<token>` on a public https deployment; local development keeps data URLs.
  - **Preview auto-fix:** a runtime error right after a build is fixed automatically, once per version, never for network or bundler errors.
  - **Visual check:** after a ready build the workspace captures the preview from inside the iframe, and the cheap model lists visible defects. The result is saved on the turn; "Fix these" sends the issues as a prompt. It never edits on its own.
  - **No DeepSeek thinking for image questions:** `visionClient()` in `agent/index.ts` wraps `deepseek-flash` with thinking off for the visual check and upload descriptions. Routing in `model.ts` is unchanged. Measured: with thinking on, 500, 2,500 and 6,000 output tokens all ended at `length` with no text; with it off, 2 s and about 150 tokens. This was why the v12 visual check never appeared, and why some image descriptions came back empty.
  - **Memory:** each kept decision is tagged with its turn (`[t1] ...`), so "what did I say first" keeps its order.
  - **Context ranking:** a short synonym list (404 and NotFound, home and index, nav and Layout or Header).
  - **Style:** no em dashes in replies (prompt line, plus `plainDashes` as a backstop).
  - **Reads of uploads:** `read_file` on an uploaded image's path returns a pointer to `/assets/<name>` instead of "missing".

### P18. Background turn runner: jobs, leases, resumable turns, Stop (proposed)
- Date: 5 Nov 2026 · Design agreed with the user (Olayinka), who decided resume (option C) and Stop (cancels queued follow-ups); built by Claude · Code: `src/server/jobs/`, `src/server/agent/turn-progress.ts`, `runner.ts`
- **Jobs.** `POST /turns` saves the prompt as a queued user message and inserts a `turn_jobs` row; it returns the job id.
  - A worker claims the oldest runnable job with `FOR UPDATE SKIP LOCKED`.
  - A partial unique index allows one running job per project; a race on it counts as "not claimed".
  - A unique index on `user_message_id` stops the same prompt being queued twice (landing page auto-run, two tabs).
  - Follow-ups queue on the server in send order. The client sends one at a time: three quick sends raced and were queued out of order in the live test.
- **The lease is the only lock.**
  - The lease is renewed every 5 s and expires 30 s after the last renewal.
  - Claiming sets `projects.turnStartedAt`, so the revert route and the UI keep working. The final commit clears it.
  - `claimTurn` lost its 10-minute stale expiry; it remains only for direct runs (tests).
  - Every commit a job makes is fenced: one transaction checks `lease_owner` and `attempt` with `FOR UPDATE`. That covers creating the reply message, the memory commit, the setup save, every logged response and the final commit. A worker whose lease expired (a laptop that slept, say) can't commit beside the worker that took over. The plain setup writes before that (the user message's status, reading files) are idempotent.
- **Resume (user decision: option C), as a replay log rather than serialised loop state.**
  - **Setup is saved once:** the reply message, the conversation prefix (context text included, design references as asset ids), base files, asset names, contract options and the project's prior status. Setup is never redone on resume, so the memory call isn't billed twice.
  - **Each completed model response** (text deltas, tool calls, finish reason, priced usage) goes into `turn_job_calls` in the same transaction as its `usage_events` rows.
  - **A resumed run** rebuilds the setup and replays the logged responses through the unchanged loop, emitting nothing. Tools are pure workspace operations and checks are deterministic, so both simply run again. The model is called only after the log is used up, and a `snapshot` event then replaces the client's view.
  - **A crash mid-stream** leaves no log row and no usage row, so that call is asked again. The provider may still have charged for the lost call, and GoodBuild bills nothing for it; M6 should account for that.
  - **A diverged replay is detected.** Each logged response records the tier and conversation length it was made at. If a replay reaches a call where either differs (the code or a check result changed between attempts), it stops instead of feeding the response to the wrong step.
  - **The memory call** is committed with `projects.memory` in one transaction, so a crash between them re-runs it, never bills it twice.
  - **An unusable save** (another format version, a deleted design reference, a diverged replay) ends the job with a visible error and Retry. After 3 attempts a job ends with Retry too. The contract-test EVM uses a constant block timestamp, so checks replay deterministically.
  - **Why replay:** serialising every local of the loop (fix attempt, round, previous issues) was error-prone, while the replay keeps the loop as the single source of truth.
- **Final commit.** One transaction holds the checkpoint, the final message, design references marked as seen, the cleared lock and the job's end state. A job that crashed after it is finished, not run again.
  - `markAttached` moved from the start of the turn to this commit, so a stopped, failed or retried turn attaches the image again.
  - Step ids include the model-call number (`tool:<n>:<id>`): in the replay test, a provider reusing a tool call id overwrote an earlier step.
- **Stop (user decision).**
  - `POST /turns/[jobId]/stop` sets `stop_requested`; the lease renewal turns that into an `AbortController.abort()`. The signal reaches `model.stream`, and the runner checks it between rounds and before compile, tests and the final commit (solc and the test EVM can't be interrupted mid-run).
  - Every queued follow-up of the project is cancelled. Cancelled prompts stay in the chat with Resend.
  - Stop saves no checkpoint (edits discarded) and marks the message `stopped`. Usage already recorded stays.
- **Events.**
  - `turn_events` holds `(job_id, seq, event)`. The worker batches about every 200 ms and merges text deltas. The file map goes in once, at the end. An `end` marker closes the stream.
  - `GET /turns/[jobId]/events?after=seq` streams `id:`-numbered SSE (with `connection()` outside `try`), closes every 60 s, and the client reconnects with backoff.
  - Workspace state lists the active jobs; a reload attaches to the oldest and replays from the start. Events are deleted 2 minutes after the job ends; the message keeps the final record.
  - A queued prompt's message moves to the moment its turn starts, so each reply sits under its prompt.
- **Worker.** Started from `src/instrumentation.ts` (Node runtime only, skipped during `next build`, off with `GOODBUILD_INLINE_WORKER=0`) as a `globalThis` singleton that runs 3 jobs at once.
  - `pnpm worker` runs the same worker standalone for hosting where builds shouldn't run in the web process (Q31). It is tsx plus `scripts/worker-preload.cjs`, which stubs only `server-only`, and needs `DATABASE_URL`.
    - `--conditions=react-server` was tried first and broke it: it swaps `react` for its server build, so lucide-react's `createContext` crashed.
    - Verified live on Postgres beside the inline worker: with four projects queued at once, the inline worker claimed three, the standalone worker claimed the fourth project's two jobs one after the other, and no project ever ran two jobs at the same time.
    - The unique-index race (error 23505) never occurred, so that path is unit-only.
  - Both need a long-lived Node host: a serverless function can't keep a worker alive.
  - Dev gotcha: the singleton survives hot reload, so restart the dev server after editing `runner.ts` or `src/server/jobs/`.
- **Measured payloads (live, Postgres):** a one-page site's setup row was 14.9 KB, and its 11 logged responses were 16 KB in all (largest 2.1 KB) with 64 batched events. The contract build in the crash test logged 19 responses. Images are never stored, only asset ids.
- **Tests:**
  - `src/server/jobs/jobs.test.ts` runs a build with a fix pass, crashes it after every save point in turn, and resumes. It asserts identical files, record (apart from the resume log line), usage row count and model requests.
  - It also covers fencing, Stop with a queued follow-up, two prompts on one project, the unusable-save Retry and a tampered (diverged) replay.
  - A design reference is tested through crash and resume (the resumed call still carries the image), completion (marked seen) and Stop (left unattached).
  - Live results are in [evals/HARNESS.md](evals/HARNESS.md).

### P3. GoodDollar AI credits via AntSeed gateway behind LiteLLM (DEFERRED by D11)
- Status: deferred. GoodDollar/AntSeed is an optional future provider only, revisit once GoodDollar ships its proxy/API keys.
- Date: 4 Nov 2026 · Proposed by: Grok Bot · Users fund credits with the GoodWidget AI credits widget; GoodBuild runs an AntSeed gateway registered as an OpenAI-compatible LiteLLM provider, falling back to direct providers. Blocked on buyer-key custody / GoodDollar proxy (see [GOODDOLLAR_AI_CREDITS.md](GOODDOLLAR_AI_CREDITS.md), Q17).
