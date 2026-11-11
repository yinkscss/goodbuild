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
- **Changed by D31 (5 Nov 2026), by the user.**

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
- **Amended by D37 and D38 (6 Nov 2026):** the user pays Paystack's fee on top, so credit is no longer "minus Paystack fees", and the treasury batch is parked for this launch.

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

### D25. Hosting: one Docker image on Railway or Fly.io
- Date: 5 Nov 2026 · Decided by: user (Olayinka) · Resolves Q31's host question.
- A container running `next start` with a full install, plus `pnpm worker` as a second process, from one `Dockerfile`, with Postgres alongside. Nothing planned is serverless, because compiling contracts reads `node_modules` from child processes (HANDOFF.md).
- The publish packaging stays. The app host doesn't need it, but it keeps publishing generated apps independent of how the host installs packages.
- **Requirement Claude flagged:** neither Railway nor Fly sets a country header, and with none the geo-block lets everyone through (D10). Put Cloudflare in front, proxied, so it sets `cf-ipcountry`. Its proxy can also handle `*.goodbuildit.xyz`. The origin should only accept traffic from Cloudflare, or a visitor could reach it directly and skip the block. **UNVERIFIED:** each provider's current features; check before choosing between them.

### D26. Hosting: Vercel in front, Railway behind (amends D25)
- Date: 5 Nov 2026 · Decided by: user (Olayinka). Starts on the Railway trial; the user upgrades if it fits.
- **One origin:** the browser only talks to `goodbuildit.xyz`. Vercel renders pages and forwards `/api/*`, `/a/*` and published-app hosts to Railway on the server side, so cookies stay `__Host-` and first-party. Calling Railway directly from the browser would need cross-site cookies and open CORS.
- **Railway** runs everything that can't be serverless: compiling, publishing, uploads and turns. On the trial (1 GB per service, one-time $5 credit) it is one service with the inline worker, plus Postgres. Split into web and `pnpm worker` after upgrading.
- **Edge secret:** Railway's own address is public, so with `EDGE_SECRET` set it refuses every request without the secret. The edge overwrites `x-gb-edge` and `x-gb-host` on each request, so a visitor can't fake them.
- **Geo-block:** on Vercel only `x-vercel-ip-country` is trusted. This replaces D25's Cloudflare requirement: the edge applies the block, and the secret stops anyone going around it. Cloudflare isn't needed.
- **Vercel needs** `DATABASE_URL` (Railway's public address) because pages read Postgres, `DATABASE_POOL_MAX=2`, `SESSION_SECRET` and a region near Railway's.
- **Trade-offs Claude flagged:** two platforms and a database reached over the public internet, where one Railway service could serve everything. Wildcard domains need Vercel's nameservers, so DNS moves to Vercel. Vercel's Hobby plan is non-commercial only, so paid credits (M6) need Pro. Proxied requests time out at 120s on Vercel, so the turn event stream relies on its reconnect.

### D27. Launch on one VPS for the first month (replaces D26 for now)
- Date: 5 Nov 2026 · Decided by: user (Olayinka).
- For about 50 users and a one-month, paid-per-month start: everything on one VPS (iHostio; the owner holds written permission for blockchain and testnet work), with Postgres on the same box and Cloudflare in front. How it runs: [DEPLOY.md](DEPLOY.md).
- Contabo declined the owner's card, and iHostio is run by a friend and takes naira. Coolify stays installed for now by the owner's choice; only its proxy is used.
- Merging a pull request to `main` deploys to this server (user's request, 5 Nov 2026). The deploy key is stored as a GitHub secret.
- Vercel (D26) and Railway (D25) are on hold. The edge code stays, switched off without `BACKEND_ORIGIN`.
- **Trade-offs:** no failover, and backups live on the same server until copied off. Acceptable while credits are free; revisit before M6 takes money.

### D28. Free AI is capped at $0.20 for unverified accounts
- Date: 5 Nov 2026 · Decided by: user (Olayinka). Overrides CREDITS.md §6's "free credits never go to an unverified wallet".
- Each email and each wallet gets $0.20 of AI until it verifies with GoodDollar. One account is one wallet and Magic gives each email one wallet, so a single per-account check covers both. It counts the charged amount (cost + 25%, D13).
- Checked when a build starts and again when the worker picks it up. A build that starts under the cap may finish, so a project is never left half-written, which means an account can go over by up to one build. Live builds so far cost from about $0.02 to $0.35.
- Unverified accounts can only build on one project at a time, so parallel builds can't overrun the cap. Uploads and visual checks are stopped at the cap too.
- **Weakness Claude flagged:** new wallets are free to create, so this doesn't limit total spending by itself. Proposed: a global daily budget and a per-IP sign-up limit, waiting on the user.

### D29. Free AI stops at a total budget of $4
- Date: 5 Nov 2026 · Decided by: user (Olayinka), with $5 of AI credit in the provider account. Answers the weakness flagged in D28.
- Free AI stops for everyone once real provider cost across all accounts reaches `FREE_AI_BUDGET_MICRO` (default $4). The rest stays in the account so builds already running can finish. People see "The free trial is full right now." Set it to 0 to turn free AI off.
- Each build in progress holds back $0.35, about the dearest seen, so many builds at once can't overrun it. Queued builds count for new requests; the worker counts only the others running.
- It covers verified accounts, which are on free credit too. `UNCAPPED_WALLETS` stays exempt, but its spending still counts towards the total.
- **It counts all recorded spend, including before this decision.** After a top-up, or if earlier spend came from a different balance, raise the setting: new total = spend so far + what the new money should allow. Query: [DEPLOY.md](DEPLOY.md).

### D30. GoodDollar verification unlocks $0.50 more free AI, once per person
- Date: 5 Nov 2026 · Decided by: user (Olayinka). The amount is from CREDITS.md §5's proposal, raised from $0.50 total to $0.50 on top of the $0.20. Replaces D28's "no cap once verified".
- When an account has used its $0.20, the workspace asks it to verify. Total free AI for a verified person is then $0.70 (`VERIFIED_CAP_MICRO`), counted across every account with the same GoodDollar root, so linked wallets share it. D29's total budget still applies, and the prompt isn't shown when the trial is full.
- **Only the chain decides:** the server reads `getWhitelistedRoot` on GoodDollar's production Identity contract on Celo mainnet (`0xC361…2F42`). The result in GoodDollar's redirect is treated as a hint.
- Verification stays recorded after GoodDollar's own expiry, because it unlocks one fixed allowance, not ongoing access.
- **No SDK:** `@goodsdks/citizen-sdk` 1.2.7 needs wagmi and installs tsup at runtime. `src/lib/goodid.ts` rebuilds its short link code on `lz-string`, so the signed message must be kept in step with GoodDollar.
- **UNVERIFIED:** a real face check end to end, signing with Magic email wallets, and how GoodDollar reports a "Twin" (a face already verified on another wallet). The card links GoodDollar's guide to linking wallets for that case.

### D31. Generated apps get a persistent data backend (changes D3)
- Date: 5 Nov 2026 · Decided by: user (Olayinka), in their words: "multi tenacy database, project id, client id, wallet address, for things like authentication, we'll just use the connect wallet, and then store persistent data". Replaces D3's deferral to Season 5, and amends D8 ("app data lives on-chain") and D20 ("no backend or database"). Design and details by Claude: [APP_DATA.md](APP_DATA.md).
- **Tenancy:** `project_id` is the tenant and is only ever derived from the app's Host. `wallet_address` is the visitor and only ever comes from a signed session. `client_id` is a public id for the app: not a secret, and it authorises nothing.
- **Sign-in:** connect wallet only, with Sign-In with Ethereum, a single-use server nonce, and a session scoped to that one app that never touches GoodBuild's own cookie.
- **Store:** a small document store with no SQL, served from the app's own host. Collections are private to each wallet by default. `public-read` means anyone reads and only the writer changes.
- **On-chain still decides money and ownership.** The agent's guide says so. This store is for what doesn't need to be verifiable without trusting GoodBuild.
- **The preview uses a browser-only stand-in,** so it needs no CORS and preview data never reaches the real store.
- **Open for the user:** see "Decisions for you" on PR #19, and "Known limits" in APP_DATA.md. Merged on 5 Nov 2026. CLAUDE.md item 3 still says backend support is deferred, and the owner should update it.
- **Trade-offs Claude flagged:** GoodBuild now holds other people's data on one VPS with backups on the same server, which raises the stakes on D27's "revisit before M6". Apps stay on subdomains of the main domain, so same-site protections have to be built by hand (P19 noted a separate registrable domain would be stronger).

### D32. A project's first message plans before it builds
- Date: 5 Nov 2026 · Asked for by: user (Olayinka), to reduce how much a contract gets changed after the first build. The design below is Claude's, for the user to review.
- **What people see.** The first send gets a short reply and a card: one screen per question, one option recommended, always a free-text "Other", and "Skip, just build it" on every screen. Then one palette question, then a short summary with Start building. The Build and Plan toggle is unchanged for later messages. Planning also skips itself near the cap (below).
- **Who decides.** The turns route (`shouldPlanFirst`), so the landing page, home and the workspace all behave the same. It plans until something has been planned or a build was asked for, so "Try again" after a failed planning turn plans again, and "Try again" after a failed build stays a build. After two planning turns that end without questions (a provider failure, or a reply only in words) the next send builds, because those turns show no card and no Skip, and a broken provider or a model that won't call the tool would otherwise stop anyone reaching a build. Auto-fix and Try fix never plan, by their prompt text as well as the project's state.
- **Cost.** One call on the cheap tier (D19) with thinking off, a 2,400-character prompt instead of the full system prompt, the request only (no files, no history, no images) and one tool. Thinking off because `deepseek-flash` was measured spending all of 6,000 output tokens on reasoning (HARNESS.md). Output is capped at 1,500 tokens. A reply that can't be used gets fixed questions, not a second paid call. Answers and the summary use no model at all.
  - Calculated with `estimateTokens`, `costMicro` and `chargedMicro`, in `plan-first.test.ts`: **about $0.001 charged for a typical plan, about 0.5% of the $0.20**, and about $0.004 at worst (the longest prompt, the whole output limit and the project-name call). **UNVERIFIED:** no real model was called, so these aren't provider-reported numbers.
- **The cap (D28).** A person must not spend their free AI on planning and be left with nothing built. So planning needs $0.01 of room (`PLAN_HEADROOM_MICRO`), more than a plan's worst case. With less, the send goes straight to a build, which D28 lets finish. That way a plan can never be what stops the build after it. Answers stay saved if someone reaches the cap some other way, and Start building works again after verifying (D30). D29's total budget can still fill up between a plan and its build: they'd see "The free trial is full" with their answers kept.
- **No job while waiting (P18).** The question turn ends like any other. Each answer is a `PATCH /api/projects/[id]/plan` onto that turn's record, and a reload lands on the first unanswered question. Start building and Skip are ordinary build sends, so the runner, resume, billing and Stop are unchanged. There's no migration: the flag is on the user message's `meta`, the questions on the assistant message's `meta`.
- **Answers reach the build.** Every later turn's context gets a block of the person's answers (`planBrief`), because the rolling memory only sees message text. Words in answers also count for the G$ and CELO checks (D15).
- **Palette: curated, with the model only recommending one.** Six palettes in `src/lib/palettes.ts`, each tested for WCAG AA. Generated palettes would cost tokens and couldn't promise readable text. The server adds the question, so the model doesn't spend output on colours. The chosen one is written to the `@theme` block of `public/index.html` before the first build and written again after the model and any fix passes, so the design rule about choosing an accent can't undo it. Later messages can still change colours. The page's own colours now also live in the stylesheet (`@layer base`), because the preview's bundler drops the classes on `<body>`, which left dark text on a dark palette. "Other" goes to the model in the person's own words, and `ensureReadable` then fixes any text token below 4.5:1; colours not written as hex can't be checked.
- **The black build log and file chips are gone from the chat** (user's request). `record.log` and `record.changes` are still saved, the error card keeps its Logs, and the Code tab shows files. Step rows stay (DESIGN_SYSTEM §4), and now fold away when a turn ends well.
- **A typed message while questions are waiting** builds, with whatever has been answered. The composer's placeholder says so.
- **Real model check (5 Nov 2026, user approved):** two prompts on `deepseek-flash` with thinking off, a savings circle and a salon booking app. Both called the tool, asked plain questions with no jargon, and cost about $0.001 each. The booking app got no questions about money or wallets. Start building after the answers wasn't run with the real model.

### D33. Upgradeable contracts: a testnet-only trial, per project
- Date: 5 Nov 2026 · Decided by: user (Olayinka), after hearing the risks; the design choices below are Claude's and can be challenged. Amends P2 and the prompt's "Non-upgradeable" rule for projects that opt in, and nothing else. **Non-upgradeable stays the default.**
- **Goal:** when a change needs new contract code, keep one address so the app and its data carry on.
- **Testnet only:** the option is refused on mainnet at the server (toggle, prepare and record, keyed on the chain in the request), even with mainnet deploys switched on.
- **Transparent proxy, not UUPS.** UUPS keeps the upgrade gate (`_authorizeUpgrade`) in the implementation, which here is AI-written: a later version could weaken it or drop it, and neither the storage check nor the validator would notice. With OpenZeppelin's `TransparentUpgradeableProxy`, authority sits in a stock `ProxyAdmin`, and generated code never touches upgrades. Cost: a bit more gas per call and a bigger first deploy, which don't matter on a testnet.
- **Authority:** the proxy creates a `ProxyAdmin` owned by the user's wallet. GoodBuild holds no keys. To give it up, the deploy modal offers "Lock it" (`renounceOwnership`, asks twice, can't be undone), and `transferOwnership` works from an explorer. The chain is the record: GoodBuild reads the owner each time and stores nothing about it.
- **Two wallet confirmations, not one.** The accepted plan said one signature. With stock parts an upgrade is two transactions: deploy the new code (changes nothing), then `upgradeAndCall` (the only one that needs authority). A first deploy is also two per contract. One signature would need either a custom helper contract, which gives up "audited parts", or wallet batching (EIP-5792), whose support in Magic is UNVERIFIED. For the user to decide; see the follow-ups.
- **Constructors become `initialize`.** The manifest's `args` fill `initialize` by name, and it runs inside the proxy's creation transaction so nobody can get in first. Each implementation has only `constructor() { _disableInitializers(); }`. A contract whose code didn't change skips its upgrade. Changing manifest args later does nothing to a live contract, and there's no `reinitializer` in this trial: new variables start at zero.
- **Storage check: `@openzeppelin/upgrades-core` 1.48** (`scripts/upgrade-check.cjs`, a child process like solc). Chosen over comparing solc's `storageLayout` by hand: it also sees OpenZeppelin's named (ERC-7201) storage that solc's output leaves out, and it handles structs, enums, mappings and packing. Runs at prepare (before anything is signed), again at record, and in the agent's fix loop. The baseline is the layout saved when the live code was recorded.
- **Its limits, plainly.** It proves layouts stay compatible, not that the new code is right. It can't catch a variable that keeps its name and type but changes meaning (wei to basis points), or v2 logic that misuses or drains what's stored. It gates GoodBuild's flow only: the wallet owner can call their ProxyAdmin with another tool, and then the next prepare refuses because the live code isn't one GoodBuild recorded.
- **It trusts notes in the source,** such as `@custom:oz-retyped-from`, and the AI writes the source (tested: a retype with that note passes upgrades-core). So the build refuses every `@custom:oz-` note except the standard one on the sealed constructor.
- **Guardrails:** generated code still can't delegatecall. `Address.functionDelegateCall`, imports from OpenZeppelin's `proxy/`, and `Multicall` are now refused in every project (the first two were real gaps), and `StorageSlot` in upgradeable ones. The proxy is compiled from OpenZeppelin's source, outside `contracts/`, so its exception comes from where it lives.
- **A refused upgrade** says why in plain words and offers a normal new deploy at a new address (with the usual "replaces" notice and old-funds card) or asking the builder to keep the data.
- **No paris fallback to OpenZeppelin 5.1 for these projects:** 5.1 and 5.6 differ (5.6 has no `ReentrancyGuardUpgradeable`), and the check can't vouch for an upgrade across them. `ReentrancyGuard` from 5.6 is allowed by name even though it has a constructor; it's marked stateless, and the EVM test shows re-entry is still blocked through the proxy.
- **Label:** published apps of these projects show "This contract can be changed" in the GoodBuild bar until the contract is locked. A published app is a snapshot, so locking removes the label only after publishing again. Until then it errs towards warning.
- **Follow-ups, not built:** a delay before upgrades take effect (OpenZeppelin `TimelockController` as ProxyAdmin owner; skipped because testnet funds aren't real and it adds a third transaction); EIP-5792 batching; an upgrade history view; a way to set new variables during the switch.
- **UNVERIFIED on Celo Sepolia:** all of it. It's proved in a local EVM only. Steps for the live test are in HANDOFF.md.

### D34. Each app's builder writes its data rules; forms work without a wallet
- Date: 6 Nov 2026 · Decided by: user (Olayinka) chose "rules, then email" over AI-written SQL. Design by Claude, reviewed by the advisor.
- **Why not SQL:** Lovable's generated SQL runs in a separate Supabase database per project. GoodBuild's apps share one database, so one bad AI-written query or policy could cross tenants. The builder writes a declarative rule per collection instead, and one server enforces every app's rules (APP_DATA.md).
- **Roles:** anyone, signed-in, writer, owner. Owner is the project owner's wallet, from GoodBuild's own records. Settings: create, read, update, delete, public fields, field types, unique fields. `private` and `public-read` keep their exact meaning, and the existing attack suite passes unchanged.
- **Forms without a wallet:** `create: "anyone"` takes entries from visitors who don't sign in, with an anonymous per-app id, tighter rate limits and a separate cap per app.
- **Owner's view in GoodBuild:** the Backend window lists entries the owner may read, with delete and a CSV download that escapes formulas. It uses GoodBuild's sign-in, so email-wallet owners can use it.
- **Saved grants:** a record is never more visible than the rule it was saved under (migration 0008 adds `access`).
- **Not built:** owner edits of visitors' records (replies, "confirmed"), staff readers, email alerts, Turnstile on busy forms, email sign-in for visitors (next PR).
- Terms and Privacy updated: owners can now read what visitors send them, where the form says so.

### D35. Email-code sign-in for app visitors
- Date: 6 Nov 2026 · Decided by: user (Olayinka): "Email sign-in", after GoodBuild's Magic account couldn't be shared with published apps. Provider: Resend (the user created the account, verified goodbuildit.xyz and put the key on the server). Design by Claude, reviewed by the advisor.
- **Opt-in per app** (`"signIn": {"email": true}` in dataRules.json), so no app can be used to send email unless it asks for sign-in.
- **A random id per app and address** (`email:<uuid>`), never derived from a rotatable secret and never shown to others. Email visitors are `signed-in`, never `owner`.
- **Abuse:** codes are counted per IP, address, app and the whole site, in the database, plus a daily cap on wrong guesses per address. The attempt count is atomic. Refusals are honest (429, 502 or 503).
- **Not built:** bounce handling, Turnstile, merging an email identity with a wallet. Details: APP_DATA.md.

### D36. Generated apps get GoodBuild's own wallet layer: a wallet list, WalletConnect and MiniPay
- Date: 6 Nov 2026 · Decided by: Claude, from the task the user's session set ("give apps proper wallet connection"), reviewed by the advisor. The user can change any part.
- **Problem:** generated apps only read `window.ethereum`. On a phone in Chrome or Safari visitors saw "No wallet found", and with several extensions the app silently used whichever one took `window.ethereum`.
- **What apps get:** `src/lib/goodbuild/` (wallet.ts, walletChooser.tsx, walletConnect.tsx), owned by GoodBuild like the data helpers (D34). The builder can't write, edit, delete or rename anything there, or add a file that an import would resolve first (`src/lib/goodbuild.ts`, `wallet.tsx`). The same shadowing hole in `src/lib/db.ts` / `useDb.ts` (a `db.tsx` would win) is closed too. Every turn and every publish writes the current copy.
  - EIP-6963 discovery, with `window.ethereum` as one more choice when it doesn't announce itself. A small accessible list (focus, Escape, Tab loop) styled with the app's own theme tokens. One browser wallet and nothing else: no list.
  - MiniPay (`window.ethereum.isMiniPay`) connects on page load with no list.
  - WalletConnect in published apps: a QR code on a computer, and on a phone a button per wallet (MetaMask, Valora, Trust Wallet, Rainbow, "Other wallet" with the plain `wc:` link). The last wallet reconnects silently on the next visit.
  - `connectWallet`, `writeContract`, `useWallet` and db.ts `signIn` keep their names and shapes, so existing code works. `useWallet` adds `walletName` and `disconnect`; chain.ts adds `disconnectWallet` and `walletProvider`.
- **WalletConnect without its modal:** `@walletconnect/ethereum-provider` 2.26.0 with `showQrModal: false`. The app draws its own QR (`qrcode.react`, already allowed) and links, so Reown AppKit is stubbed out of the bundle and the CSP needs no outside images, fonts or scripts. Only GoodBuild's module may import the package (`PLATFORM_DEPENDENCIES`); the builder can't.
- **Preview vs published:** the project holds a stand-in `walletConnect.tsx`. Publishing swaps in the real module (`src/server/publish/walletconnect-module.ts`) and adds a `goodbuild-walletconnect` meta tag with `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, read at run time. esbuild now splits code, so WalletConnect is a chunk fetched only when a visitor picks it or returns to a WalletConnect session. The Sandpack preview never bundles WalletConnect and offers browser wallets only (its origin isn't on the allowlist anyway).
- **CSP:** one change, `frame-src 'self' https://verify.walletconnect.org`, because `@walletconnect/core` 2.26 loads Verify's attestation in a hidden iframe from that host (read in the package source). Relay, RPC and pulse are covered by the existing `connect-src https: wss:`. `script-src` stays `'self'`.
- **Older projects:** chain.ts, useWallet.ts and ConnectButton.tsx never changed before D36, so a copy whose sha256 matches the old text is untouched and is replaced with the new one, but never only some of them. chain.ts and useWallet.ts move together: if the builder edited either on the old path, all three stay on `window.ethereum`, so the wallet shown and the wallet that sends can't differ. An edited ConnectButton stays and works with the new hook. db.ts `signIn` is always on the layer, so in an app that stayed on the old path, data sign-in can still open the list and use a different wallet from its contract writes. A new check refuses `window.ethereum` in any other app file and points to `walletProvider()`. It runs on builder turns, not on publish.
- **Bundle:** the starter app with a connect button, a contract write and data sign-in, built by the publish path: initial JS 534.0 KB raw / 166.5 KB gzip before, 538.9 KB / 173.4 KB gzip after (sum of the 9 files the page loads up front). WalletConnect adds 461.7 KB raw / 140.2 KB gzip, fetched only on demand.
- **Changing your mind:** WalletConnect 2.26's `abortPairingAttempt` does nothing (read in `@walletconnect/universal-provider`), so the module counts attempts itself. If a wallet approves a link the visitor closed or went Back from, the session is disconnected and the app stays signed out. Looking at the list and closing it downloads nothing.
- **Sign-in and the wallet:** `useDbSession` ends a wallet sign-in, on the server too, when the connected account switches or disconnects. It doesn't while no wallet has connected yet, because the session cookie outlives the page. An email sign-in (D35) isn't touched by wallet changes.
- **Without a project id:** no WalletConnect in published apps. They offer browser wallets and MiniPay, and a phone browser with no wallet still says "No wallet found". The id is read when an app is published, so apps already published get WalletConnect only when republished.
- **Not verified (UNVERIFIED):** a real relay handshake, a real phone scan, the phone deep-link formats, bringing the wallet app forward for each request on a phone, reconnecting a WalletConnect session on a later visit, a wallet approving both an old and a new link (dropping the old session could also end the new one), real MetaMask, and MiniPay itself. See HANDOFF.md.

### D37. M6 and mainnet launch together; TOPUPS.md §10 defaults accepted (amends D21)
- Date: 5 and 6 Nov 2026 · Decided by: user (Olayinka): "I need to get this on mainnet, that would require M6 to begin." Claude recommended M6 first and the user chose together. D36 is claimed by open PR #32 (wallets), which should merge first. Plan: [MAINNET_PLAN.md](MAINNET_PLAN.md).
- **One launch:** paid credits and Celo mainnet ship together. Paystack has test keys only so far.
- **Rate:** from a named public source with a 2% spread. Which source is still open.
- **Fees:** the user pays Paystack's fee on top, so credit matches the amount shown. This changes D21's "minus fees".
- **Email:** collected at top-up for wallet-only users.
- **Admin:** a wallet allowlist.
- **Refunds:** credits are non-refundable except for failed or disputed payments. The wording needs a lawyer before real money.

### D38. Paystack buys AI credits only; treasury batch and G$ vault left out of this launch (amends D13, D21, D24)
- Date: 6 Nov 2026 · Decided by: user (Olayinka).
- Paystack buys AI credits, and those credits only pay for builds. There is no naira to crypto conversion at launch, so the treasury batch (D21, D24) is parked. Paystack money can never fund gas.
- The G$ vault is left out of this launch, so credits show in USD only until it exists.
- **Cost, for the owner to see, not blocking:** ROADMAP.md promises G$ payment "live from M6" and scores G$ volume and transactions per user (S5 criteria UNVERIFIED). Those numbers get nothing from credits until the vault ships.

### D39. What GoodDollar verification does
- Date: 6 Nov 2026 · Decided by: user (Olayinka). Replaces Claude's proposed "verified or paid" for mainnet.
- Verification gives extra free credit (D30). Paying customers don't need it to buy or use credits.
- Mainnet always needs it, including for paying customers.
- Checked by the coordinating session on 6 Nov: face verification costs no gas. It's a signMessage (citizen-sdk 1.2.7), and GoodDollar registers verified addresses on all active chains. So gas pays for deploying, and verification comes first.

### D40. A Sepolia and mainnet toggle per project
- Date: 6 Nov 2026 · Decided by: user (Olayinka).
- The flow: toggle, verify if needed, gas grant, AI review, typed confirmation, deploy.

### D41. Gas grant: up to 1 CELO, once per person, sent automatically
- Date: 6 Nov 2026 · Decided by: user (Olayinka). Design and red team: [MAINNET_PLAN.md](MAINNET_PLAN.md) section 7.
- A dedicated wallet the owner funds in small amounts tops the signed-in wallet up to 1 CELO, once per GoodID root, with a global limit of 20 grants a day. Past the limit, or when gas runs out, people are pointed to the owner's Telegram, a setting the owner fills in later and hidden until set. No new Telegram bot: owner alerts go by email through Resend.
- This is GoodBuild's first hot key. It is not a user key or a deploy key: deploys stay signed in the user's own wallet (D2, CLAUDE.md rule 8).
- It covers the builder only. Visitors using a mainnet app need their own CELO and G$.

### D42. AI review by DeepSeek before a mainnet deploy
- Date: 6 Nov 2026 · Decided by: user (Olayinka), who chose DeepSeek over Sonnet. Design: [MAINNET_PLAN.md](MAINNET_PLAN.md) section 8.
- It checks for vulnerabilities and whether the contract matches the brief. High-severity findings or a brief mismatch block the deploy, with a Try fix button and an owner-only override for wrong findings.
- It's an AI review and is never called an audit. "Unaudited, may lose funds" and the typed confirmation stay. Nobody has yet shown DeepSeek catches anything, so a benchmark comes first.

### D43. An app that receives payment is a web3 app
- Date: 6 Nov 2026 · Decided by: user (Olayinka).
- If an app needs to receive payment, it becomes a web3 app, and the builder tells people mainnet can be deployed if they're sure everything is ready and want to receive real money. Where that lives: [MAINNET_PLAN.md](MAINNET_PLAN.md) section 9.

### D44. Launch defaults accepted; gas after the review; how credits are funded
- Date: 6 Nov 2026 · Decided by: user (Olayinka). Answers section 13 of [MAINNET_PLAN.md](MAINNET_PLAN.md): every recommendation there is accepted.
- **Order changed:** toggle, verify if needed, AI review, gas grant, typed confirmation, deploy. The review comes before the grant, so nobody gets gas for a contract the review would block. This replaces the grant-then-review order in D40 to D42 and the plan.
- **Benchmark approved:** up to $1 of real DeepSeek spend for the review benchmark.
- **Legal and Paystack:** the owner states these are cleared, on the basis that GoodBuild sells usage only. Claude hasn't seen a written answer. The legal pages' "not reviewed by a lawyer" banner stays until a lawyer has actually reviewed them.
- **Funding, proposed by Claude:** Paystack settles naira to a bank account, the owner buys dollars weekly through a virtual dollar card or a similar service, and pays the AI providers from it, keeping about one month of bills ahead. Credits are priced from the official NFEM rate plus 2%, with a floor the owner sets in admin so the price never falls below what dollars really cost. Worked example, using 6 Nov rates and an assumed cost of about N1,425 per dollar (UNVERIFIED): a $1 credit brings in about N1,376 and costs about N1,140 of AI at cost plus 25%, leaving about N236, or 17%, before free AI, gas and hosting. Which provider works with Anthropic and DeepSeek is UNVERIFIED, so test with a small amount first.

### D45. Checks before every deploy, and tagged images for rollback
- Date: 6 Nov 2026 · Decided by: Claude, building step O1 of the launch plan for the user's session, reviewed by the advisor.
- **Gate:** `ci.yml` runs on every pull request, and `deploy.yml` calls it as a job that the deploy job needs. So the commit that ships is the one tested, and a failure there skips the deploy, with no GitHub setting involved. The trigger moved from a merged pull request to a push to `main`, because a merge commit doesn't exist until the merge. **A direct push to `main` now deploys too,** where before it didn't. The branch rule stops direct pushes.
- **Not `workflow_run`:** it only fires from the default branch's copy, so it can't be exercised on a pull request, and it runs separately from the commit it deploys.
- **The lock covers the whole Deploy run,** checks included, so an older commit whose checks finish late can't overwrite a newer one.
- **Branch rule:** it adds that a failing pull request can't merge. Only the owner can set it (DEPLOY.md). Without it, a failing commit can still reach `main`, but it doesn't deploy.
- **Docs filter:** Deploy skips pushes that only change `docs/`, which `.dockerignore` leaves out of the image. It's on the Deploy push and not on pull requests, since a required check that never reports blocks the merge. `src/server/agent/assets.test.ts` reads a file in `docs/`, so docs pull requests still need their checks. Root `*.md` files go into the image, so they aren't filtered.
- **Rollback:** the compose file still runs `goodbuild:latest`, and rolling back moves that tag. Passing a tag through an env var was rejected: the documented `up -d` would then silently undo a rollback. `release.sh` moves `previous` only after a build succeeds, so a failed build can't lose the way back. Migrations only add, in ways old code can still write to, because a rollback can't undo one (DEPLOY.md).
- **Remaining bypass:** `deploy/deploy.sh` by hand skips the checks, kept for when GitHub Actions is down.
- **Not verified (UNVERIFIED):** rollback on the production server and disk use per image. The scripts are tested on real Docker in CI only.

### D46. The credits ledger (M1): append-only entries, a checked balance, money records that outlive deletes
- Date: 6 Nov 2026 · Decided by: Claude, building step M1 of the launch plan for the user's session, reviewed by the advisor. Numbered D46 because PR 33 takes D45.
- **Tables (migration 0010):** `ledger_entries` (kinds `deposit`, `usage`, `refund`, `adjust`; integer micro-USD; unique `idempotency_key`; `balance_after_micro` on each row) and `balances`, a cached sum per user. `usage_events` and `turn_jobs` get `funding` (`free`, `paid`, `exempt`, `platform`), default `free`, so every existing row is free and the free counters and the $4 total read the same. A test migrates a database at 0009 with rows to 0010 and compares them, on PGlite and real Postgres.
- **Single entry per user, not double entry** as CREDITS.md section 3 says. There's no counter-account; the provider side is reconciled in M7. `bonus` and `free_tier` kinds are dropped: free AI is counted from `usage_events` (D28 to D30) and never enters the ledger. `balances.reserved_micro` waits for holds in M3.
- **Enforced by the database, not just the code:** triggers refuse UPDATE, DELETE and TRUNCATE on `ledger_entries`, and DELETE and TRUNCATE on `balances`. A deferred constraint trigger refuses to commit any change where a user's balance differs from the sum of their entries. Checks tie each kind to its sign.
- **Going below zero:** a debit that would take a balance below zero is refused and writes nothing. `allowNegative` lifts that for `usage` and `adjust` only, for costs already incurred or a chargeback already taken. A `refund` never goes below zero. A credit is always accepted, even if the balance stays negative. Blocking builds while negative is M2 and M3's job.
- **Concurrency and replay:** one user's posts are serialised by a row lock on their `balances` row. The same key posted again returns the first entry and changes nothing; the same key with different details, or another user's key, is refused as a conflict.
- **No cascade delete on money records.** `ledger_entries` and `balances` reference users with RESTRICT and never reference projects. `usage_events.user_id` changes from CASCADE to RESTRICT, so **a user with any usage can no longer be deleted.** No app code deletes users today, so nothing visible changes, but a future "delete my account" must anonymise instead: an owner decision. Deleting a project still works and sets `usage_events.project_id` to null as before. A trigger refuses to delete a `paid` turn job, which refuses the delete of its project or user. Clearing an app's data (owner clear and takedowns, `deleteProjectData`) touches no money record.
- **Open for M2:** nothing yet stops `funding` being changed from `paid` to `free` before a delete, which would get past that trigger. Section 5 says a job keeps one source for life, so M2 should make it unchangeable.
- **No visible change:** `getCredits` reads the real balance as `balanceMicro`, which nothing displays. `balanceGd` stays null so the pill keeps saying the beta is free. No code posts entries yet, so every balance is zero.

### D47. Encrypted off-site backups every hour, with a restore drill
- Date: 6 Nov 2026 · Decided by: Claude, building step O2 of the launch plan (decision 8 in MAINNET_PLAN.md section 13, accepted by D44), reviewed by the advisor. **The owner still picks the destination** and creates the account. Setup and drill: "Off-site backups" in DEPLOY.md.
- **age with the owner's public key,** not restic. Restic needs its repository password on the server, so anyone who takes over the server could read every old backup. With age, the server can only encrypt. The private key stays with the owner.
- **Plain `curl --aws-sigv4`** for the bucket, not the aws CLI or rclone. curl is already on the server, and the key reaches it on stdin.
- **Retention by the bucket's lifecycle rules,** not the script: 48 hours of hourly copies, 30 days of dailies. The server's key then only needs to write, so a server that's taken over can't delete the off-site copies.
- **Figures in the same snapshot.** `pg_dump --snapshot` reads one exported snapshot, and the row counts and ledger totals are taken inside it. A restore must then match exactly, not roughly.
- **Recommended destination: Backblaze B2,** for its write-only keys. Cloudflare R2 is the alternative, already the DNS provider, with free downloads. Prices, card requirements and key scopes are UNVERIFIED.
- **Alert: a healthchecks.io dead-man switch** (1 hour period, 1 hour grace), not Resend. A check on the server can't report the server being down. Email through Resend for other alerts is left to O3, along with:
  - a check that reads the bucket's newest copy independently, since the ping only proves the script said it succeeded;
  - disk space.
- **The nightly local backup stays,** for fast local restores.
- **Tested in CI** (`deploy/test-offsite-backup.sh`), with real Postgres, age and MinIO. Not yet against B2, R2 or the server.
- **Risk:** the MinIO stand-in is Bitnami's archived image, since MinIO's own images are gone. If it disappears, the required check fails and blocks deploys until it is swapped for a maintained one, such as versitygw or rustfs.

### D48. Free and paid AI counted apart (M2); each job keeps one funding source (amends D29)
- Date: 6 Nov 2026 · Decided by: Claude, building step M2 of the launch plan for the user's session, reviewed by the advisor. Follows MAINNET_PLAN.md section 5 and owner decisions 3 and 5 (accepted by D44).
- **What uses up free AI.** A person's free allowance ($0.20, or $0.70 once verified, D28 and D30) counts only `free` usage. The $4 total (D29) counts `free` and `exempt` usage, and holds $0.35 for each queued or running `free` or `exempt` build. `paid` and `platform` usage (the AI review, decision 3) never touch free AI. Every row before M2 is `free` (D46), so today's totals don't move.
- **Exempt counts towards the $4, which the brief for this step said it shouldn't.** The brief said only `free` counts. D29 (the owner's) and plan section 5 say exempt spending still counts, and it comes out of the same provider balance the $4 protects. Not counting it would also have changed today's decisions, so D29 was kept. **For the owner to confirm.**
- **Each job's funding is decided when it's created** (`enqueueTurn`, through `decideFunding`) and stored on `turn_jobs`. Every usage row of the turn takes the job's funding, including the project-name call. AI calls outside a turn (describing an upload, the visual check) decide it when they run. `UNCAPPED_WALLETS` gives `exempt`, everyone else gets `free`. The worker's start check goes by the stored funding, not its own settings, so an exempt job still runs on a worker started without `UNCAPPED_WALLETS`. It also means a wallet removed from `UNCAPPED_WALLETS` still runs its already-queued jobs as exempt: **for the owner to confirm.** `recordUsage` now requires `funding`.
- **A paid balance unlocks nothing until M3.** Free comes first (decision 5), and M2 never creates a `paid` job, because nothing can debit yet. So someone with credit at the free limit gets the same refusal and message as before. A `paid` or `platform` turn job, which only a hand-written row could make, is refused at start ("This build can't start yet"). This defers plan section 5 item 4 (payers see "You're out of credits") to M3 and M8, when paying can actually unlock a build.
- **Funding can't be changed once set.** Migration 0011 adds triggers that refuse an UPDATE changing `funding` on `turn_jobs` or `usage_events`. Writing the same value is allowed. This closes D46's open point: a paid job can no longer be switched to free and then deleted past `turn_jobs_keep_paid`. Tested on PGlite and real Postgres 16.
- **No change for users, proved by test.** `funding.test.ts` runs the code from before M2 (kept as a frozen copy, `cap-before-m2.ts`, for tests only) beside the new code over 40 seeded scenarios at every boundary: each cap to the micro, the $4 total, and the $0.35 holds. Every check, plan headroom and verification offer agrees, on PGlite and real Postgres. The messages and amounts are unchanged. The one intended difference: an exempt wallet's own usage no longer counts as its free spend, which matters only if it later stops being exempt.
- **Not fixed, and not new (UNVERIFIED, from reading the code, no test ran it):** the turns route checks the allowance before queueing, outside any lock, so turns sent at once by one person on different projects can each pass the check before any is queued. The worker's start check doesn't catch it either, since nothing is spent yet. It was there before M2, and D28 already lets a build finish over the cap. M3 should take the user's `balances` row lock around the check, the hold and the queueing, in the ledger's lock order.
- **Owner confirmed, 6 Nov 2026 ("accept defaults"):** exempt keeps counting towards the $4; already-queued exempt jobs stay exempt after a wallet is removed from `UNCAPPED_WALLETS`; payers see the existing free-limit messages until M3 and M8; M3 takes the `balances` row lock around the check, the hold and the queueing.

### D49. Holds and charging for paid credit (M3); a cheaper ledger check (amends D46, D48)
- Date: 6 Nov 2026 · Decided by: Claude, building step M3 of the launch plan for the user's session, reviewed by the advisor. Follows MAINNET_PLAN.md section 5. Nobody can buy credits yet, so this changes nothing anyone sees until M4 to M8.
- **Free first, then paid.** Starting a build: exempt goes ahead, free if there's free room and budget, otherwise paid if `balance - reserved` covers the minimum, otherwise refused. A job's funding stays fixed (D48).
- **One step under one lock.** `startTurn` does the check, the hold and the queueing in one transaction, holding a lock on the user's `balances` row. The turns route uses it. This also closes the gap D48 flagged for free builds: starts sent at once on different projects can no longer all pass one-project-at-a-time. That is the one change a free user can see, and only if they send two at the same instant. The lock makes a `balances` row, with zero in it, for anyone who starts a build.
- **The hold lives on the job.** `turn_jobs.hold_micro` is what's set aside, and `balances.reserved_micro` is its total per user, kept by a trigger in migration 0012, not by app code. The balance moves only when a charge is posted, so holds can't make it disagree with the entries. A hold is refused by the database if it would reserve more than the balance.
- **$1 target, $0.35 minimum.** D29's $0.35 is too low as a paid hold: it's "about the dearest build" and D19 records a $0.50 one. The plan's $1 is twice that. But a check before each call is what keeps spending safe, so the hold's size only decides how many builds a balance can run at once. A $1 minimum would be wrong: a smallest top-up of about N1,000 (decision 7) may buy less than $1 (rate UNVERIFIED) and couldn't start a build. So: `min($1, free credit)`, refused below $0.35. In numbers, $0.35 covers one strong call with the full 16,000 output tokens and about 60,000 input tokens, or about 120,000 characters at the 2 a token used for the worst case. The first context is up to 40,000 characters, but a late fix call carries the whole conversation and can need more. The build then stops safely, so that's about usefulness, not money, and whether it covers real late fixes is UNVERIFIED. Both are settings (`PAID_HOLD_MICRO`, `PAID_MIN_START_MICRO`), and **the $1 needs checking against real paid builds (UNVERIFIED).**
- **Before every live model call** on a paid job, the runner checks the hold covers the most that call could be charged, extending it exactly enough from free credit, or stops the build. It wraps the model client, so the build, fix and wrap-up calls, the memory call and retries can't miss it, and replays never reach it. Worst case: every input token uncached at 2 characters a token, the full output limit, plus 25%. Free and exempt jobs get the plain client, with no extra commit.
- **Charging.** `recordUsage` inserts the usage row and posts the debit in one transaction, and only if the row was really inserted. The key is `usage:<callId>`. It posts with `allowNegative`, because the cost is already incurred and refusing would roll back the saved response and pay the provider again on resume. The charge comes out of the hold first. Lock order everywhere: job row, then usage row, then balance.
- **Release, once, however a job ends.** Leaving `queued` or `running` moves what's left to `released_micro` in the same trigger, so no ending path can forget it, and a finished job's hold can never change. This covers finished, failed, stopped, cancelled, crashed past `MAX_ATTEMPTS`, and rollback to old code, whose worker refuses paid jobs and so ends them.
- **Regular check, every minute on the worker (`checkHolds`).** Ends paid jobs still holding credit if their lease expired over 30 minutes ago, they've been queued over 6 hours, or they started over 3 hours ago. Corrects `reserved_micro` if it has drifted from the open holds, and logs it. Live jobs and free jobs are never touched. **There was no time limit on a build before this:** a worker renews its lease however long the model takes, so "timed out" meant nothing until the 3 hours, which applies only to paid jobs holding credit. The first check runs a minute after the worker starts, so crashed builds get to resume first.
- **Calls outside a build** (uploads, visual check) have no job to hold against. They're free first, then paid if free credit covers one such call ($0.05, tested to cover the dearest), and debit directly. Several at once can take a balance slightly below zero, which plan section 5 item 6 writes off. **The project-name call** charges the build's hold with no check of its own: about a tenth of a cent, with at least $0.35 set aside.
- **Messages.** Anyone with a deposit sees "You're out of credits", or "Your credit is set aside" if the balance would cover it but it's all held, never a free-limit message at build start. This delivers what D48 deferred. A free job overtaken by the free limit while queued can't become paid, so someone with credit is told to retry, and the retry runs on credit. Everyone else gets today's words.
- **The ledger check is cheaper and no weaker (amends D46).** It summed a user's whole history at commit, once per entry and per balance change, under the balance lock, and M3 would have added one more for every hold change. Now each new entry must equal the entry before it plus its amount, and the balance must equal the latest. Entries are append-only, so by induction that equals the sum, reading a few index rows however long the history is. It's stricter in one way: `balance_after_micro` wasn't checked before. An entry slipped in earlier than the latest also fails, because the entry after it is checked too. Changing only `reserved_micro` runs no check. Measured on Postgres 16 with 100,000 entries: commit 30 ms before, 2.7 ms after. All M1 tamper tests still fail as they should, and M7 can still sum everything as a second look. The migration refuses to run if existing history isn't a correct running total.
- **Tested** on PGlite and real Postgres 16: `holds.test.ts`, `holds.equivalence.test.ts` (the code from before M3, frozen in `cap-before-m3.ts`, beside the new code over 40 seeded scenarios for free-only users) and `holds.migration.test.ts` (a seeded database at 0011, migrated, with totals compared). CI runs PGlite only, so **the race tests run only with `TEST_DATABASE_URL` set locally.**
- **Known limits.**
  - A reply naming a model missing from the price table is billed at the strong price, which can pass the estimate by up to one call. The charge is posted and the next check stops the build. Today's reported model ids are UNVERIFIED against live providers.
  - Thinking counting inside the output limit is measured for DeepSeek (HARNESS.md, not re-run) and UNVERIFIED for Claude.
  - Calls lost in a crash still bill nothing (P18, plan section 5 item 7).
  - A paying user near their free limit skips the plan-first questions, because `hasPlanHeadroom` looks only at free AI. They go straight to a build.
  - The D29 race across different users isn't touched: it's a global total, and this lock is per user.
  - `stopProject` cancelling two or more queued paid jobs holds the balance lock between job rows, so it can deadlock with `checkHolds` ending one of those same jobs (found by reading the code, not seen in a test). Postgres aborts one side, nothing is half-done, and the next check or a second Stop finishes it. It needs a queued paid job over 6 hours old and a Stop at the same instant, so it's left as is.
- **Where this differs from the docs.** **Migration 0012 doesn't only add, which plan sections 4 and 10 ask of launch migrations:** it drops the two M1 triggers and their function, and replaces them with the running-total check. It was done because keeping the sum alongside would keep the cost it removes, and the replacement is stricter. Old code never names the dropped function, so a rollback keeps working, as a test shows, with the new check still in place. **For the owner to confirm.** The purely additive alternative is to narrow the old balance trigger to `OF balance_micro`, keep the sum, and add the chain check beside it, at about 30 ms a commit per 100,000 entries. Plan section 5 item 5 says a stopped build "keeps what's saved", but the runner saves nothing from a build that doesn't finish, so a build stopped for credit discards its edits and says so. It ends as `error`, not through the abort the plan mentions, because that path tells the user they stopped it themselves. Plan section 5 item 6 says project names debit directly. Here they go through the build's hold, so the release can't hand back what they spent. All usage still has one debit point, `recordUsage`. CREDITS.md section 4's mid-stream cutoff and capping `max_tokens` from the balance aren't built: the worst-case check before the call replaces both.

### D50. The mainnet switch is a database setting read on every prepare (C1; amends D33's gate, MAINNET_PLAN.md section 6)
- Date: 7 Nov 2026 · Decided by: Claude, building step C1 for the owner's session, with the owner's brief (D40 to D44). The owner chose "a small settings table or an env var, whichever is safer and simpler"; this is the table.
- **What was wrong.** `NEXT_PUBLIC_ENABLE_MAINNET` is inlined at build time, in the server bundle too, and compose never passed it to the build. So a switch could only be turned on or off by a rebuild, and `assertChain` used it for prepare and record alike, so turning it off would also have refused to record a transaction already signed and sent.
- **The switch.** Table `app_settings` (migration `0013`), one row, key `mainnet_access`, value `off`, `admins` or `everyone`. Read by `getMainnetMode` on each prepare. **Default off.** A missing row, a misspelled value, or a read that fails all mean off. `admins` means a wallet in `ADMIN_WALLETS` (server env, comma separated, trimmed, lowercased, malformed entries dropped; empty means nobody). The decision uses the session's wallet only: nothing in the body, headers or cookies reaches it, and both routes now put the session's fields after the body's.
- **Why the table and not an env var.** An env var is read at request time too, but changing it means editing `.env.production` on the server and recreating the containers, which is the slowness the owner asked to remove, and a kill switch should be one statement. A table also records who changed it and when. The cost is a migration (additive, so an older image keeps working: it ignores the table and its own flag is unset, so mainnet stays off) and one read per prepare. Changing it is `psql`, or `PUT /api/mainnet` as an admin; the M9 admin page can use the same reader.
- **Prepare versus record.** `assertChain` now only says whether a chain is supported, and the record path uses only that. `assertMainnetAccess` is the switch and runs only at the start of `prepareDeploy`. So turning it off stops new mainnet prepares, and a mainnet transaction that was signed before the switch moved is still recorded, as are verification, the old-funds card and withdrawals. D33 stays: upgradeable contracts are refused on 42220 at toggle, prepare and record, and the proxy trial tests are unchanged and green.
- **New projects.** `createProjectFromPrompt` starts a project on mainnet only if the switch lets that wallet; otherwise it falls back to Sepolia, as it did with the flag off. Step T replaces the prompt-box network choice.
- **The client** asks `GET /api/mainnet` for a yes or no for the viewer (never the raw setting, except an admin sees it), `no-store`, failing to no. The wallet pill and network badge follow the open project's chain (`expectedChainId`/`chainId` props, Sepolia where there is no project), not any flag. The copy says what is true: "Mainnet isn't open to your account yet" when it's off for you, and a real-money and unaudited note when it's on.
- **Not done here.** C2 now makes generated and published apps follow their project's chain, but the per-project toggle and flow (T), fund-safety checks (C3), AI review (R1/R2), and gas grant (G1) remain. C1 alone does not check GoodDollar verification. **`everyone` must not be set before those gates are implemented and tested.**
- **Plan versus code.** The plan says C1 "adds the build arg". Not done: a build arg would keep the flag unchangeable without a rebuild, which is the problem. The plan row also said to test what server code sees after a build (UNVERIFIED); the build output was checked instead, see HANDOFF or the PR notes. The plan lists C1 as depending on M9 (admin page); it doesn't, because `ADMIN_WALLETS` is only an env list here and the PUT route is the whole admin surface.

### D51. GoodBuild Credits (GBC), our own token on Celo mainnet; mainnet is open by default (supersedes the "off by default" part of D50)
- Date: 8 Nov 2026 · Decided by: the owner's brief (build our own token and contract on Celo mainnet, mint AI credits when people connect a wallet, map them to AI credits, open mainnet). The details below are my choices, made without asking as instructed; each is easy to change.
- **The token** (`contracts/GoodBuildCredits.sol`): an ERC-20 with 6 decimals where **1 unit = 1 micro-USD**, so 1.000000 GBC = $1 of AI builds. That is the same unit as the ledger (D46), so crediting needs no conversion.
- **Not a trading asset, on purpose.** Wallet-to-wallet transfers revert. Credits can only be minted and burned, so a balance always belongs to the wallet that bought it. Why: a tradable token would make GoodBuild an issuer of a market asset (a legal question for the lawyer, MAINNET_PLAN.md section 1) and would let one balance be claimed by two accounts.
- **"Mint when they connect" is a purchase, not a free grant.** Connecting a wallet mints nothing: a free mint per wallet is a free-money bug (anyone makes a thousand wallets). Credits are minted when the wallet pays CELO (`purchase`, `purchaseAndRedeem`) or when an authorised minter (a backend key the owner may set with `setMinter`) mints for a payment taken another way. The free $0.20 per account (D28) stays as it is.
- **Mapping to AI credits = burn, then credit once.** `redeem` burns the tokens and emits `Redeemed(account, credits, ref)`; the server posts one ledger `deposit` of the same amount for that wallet's account, keyed by chain, transaction and log index. `purchaseAndRedeem` does both in one signature and is what the app uses, so the wallet never holds an unspent balance. Burning first means one balance can never be credited twice.
- **Safety in the contract:** the owner is two-step (`Ownable2Step`) and can't renounce; a per-mint cap limits one purchase or mint; `pause` stops buying and minting but never `redeem`, so a pause can't trap credit; the contract never holds CELO (it forwards to the treasury in the same transaction); reentrancy guarded. **The CELO price is a number the owner sets (`creditsPerCelo`)**: there is no oracle, so the owner must update it when CELO moves (price risk is on the owner; the per-mint cap limits the damage of a stale price). **Not audited.** Treat the first deploy as a small, watched launch.
- **Compiled for the paris EVM with OpenZeppelin 5.1.0** (as D17), so it runs on any Celo node. `scripts/compile-credits.mjs` builds it; `scripts/deploy-credits.mjs` deploys it (a dry run unless `--send`, and mainnet needs `CONFIRM_MAINNET=yes`). **I did not deploy it**: that needs the owner's key and a funded wallet, which I don't have and must not use. The address then goes in `CREDITS_CONTRACT_42220` (and `CREDITS_START_BLOCK_42220`).
- **Mainnet is open by default.** The D50 switch stays (off, admins, everyone) as the kill switch, but with no stored value it now means `everyone` (env `MAINNET_DEFAULT_MODE` can start a deployment closed). A value set on purpose, including `off`, still wins, and an unreadable value still fails shut. The wallet could already connect and sign in on Celo mainnet (chain 42220 is in the sign-in list, in WalletConnect's chains and in the Magic wallet's networks); what blocked people was this default, which hid the mainnet option and refused mainnet deploys. The pages now say mainnet is live. Verification (GoodDollar face check) is still not required for mainnet deploys, as D50 already noted; the owner's earlier plan to require it (MAINNET_PLAN.md section 6) is unchanged and not built.

### D52. How on-chain credit reaches the ledger (idempotent, three readers, nothing trusted from the caller)
- `onchain_credit_events` (migration 0014) holds one row per `Redeemed` event, unique on (chain, transaction, log index). The ledger entry is keyed `onchain:<chain>:<tx>:<logIndex>`, so any number of readers credit once.
- Three readers: **the user's own call** (`POST /api/credits/redeem` with a transaction hash; it reads the receipt, keeps only logs from the configured contract and credits the account the *log* names, never the caller); **a once-a-minute scan** started with the server (`onchain-sync.ts`, resumes from the newest stored block, at most 50,000 blocks a tick), so credit lands even if the tab was closed; and **sign-in**, which credits anything the wallet redeemed before it had an account (`creditPendingForWallet`).
- A `Redeemed` event from any other contract is ignored (tested), a reverted transaction credits nothing, and a wallet with no account is held, not lost.
- Reading uses `CELO_RPC_URL` first and the public forno node second (a fallback, C5).
- Reconciliation to add later: compare the sum of `onchain_credit_events` with the contract's total burned (`totalSupply` and the `Redeemed` log), and the treasury's CELO with what was sold.

### D53. Getting CELO: a card on-ramp, off until configured
- The owner asked for an integration with "a platform I trust" without naming one. I chose **Transak** (it lists CELO on Celo and works as a hosted page), and built it behind one function, `src/lib/onramp.ts`, so changing provider means changing that file. It stays **off until `NEXT_PUBLIC_TRANSAK_API_KEY` is set** (a public identifier, not a secret; `NEXT_PUBLIC_TRANSAK_STAGING=1` uses their test site). It is a link to the provider's own page with the user's wallet address pre-filled; GoodBuild never sees card details or funds, and no provider SDK package is installed. **If the owner trusts a different platform, say so and swap it; this choice was mine.**

### D54. Credits on mainnet pay for AI only
- Credits pay for AI builds, not gas and not deploys. The Add credits screen says so and says they can't be traded. Paystack and the naira path (M5 to M7 in MAINNET_PLAN.md) are no longer on the critical path: the token replaces them for the first launch. The ledger, holds and caps from M1 to M3 are unchanged and are what the credit lands in.

### D55. What was not done, and why
- **Nothing was deployed or minted on mainnet** (no key, and a deploy is real money). **No live AI test**: the key lives on the server and is tested after merge (the owner's instruction).
- **No audit, no Slither run, no gas grant (G1), no verification gate on mainnet deploys, no lawyer review.** A contract that takes CELO and issues a non-transferable credit is simpler than a trading token, but whether it needs licensing is a question for the lawyer, not something this PR settles.
- **The first deploy needs an owner-run checklist** in [DEPLOY.md](DEPLOY.md) ("GoodBuild Credits").

### D56. Credits are bought with G$ against signed quotes; fixed 10,000,000 supply; admin can withdraw (supersedes D51's CELO purchase and "contract never holds money")
- Date: 8 Nov 2026 · Decided by: the owner's brief (10,000,000 credits, buy with G$, packs of 10, 50 and 100, a quote system, a withdraw function, admin `0xf0449277E30CC9063147bfB9Ecdf036BF9d41531`, profitable, extra credit for GoodDollar-verified people). The numbers below are my choices.
- **Unit.** Unchanged: 6 decimals, 1 credit = $1 of AI builds = 1,000,000 ledger units, so the server's `Redeemed` reader needed no conversion. Packs: 10, 50, 100 credits ($10, $50, $100). The owner's "credits" could have meant a smaller unit; this keeps one unit everywhere and is a constant (`PACKS`) to change.
- **Supply.** `GoodBuildCredits` mints 10,000,000 credits once, to itself. A sale or grant burns credits out of that inventory, so total supply can only fall and nobody can mint more. `remaining()` shows what is left. Credits still cannot be transferred.
- **Paying.** G$ (`0x62B8…9c7A`, read on Celo mainnet on 8 Nov 2026: symbol `G$`, 18 decimals) is paid with `transferAndCall(contract, amount, abi.encode(quote, signature))` (ERC-677, one signature), or `approve` then `buy`. The contract checks that the quote was signed by `quoteSigner`, is not expired, names the payer, is for exactly the G$ sent, and has an unused `ref`. It then burns the credits and emits `Redeemed(account, credits, ref)`, the same event the server already credits from, once.
- **Quote system.** The price is not on-chain, because G$ moves and a fixed rate goes stale. The server signs an EIP-712 quote (`src/server/credits/quote.ts`, `POST /api/credits/quote`) valid for 10 minutes, priced from CoinGecko's G$ price (cached a minute; a price older than an hour or 5 times off `GD_USD_FALLBACK` is refused). It records each quote in `credit_quotes` (migration 0015). The owner can replace the signer at any time, which retires every open quote.
- **Profit.** The ledger bills AI at cost + 25% (D13), so a credit costs about $0.80 to serve. A quote asks for the pack's dollar value plus a 5% buffer (`CREDITS_PRICE_BUFFER_BPS`) in G$, rounded up to whole G$. With the 10% verified bonus, revenue per credit is about $0.95, still above cost, before G$'s exit cost, which is **UNVERIFIED** (not measured on-chain). The buffer is the knob until it is.
- **GoodDollar verification bonus.** A wallet whose GoodDollar Identity root is whitelisted (read live from the Identity contract on Celo mainnet, never from the browser) gets 10% extra credits on a pack, up to $10 of bonus per calendar month **per root**, so many wallets of one person do not add up. A quote counts against the cap while it can still be paid, or once paid. A failed identity read means no bonus, never a failed purchase.
- **Admin.** The owner (two-step, cannot renounce) is the admin address, not the gas wallet; the gas wallet only pays for the deploy. Admin functions: `withdraw(token, to, amount)` (G$, any token, or CELO with `address(0)`; the credits themselves cannot be withdrawn), `grant(account, credits, ref)`, `setQuoteSigner`, `setMaxPerQuote`, `pause`/`unpause`. **This reverses D51's "the contract never holds money": it now holds the G$ buyers paid until the admin withdraws it.** Pausing stops sales; nothing is stuck because nobody holds credits.
- **Tested.** 11 contract tests on a real EVM (replay, wrong signer, tampered amount, expiry, wrong payer, cap, pause, withdraw, grant, two-step ownership), quote tests on both databases, and a Celo Sepolia rehearsal with `scripts/credits-rehearsal.mjs` (deploy, 10,000,000 supply, a signed quote paid with test G$, `Redeemed` emitted).
- **Deployed 9 Nov 2026** (owner approved SSH): `0x800a4cb107f788fece1e7fa73aeeec1bce7e8c2f` on Celo mainnet, block 82304791, deployed on the server so the gas wallet's key never left it. Owner, supply, G$ and signer were read back from the chain. The server env vars `CREDITS_CONTRACT_42220` and `CREDITS_START_BLOCK_42220` wait for this PR's code to be live. Source verification is still to do.
- **UI.** "Add credits" shows the three packs in G$ with the verified bonus. The mainnet "unaudited" sentences on Home and the FAQ are gone. Deploying on mainnet now opens a popup that says it is real money and suggests trying Celo Sepolia first, which can be skipped. The deploy modal has a four-step faucet guide (copy your address, open the faucet, paste, come back). Published apps carry a small "Built with <logo>" pill instead of the "Unaudited" bar.

## Recommended decisions (Ego; adopted unless changed)


### D60. A template gallery that builds from a brief held on the server (8 Nov 2026, decided by Claude, owner to review)
- **What:** the landing page shows 41 page templates with real screenshot thumbnails ([TEMPLATES.md](TEMPLATES.md)). One click sends a short request with the template id; the server adds the full design brief to the first build.
- **Why a brief and not a long prompt:** the chat stays readable, the user can't see or edit a wall of spec text by mistake, and the id is looked up on the server so a request can't inject its own brief. The cost is about 2 to 3 KB of input once.
- **Plan-first is skipped for templates** (amends D32 for this case): the template already says what to build, so the questions would only re-ask it and cost a call. Colours come from the brief.
- **Licensing:** all designs are original; permissive sources inspired layouts only (list in TEMPLATES.md). Preline and Cruip excluded on licence grounds; 21st.dev and Pinterest inspiration only.
- **Numbering:** D60 is used so it doesn't collide with decisions another branch is adding after D55.
- **Not done:** gating ("unlockable"), and seeding real template files so the build matches the thumbnail exactly. Both listed in TEMPLATES.md.

### D25. Official logo: glass 2x2 tile mark
- Date: 5 Nov 2026 · Decided by: user (Olayinka)
- The official GoodBuild logo is the glossy glass 2x2 tile mark (white, lilac, lilac, pink; palette purple / lilac / pink, no green). Dated 5 Nov 2026.
- **Canonical assets:** `design/brand/logo-mark.png` (transparent master) and `design/brand/logo-mark-source.jpg` (original white-background render). App-served copies live under `public/brand/` (`logo-mark.png`, `logo.png`, `logo-32.png`, `logo-180.png`, `logo-192.png`, `logo-512.png`). Favicon / app icons: `src/app/favicon.ico`, `src/app/icon.png`, `src/app/apple-icon.png`. Landing mock uses `design/landing/assets/logo.png`.
- **UI:** `src/components/brand/logo.tsx` renders the PNG mark via `next/image` and keeps the "GoodBuild" wordmark text beside it. The previous inline SVG "G" mark is retired.
- Rationale: user provided the new mark and asked to replace the logo everywhere and document it as official.

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
- Amended by D31 (5 Nov 2026): published apps can also keep off-chain data in our DB. Money and ownership stay on-chain.

### D9. AI calls via GoodDollar AI credits if allowed, else providers via LiteLLM
- Date: 4 Nov 2026 · Recommended by: Ego
- Not OpenRouter: its ToS bans access "for purposes of reselling API access to Models or otherwise developing a competing service" (https://openrouter.ai/terms).
- No public API exposing Claude without Anthropic approval (Anthropic Commercial Terms forbid reselling "except as expressly approved").

### D10. 18+ only; block US persons
- Date: 4 Nov 2026 · Recommended by: Ego
- Rationale: GoodDollar ToS §6.2 (18+) and §8 "NO U.S. PERSONS MAY USE THE SERVICES". Gemini API also requires 18+. Also exclude sanctioned jurisdictions.

### P19. Publishing: own subdomain, server build, immutable snapshots (address and build approach decided by the user; the rest proposed)
- Date: 5 Nov 2026 · Decided by: user (`<app>.goodbuildit.xyz`, a real server build, a /docs page), as passed on by the session that built it. Claude proposed the rest.
- **Domain (5 Nov 2026, user):** GoodBuild's domain is `goodbuildit.xyz`, so apps default to `<slug>.goodbuildit.xyz`. Claude took this to be the main site's domain too (`APP_DOMAIN`), which keeps apps same-site with it.
- **Subdomain isolation:** generated JS must never be served from the main origin, where it could call the API as whoever is signed in. `src/proxy.ts` sends a published app's host only to `/published-app/<slug>`, that route exists on no other host, and the route repeats the Host check. Each app also gets its own wallet permissions.
- **API writes:** the proxy refuses API writes from another site or subdomain (`Sec-Fetch-Site`, then `Origin`). A subdomain is same-site, so the browser still sends the session cookie with its requests; `SameSite` and `__Host-` don't stop that. A separate registrable domain for published apps (as GitHub does with github.io) would be stronger, and the user may want to weigh it.
- **Cookies:** `__Host-` session and nonce cookies in production, so a subdomain can neither read nor overwrite them. Plain names in development, because the prefix needs a secure context.
- **Server build:** esbuild plus a Tailwind compile. Project code gets no filesystem access, and only `ALLOWED_DEPENDENCIES` resolve, from `publish-runtime/`.
- **Immutable snapshots:** publishing stores built files in the database, so later edits don't change a live app until the user publishes again. If a build fails, the old files stay live.
- **Undeployed contracts:** an app can go live before its contracts are deployed, with a demo notice, using `deployments.sourceHash` and `sourceKey` to tell.
- **Region block:** published app hosts return 451 for blocked regions (Q31), the same list as the API.
- **Verified on a production build, 5 Nov 2026:** see HANDOFF.md. Not verified on a real host.

## Proposed decisions (not adopted; Claude and the user may change them)

### P1. Testnet is Celo Sepolia, not Alfajores (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · Alfajores retired 30 Sep 2025 (https://docs.celo.org/operate/notices/archive/celo-sepolia-launch).

### P2. Audited-template-first contracts, non-upgradeable by default (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See CONTRACTS_AND_DEPLOYMENT.md §4. Open: Q1, Q4, Q15.
- Amended 5 Nov 2026 by D33: projects that opt in on testnet deploy behind a proxy. Non-upgradeable stays the default.

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
- Amended by D31 (5 Nov 2026): forms can now save to the app data store, within its rules. See the `forms-and-signup` and `app-data` guides.
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

### D61. Measured: selling G$ back to CELO costs far more than the 5% quote buffer (9 Nov 2026, measured by Claude, owner to decide)
- Live mainnet purchase passed (tx `0xc0717ff2…e492`, $0.25 for 2,323 G$, `Redeemed` 250,000 units). One purchase reserves about 0.08 CELO of maximum fee, so the screens tell people to keep about 0.1 CELO.
- Read-only QuoterV2 quotes on the CELO/G$ 1% pool (the only deep-ish pool): selling 2,323 G$ (a $0.25 purchase) returns 14.7% less than spot; 10,000 G$ about 37% less; 50,000 G$ about 73% less. The 1% pool fee is included. The pool holds a few hundred dollars.
- Consequence: the 5% buffer does not cover a market exit. Credits cost about $0.80 to serve per $1, so margin is about 20% before any exit. Holding G$ (not selling) keeps the margin; selling in one go would erase it.
- Options for the owner: (a) hold the G$ and only sell small slices over time, (b) raise `CREDITS_PRICE_BUFFER_BPS` (each +1% costs buyers 1%), (c) use the withdrawn G$ to pay GoodDollar-side costs instead of selling. Not changed yet.

### D62. Settings page: one owner-scoped admin panel for apps, contracts, admin functions and data (9 Nov 2026, proposed by Claude, approved by the owner)
- `/settings` has four tabs: Apps, Contracts, Admin functions, Data. It adds no table and holds no keys: admin calls are simulated, then signed in the user's own wallet (CLAUDE.md rule 8), like the old-funds withdrawal.
- **Authorization.** `GET /api/account/apps`, `/contracts` and `/admin-functions` use `requireSession`, then scope every query through `projects.owner_id` (deployments also by `user_id`). Two users never see each other's rows; a signed-out call is 401. The Data tab reuses `/api/projects/[id]/app-data/records`, which already returns 404 for other people's projects and respects D34 (owner reads only collections whose rule lists the owner; per-record grants apply). The Settings code never queries `app_data_records` directly and never touches the visitor email tables.
- **"Encrypted" fields.** Nothing in the database is encrypted today (checked 9 Nov 2026). Secrets are environment variables only. So "stays protected" means: session/code/IP hashes, tokens, visitor emails, stored source (`std_json_input`) and constructor arguments are never selected by these routes (explicit column lists), and writer ids are shown shortened (`maskSubject`). Tests scan the real JSON payloads for those keys. No encryption was added.
- **Admin functions are guessed from names** (`adminFunctions`, same approach as `exitFunctions`), because an ABI can't show `onlyOwner`. The UI says "may need the owner", reads `owner()` where it exists to say whether the signed-in wallet is the owner, and the chain decides. Functions with array/struct inputs are listed but not callable here. Only the newest deploy of each contract is shown ("Live"); replaced ones show as "Replaced" under Contracts.
- Mainnet calls show an extra confirm step naming the network. UNVERIFIED: a real wallet signing an admin call from this page (tested to the simulate step in unit tests only).

### D63. Games with entry fees are not gambling (clarifies D4)
- Date: 9 Nov 2026 · Decided by: the user.
- Generated games may charge an entry fee and pay prizes. D4 (no sports betting) stands.
- Not in code yet: `src/server/agent/prompt.ts` still tells the builder to refuse "gambling" with no definition, so a paid-entry game may be refused until the wording changes.
- Claude's flag, for the user to confirm: draw the line at skill. A game whose payout is decided by play (a score, a race, a puzzle) is allowed. One whose payout is decided by chance (lottery, dice, slots, a random winner among payers) is what most laws call gambling, and I'd keep refusing those. Scores sent from the browser can also be faked, since apps have no server, so prize games need a way to trust a score before real money rides on it. UNVERIFIED: no lawyer has looked at this for Nigeria or anywhere else.

### D64. The preview keeps Sandpack while GoodBuild's own build is added beside it
- Date: 9 Nov 2026 · Decided by: the user · Proposed by: Claude.
- A preview served from the publish bundler (esbuild) is to be built next to Sandpack, not in place of it. Both stay for a while. Q36 stays open until one is retired.

### D65. Uploads beyond images go to Cloudflare R2, with the server's disk in the meantime
- Date: 9 Nov 2026 · Decided by: the user.
- Audio, fonts and 3D models need object storage. The target is an R2 bucket (S3 API). Until it exists, files are stored on the server behind the `AssetStore` seam.
- Claude's flag: files on the server's disk aren't in the database, so the nightly and hourly backups (D47) don't cover them. They need adding to the backup, or the move to R2 should come before users rely on them.

### D66. New contract kinds are allowed on mainnet from the start (answers Q15 for them)
- Date: 9 Nov 2026 · Decided by: the user.
- DAOs, vaults, airdrops and the other kinds that a wider OpenZeppelin list brings are not limited to Celo Sepolia. Mainnet stays behind the runtime switch (D50).
- Claude's flag: these contracts hold other people's money and are easy to get subtly wrong, so the exploit-test check before a mainnet deploy should ship with them, not after.

### D67. The run check: every build is opened in a headless browser on the server
- Date: 9 Nov 2026 · Proposed and built by: Claude · Approved by: the user ("start the work").
- **Why.** The checks could see that an app compiles, never that it runs. A crash on first render, an empty page or a route that throws was only found by a person with the preview open (HARNESS.md E1 found one by hand).
- **What.** After the contract and app checks pass, `src/server/agent/run-check.ts` builds the project with the publish bundler (not minified, React's development build), opens it at phone width in headless Chromium, follows up to 5 `#/` links, and reports uncaught errors and an empty page as `[runtime]` issues. They go through the same auto-fix loop as a compile error (strong model, D19). Each issue names the project file from the stack and, when React says so, the component.
- **The page gets nothing.** Every request is answered from memory by the worker. Other hosts are refused, sockets are closed, and a chain RPC gets a stub (chain id and block number, an error for every read), so the check never depends on Celo being up and generated code can't reach anything.
- **Where the browser runs.** In production, a `checker` container: the same image, no `env_file`, an internal-only Docker network shared with the worker, all capabilities dropped, 1.5 GB and 1.5 CPUs. Chromium's own sandbox is off there (Playwright's default in containers), which is why the container has nothing worth taking. Locally, `RUN_CHECK=1` launches the browser in-process.
- **It can't fail a build by being broken.** No browser, a timeout (25 s) or a lost connection logs "skipped" and reports nothing. After a failed start it isn't tried again for 60 s. With neither `RUN_CHECK` nor `RUN_CHECK_WS_ENDPOINT` set, it is off.
- **Measured on the production server, 9 Nov 2026,** in throwaway containers built the way the Dockerfile builds (removed afterwards), on a 44-file, 4-page app:
  - one check: 2.6 to 2.9 s; three at once: 3.7 s;
  - the checker container: 182 to 190 MiB while checking, 106 MiB idle, never near its limit;
  - no internet from the checker (a fetch to example.com was blocked), running as `node`;
  - the browser adds about 0.9 GB to the image, in a layer above the app's files, so the kept images share it.
  - The server had 5.7 GB of memory available and 34 GB of disk free before this.
- **Tests.** `run-check.test.ts` opens real builds in a real browser (crash in a component, an undefined import, an effect error, an empty page, a broken second page, the network stub, a build failure, screenshots, an endless loop). CI installs the browser; without one those tests skip. `runner.test.ts` covers the fix loop with a stand-in.
- **UNVERIFIED:** a real AI build with the check on (no provider keys in the build session), the real compose service on the server (the rehearsal used the same flags by hand), and how often a real model's fix for a runtime error works first time.
- **Known limits.** No wallet is connected, so code behind a connected wallet isn't run. Uploaded images are blank placeholders. A resumed build runs the check again, and a different result would end the resume with "no longer matches" (the same is true of contract tests). Screenshots are taken on request but nothing uses them yet: the visual check still captures in the user's browser.
- **Not done here:** a type check, a `run_checks` tool for the model, the visual check on these screenshots, the own-build preview (D64).

### D68. A type check, and a run_checks tool so the builder can check its own work
- Date: 9 Nov 2026 · Proposed and built by: Claude · Approved by: the user ("start this now").
- **Type check.** `src/server/agent/type-check.ts` runs TypeScript over the app's files in a child process (`scripts/type-check.cjs`, 45 s and 1.5 GB limits, two at a time), against the packages in `publish-runtime` and React 18's types (`@types/react-18`, an alias: GoodBuild itself is on React 19, whose types reject valid React 18 code). It runs beside the run check, after the other checks pass.
  - **Not strict, on purpose.** It is there to find code that is wrong (a prop that doesn't exist, a missing export, a misspelt viem method, a number where a bigint goes), not code that is loose. Strict null checks would flag a lot that runs fine.
  - **GoodBuild's own files are left out** (the wallet layer, `db.ts`, the contract and asset modules). The builder can't edit them. They do have 4 type errors today (viem wants `account` on `signMessage` and `params` on `request`); they run fine and are not fixed here.
- **Two modes, `TYPE_CHECK`.** `warn` (what the compose file sets): type errors go in the build log and to the builder when it asks, and the build still finishes. `enforce`: they go to auto-fix like a compile error. Unset: off. Starting on `warn` is deliberate: nobody has measured how often real model output trips the type check without being broken, and each false alarm would cost a fix pass. The worker's log lines (`type check: N type errors, noted, not blocking`) are the measurement. Switch to `enforce` once they look right.
- **`run_checks` tool.** The builder can run the same checks GoodBuild runs at the end (compile, contract tests, imports, types, the run check) on the files as they are, at most 3 times a turn, and gets the errors back. The prompt asks for one call after the last edit.
  - **Why.** A mistake found this way is fixed by the build model with the work still in mind. Before, every mistake waited for the end of the turn and went to the fix model, which was most of a build's cost (HARNESS.md E5: $0.20 of $0.26).
  - If nothing changes after the builder's last check, the end of the turn uses that result instead of checking the same files again.
- **Third D19 amendment:** a first fix attempt whose only errors are type errors goes to the cheap model, like test failures. They name the line and say what is wrong.
- **Measured locally (an Intel Mac):** 5 to 6 s per type check on the starter and on a 44-file app, nearly all of it viem's types. **UNVERIFIED:** the time on the server, any real AI build (no provider keys in the build session), whether real models call `run_checks` once as asked or loop on it (the limit of 3 bounds that), and the false-alarm rate on real output.
- **Tests.** `type-check.test.ts` runs real TypeScript (React 18 idioms pass, five kinds of mistake are found on the right lines, skipped without the packages or when too slow). `runner.test.ts` covers the tool, the reuse, the limit, both modes and the cheap-first routing with a stand-in.

### D69. GoodBuild's own preview, beside Sandpack, chosen without the person knowing
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user ("start phase 2"; D64 says both stay for a while).
- **What.** The workspace can show a project's preview from GoodBuild's own build: the saved files, bundled by the publish bundler (not minified, React's development build), served from a host of the project's own, `pv-<32 hex>.<apps domain>`. To the person it is the same frame, the same refresh and device buttons, and the same "Fix it" notice.
- **Which preview a project gets** (`src/lib/preview-engine.ts`), decided by the workspace, never asked:
  - its own build if the project uses a package or a file the in-browser bundler can't carry (three, Phaser, shaders, sound, 3D models; none are allowed yet, the list is ready for when they are);
  - its own build if Sandpack fails in this visit: the bundler reports a network or CDN failure, or stays silent for 20 s. That covers CodeSandbox being down or blocked on a campus network (Q36);
  - otherwise Sandpack, which updates in place.
  - It only ever goes one way within a visit, so the preview doesn't flip between turns.
- **The owner's switch, for comparing the two:** add `?preview=own`, `?preview=sandpack` or `?preview=auto` to a project's address. It is remembered in that browser. There is no button for it.
- **Safety, the same model as published apps (P19):**
  - generated code never runs on the main site's origin. A preview host serves that project's build and nothing else, read-only, with no data API. The main host answers 404 for the preview route;
  - the host name is an HMAC of the project id under a key derived from `SESSION_SECRET`, so it can't be guessed, and it is the same for every build, so the preview keeps its origin (the wallet's permission, anything the app stored). No app can be published under a name of that shape;
  - only the owner can ask for a build (`POST /api/projects/<id>/preview`). Anyone with the address could load the preview while it is in memory; the address is 128 bits and is never shown outside the workspace;
  - `frame-ancestors` lets only the workspace frame it; `no-store` and `noindex`; the same script, connect and image rules as a published app. The region gate applies.
- **Builds live in the web process's memory** (40 builds, 200 MB, 2 hours unused), not in Postgres. A preview is rebuilt from the saved project in about a second, so a restart costs one rebuild, and megabytes of throwaway bundles stay out of every backup. **One web process only:** with more than one, this needs shared storage.
- **How the workspace hears from the app.** A small script in every preview build posts "ready" and uncaught errors to the page that frames it, with the project file an error came from (the same module table the run check uses). The workspace only listens to its own frame's origin.
- **Verified** on a local server with the demo model, in a real headless browser (`scripts/preview-e2e.mjs`, 12 checks; screenshots in [testing/preview-2026-11-10/](testing/preview-2026-11-10/)): the own build on request, Sandpack by default, the automatic switch with CodeSandbox and jsDelivr blocked, refresh, the phone frame, an unsigned caller refused, the main host refusing the route. `bridge.test.ts` checks in a real browser that a crash names its file and that another site can't frame a preview.
- **UNVERIFIED:** on the live site (wildcard DNS and Traefik already route every `*.goodbuildit.xyz` label, and Cloudflare is in front; whether Cloudflare caches or alters anything on a `pv-` host is untested), a real browser wallet inside the own-build frame, and rebuild time on the server.
- **Known limits.** The visual check (the screenshot review) only runs on Sandpack, so a project on its own build skips it; the run check still opens every build. The own build doesn't update in place: it rebuilds when a version is saved. WalletConnect and saved data behave as in the Sandpack preview (browser wallets only, data stays in the browser).
- **Q36** stays open until Sandpack is retired, but a blocked network no longer leaves the preview blank.

### D70. An eval suite of twenty real builds, run on demand in CI
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user ("start phase 2").
- AI_AGENT.md §8 asked for about twenty prompts run on every prompt or model change. There were six scenarios, run by hand. Now: `docs/evals/suite/suite.json` (14 builds, 4 edits, 2 refusals), `scripts/eval-suite.mjs` (runs them against a server, scores them, compares with a baseline) and `.github/workflows/evals.yml`. Details: [evals/SUITE.md](evals/SUITE.md).
- **On demand, not on every push.** A run is real model calls, a few dollars. It starts from the Actions tab or the `evals` label on a pull request. The server it starts caps its own spend at $15.
- **"Ready" means it ran.** The suite's server has the run check on (D67), so a pass means the built app opened in a browser, not only that it compiled.
- **A regression fails the run:** the pass rate down more than 10 points, or the cost per scenario up more than 30%, against the committed baseline.
- **Needs the owner:** `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` as GitHub repository secrets, then one run with `update_baseline` to create the first baseline.
- **UNVERIFIED:** any run with real models, and the workflow on GitHub. The runner was driven end to end locally with the demo model only.
- The two refusal scenarios are a contract that drains its users and sports betting (D4). A paid-entry game of chance is left out until the owner confirms where D63's line is.

### D71. Kits: one place for everything a new kind of app needs
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user (phase 3 of the harness plan, "complete the rest of the phases").
- **The problem.** A new kind of app (a game, a dashboard) meant changing the package list, `publish-runtime/package.json`, the prompt, the guides and the checks, each in its own file.
- **A kit** (`src/server/agent/kits/registry.ts`) holds all of it: packages, starter files, a guide, extra file types, its own checks, and whether it needs GoodBuild's own preview (D69). `KITS` lists them. This change adds the mechanism and no kit; the first kits come in the changes after it.
- **Kits add up and never come off.** A tip jar can gain a game later and keeps everything it had. Which kits a project has on is a small file in the project, `src/goodbuild.json`, written by GoodBuild and closed to the builder. It travels with versions and reverts, and needed no migration.
- **How a kit gets turned on.** The builder calls `add_kit` (its prompt lists the kits and when to use them). As a backstop, a request whose words clearly ask for a kit has it on before the builder starts, with the guide in its context. People are never asked to pick one.
- **What a kit changes for its project only:** what `add_dependency` accepts, where the builder may write, and which checks run. `ALLOWED_DEPENDENCIES` is now the base list plus every kit's packages (what publishing can bundle); `packagesFor(files)` is what one project may add.
- **Left out on purpose:** per-kit Content-Security-Policy. Published and preview headers have no project context without a query per request. The one known need (WebAssembly for physics) is a single keyword that can be allowed for every app when the 3D kit arrives.
- **Tests:** `kits/kits.test.ts` (a stand-in kit through every function, the tools and the checks; and for real kits, that publishing installs their packages at the same versions) and two turns in `runner.test.ts`.

### D72. The first kit: 2D games, with no game engine
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user (phase 4 of the harness plan; "update the front end with information that you can now build games").
- **`game-2d` kit** (`src/server/agent/kits/game-2d.ts`): three starter files and a guide. `GameCanvas` (a fixed-size game scaled sharp to any screen, a frame loop that pauses in a hidden tab, keyboard, touch and on-screen buttons), `sound.ts` (sounds made in the browser, no audio files) and `storage.ts` (best score).
- **No engine, no new packages.** Claude's call, against the earlier plan's "Phaser": a canvas game is a few kilobytes on top of the app, runs in both previews and in MiniPay, and suits the phones and data plans most players here have. A physics-heavy game may want an engine later; that would be another kit.
- **The run check plays the game.** For a project with this kit it presses the start button, taps and steers for about a second, then looks at the canvas. That catches a crash on the first frame of play and a game that draws nothing, which loading the page alone can't see.
- **Money in games (D63).** The guide allows an entry fee and prizes when play decides the winner, with an organiser who settles the result, because a score comes from the player's own device and a contract can't trust it. It tells the builder never to write a contract that pays whoever submits the biggest number.
- **Claude's reading of D63, for the owner to confirm:** a game of chance played for money (a lottery, dice, slots, a random winner among people who paid) is still refused, in the builder's and the planner's prompts. Searched the other sessions for an earlier ruling on this and found none. If the owner wants those allowed, it is one sentence in each prompt and one in the guide.
- **What people see:** a "Mini game" starter, a Game tile on project cards, "Can I build games?" in the FAQ, and the planner's questions for a game (how it is played, how you win, scores). Nobody is asked about a kit.
- **Verified:** a flappy-style game written the way the guide asks passes the app check and the type check, and in a real headless browser the run check starts it, plays it and finds it drawing; a version that crashes on the first frame of play and one that never draws are both caught (`kits/game-2d.test.ts`).
- **UNVERIFIED:** a game built by a real model (no provider keys in the build session), a real phone, and sound, which a headless browser can't judge. The eval suite gained a game scenario for when it first runs.
- **Not in this change:** uploaded sound files and images drawn as sprites from a sprite sheet (uploads are still images only), and 3D.

### D73. Wait states: one shared kit, six screens, honest about what it knows
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user, who picked A2, B1, C3, D3, E1 and F1 from the wait-state gallery (details.so's loading examples are Pro-only, so the references were BoardUI's agent blocks, redrawn in D12's tokens).
- **Kit:** `src/components/ui/wait.tsx` (an elapsed clock, wave dots, brand tiles, a calm note, row skeletons, a slow-load note) plus `gb-wave`, `gb-breath`, `gb-lift` in `globals.css`. Reduced motion stays on the existing global rule.
- **A2 chat turn:** step rows lift in, the running one breathes and shows its seconds, and after 20 s on one step it explains. "Thinking" has a clock. Technical step names are mapped to plain words on the client (`plainStepLabel`); the server's labels are unchanged.
- **B1 first load:** a status line that moves through plain stages, and "N builds are ahead of yours" from the real job queue. The `queued` stream event in `turn-types.ts` is never sent by the server, so nothing uses it.
- **C3 preview:** four brand tiles that light with elapsed time. **E1 publish:** a progress pill whose words and fill follow elapsed time, because publishing is one request with no stages. Neither shows a real percentage, and the fill slows near the end instead of promising a finish.
- **D3 deploy:** the stepper is a rail with a token. Waiting hints appear at 8 s and 30 s while signing, and at 60 s while broadcasting. "Nothing has been charged" shows only before the run's first transaction. The confirmation counts in the mock were dropped: the deploy hook exposes none.
- **F1 lists:** shape-true skeletons for deployments and credits, a "still loading" note at 12 s, and a Retry card on deployments (projects already had one).
- **Not done:** the deploy modal still cannot be cancelled while a signature is pending. Per-step timers restart from 0 on a page reload mid-turn. D12 is untouched.

### D81. Buy G$ and CELO with naira through GoodCash (10 Nov 2026; numbered D63 at first, renumbered because D63 was already taken; decided by the owner's brief; supersedes D53's Transak on-ramp)
- **What.** When someone lacks G$ (or CELO for the network fee), "Add credits" offers **Buy G$** or **Buy CELO**. It opens our own dialog: pick G$ or CELO, an amount in naira (₦1,000 to ₦2,000,000), a live price with every fee on its own line, and what the person needs. The payment partner is GoodCash ([docs](https://pay.goodcash.xyz/docs/quickstarts/topups)). The old gooddollar.org link and the Transak code are gone.
- **Hybrid, on purpose.** GoodCash takes the payer's name, date of birth and BVN or NIN, and shows the bank-transfer details, **on its own page** (its API accepts none of it, and has no pay-in account number). So the owner's "show the account number and the verification" happens in GoodCash's embedded panel, opened over our dialog by `widget.js` (`flow: "topup"`, `mode: "embed"`). Our dialog follows the order (waiting for transfer, naira received, sent to your wallet, or failed) from the widget's events and a 4 second status poll (`GET /api/buy/topups/:id`, only for the wallet the top-up pays). We never see ID or bank details, and we credit nothing: the G$ lands in the person's wallet and the existing credits purchase reads the chain.
- **Config.** `GOODCASH_PUBLISHABLE_KEY` (required to show Buy), `GOODCASH_SECRET_KEY` and `GOODCASH_ORIGIN` (optional), read at request time (`/api/buy/config` hands the publishable key to the browser), so no build argument. Test keys are free from GoodCash; live keys need their go-live review. Top-ups are switched on per partner by GoodCash; until then their API answers "not found" and Buy shows "isn't switched on yet".
- **No webhook yet.** Nothing in our ledger depends on the top-up, so the poll is enough for v1. Add a signed `topup.delivered` webhook if we later credit anything from it (verify the HMAC on the raw body, five minute window, dedupe by id).
- **Tested on 10 Nov 2026 with GoodCash test keys, in a browser on `http://localhost:3000`:** the quote (the secret key is accepted for quotes), GoodCash's panel inside our dialog (it takes `wallet`, `amountNaira` and `asset` from us), the events moving our three steps to "G$ sent to your wallet", and the failure path (an amount ending in 13). Embedding needs the site on the key's allowed list (`frame-ancestors`); a key registered only for `https://goodbuildit.xyz` and `https://localhost` refuses `http://localhost:3000`. Test mode skips the ID details and bank-transfer screens, so those were **not seen**.
- **UNVERIFIED.** Whether our Magic email wallet works in the panel for a live order (the test wallet here was an external one; GoodCash's docs say embedded wallets are not supported for top-ups), live mode end to end (the ID and bank-transfer screens, the real `orderId`), and the panel on a phone.

### D83. A 50-post blog, llms.txt and AI-crawler rules for search visibility (10 Nov 2026; numbered D74 at first, renumbered because the web-builder stack had taken D74 to D82; decided by the owner's brief; written by Claude)
- **What.** `/blog` with 50 posts in six clusters (MiniPay, blockchain apps, AI builders compared, free and no-code, G$ app ideas, vibe coding), a sitemap, `robots.txt` that names AI crawlers, `/llms.txt`, `/llms-full.txt` and an RSS feed. Design, fact sheet and keyword map: [BLOG.md](BLOG.md).
- **Claude's calls.** One target query per post, so posts don't compete with each other, instead of many near-identical "top AI builders" lists. Roundups name GoodBuild by niche and are dated "November 2026". Competitors are described by stable traits only, with no prices. Posts are plain typed data, not MDX, so tests can check them.
- **Kept out on purpose.** Sports betting, games of chance, US-targeted keywords, "free forever", and any claim that MiniPay was tested on a real phone.
- **UNVERIFIED.** Search volumes and rankings (none measured). The content has not had a human or legal read. See "Owner to do" in BLOG.md.
### D74. MiniPay: a kit, dollar-coin references in deploys, and what MiniPay forbids
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user ("check out how MiniPay works ... make the apps playable and deployable on MiniPay").
- **How MiniPay works (from its docs, 10 Nov 2026).** No OAuth, no SDK. MiniPay injects a wallet into the page (`window.ethereum`, `isMiniPay` true) and connects it on its own. Apps must not show a connect button and must not ask for a signature to log in. Stablecoins are USDm (18 decimals), USDC and USDT (6). Fees can be paid in those coins by naming a `feeCurrency` (the 6-decimal coins use an adapter address). The docs name only plain (legacy) transactions. It is phone-only (360 x 640 and up), ethers isn't supported, and listing needs a footer, a Terms and Privacy page and contracts verified on Celoscan.
- **GoodBuild's wallet layer (D36) already did the connecting.** Inside MiniPay it connects on its own with no list. Nothing there changed.
- **`mini-app` kit** (`kits/mini-app.ts`): `src/minipay/minipay.ts` (coin table per network, balance, amounts with the right decimals, `sendCoin` with the fee in the same coin and a legacy transaction, plain-words payment errors, the add-cash link) and `MiniFooter` (About, How to use, Terms, Privacy, Support, "not operated by Opera or MiniPay"). The guide covers layout, wording ("Network fee", dollars, no addresses), the pay flow and the listing form. No new packages.
- **Checks it adds:** no `signMessage`/`personal_sign`/app-data sign-in, no `maxFeePerGas`, no `parseEther` on dollar coins, and the footer must be used.
- **App-data sign-in needs a signature, so it conflicts with MiniPay.** A MiniPay app keeps personal things on the contract or in the device. Claude's call; the alternative (an email code sign-in) stays available outside MiniPay.
- **Stablecoin references in deploys** (`src/config/stablecoins.ts`, `lib/deploy/manifest.ts`): a contract argument can be `${USDT}`, `${USDC}` or `${USDM}`, resolved per network like `${GOODDOLLAR}`. Addresses are Celo's fee-currency list, each read back from the chain on 10 Nov 2026. MiniPay's docs list different Celo Sepolia addresses that had no contract on that date.
- **UNVERIFIED:** a build inside the real MiniPay app (needs a phone and the test page), whether MiniPay accepts the CIP-64 fee-currency transaction type (docs name only legacy; the kit sends `legacy` with `feeCurrency`, as the agent-skills doc shows), and acceptance by MiniPay's listing review.
- **Front end:** a "Can my app work inside MiniPay?" FAQ entry.

### D75. Dashboards kit: charts with no charting package
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user (phase 4 of the harness plan: "dashboards").
- **`dashboard` kit** (`kits/dashboard.ts`): `src/dash/Charts.tsx` (Stat, LineChart, BarChart, ShareBars, DataTable as plain SVG and Tailwind) and `src/dash/live.ts` (`useLive` refresh, `perDay`, `compact`). A guide for reading real data (contract reads, event logs in 5,000-block chunks, saved data), phone-first layout and calm per-block failure.
- **No charting library.** Claude's call, against recharts: a library is hundreds of kilobytes and a dashboard here needs lines, bars, shares and a table. Small components keep it light for phones (and MiniPay), pass both previews and need no change to the publish runtime. If a dashboard needs zoom or tooltips later, a heavier kit can be added.
- **Real numbers only.** The guide forbids hard-coded figures and asks for "Nothing to show yet." when there is no data, which is also what the preview shows (no chain there).
- **Also:** a Dashboard project kind and tile, a "Can I build a dashboard?" FAQ entry.
- **UNVERIFIED:** a dashboard built by a real model on a live contract. Leaderboards are not a trigger word on their own so games keep a game-only build.

### D76. DAOs and vaults: a kit, an exploit-test rule, and a gate before mainnet
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user (phase 4: "DAOs and vaults with the exploit-test check"; D66 allows mainnet for new contract kinds).
- **`dao-vault` kit** (`kits/dao-vault.ts`): no starter files, a guide. It steers the builder to OpenZeppelin's audited parts (ERC4626 with a decimals offset, Governor with ERC20Votes snapshots, SafeERC20, ReentrancyGuard, Ownable2Step), to a simple club-treasury shape for most requests, and away from the known drains: nobody (the owner included) can take depositors' money, checks-effects-interactions, no upgrade switches, time windows as constructor arguments so tests can use zero.
- **Exploit-test rule.** The kit reads what the contracts do (a vault takes deposits and gives them back; a DAO has proposals and votes) and requires named attack tests in `contracts/test/*.t.sol`: `testExploitUnauthorizedCall` and `testExploitReentrancy` for both, `testExploitDonationInflation` for a vault, `testExploitDoubleVote` and `testExploitFlashVotes` for a DAO. Each must assert something. They run in the local EVM with the other tests, so a failing one is fixed like any test. The rule is part of the app check, so the builder's fix loop enforces it.
- **Gate before Celo mainnet** (`server/deploy/exploit-gate.ts`, called in `prepareDeploy` for chain 42220 only): compile with the guardrails, require the exploit tests and run every test again, at deploy time, for projects with the kit. Any problem refuses the deploy (`exploit_tests_failed`) with the list. Sepolia is untouched.
- **What this is not:** the tests are written by the same model that wrote the contract, and the rule checks that an attack is tried and turned away, not that it is the right attack. It is not an audit. The guide and the FAQ say so, and a vault holding a lot of real money should have a human audit. A second, independent model reviewing the contract before mainnet is the next step if the owner wants one.
- **Verified:** a real ERC4626 vault with all four exploit tests compiles and passes in the local EVM and clears the gate; the same vault with its owner check removed fails its unauthorized-call test and is stopped; a missing test is named (`kits/dao-vault.test.ts`); `prepareDeploy` refuses on mainnet and not on Sepolia (`deploy.test.ts`).
- **UNVERIFIED:** a DAO or vault built by a real model, a Governor-based DAO within the 24 KB limit, and a real mainnet deploy.
- **Changed after review (10 Nov 2026, Claude, owner said "fix everything").** The rule and the gate no longer depend on the kit being on. The kit is turned on by the words of a request ("vault", "DAO", "treasury"), so "a savings pool where members deposit and withdraw" could build a vault-shaped contract with no kit and reach mainnet with no exploit tests. Now the app check asks for the exploit tests whenever the project's own contracts take deposits and pay them out, or hold proposals and votes (`rolesOf`), and tells the builder to turn the kit on for the guide; the mainnet gate runs on the same condition. Cost: savings circles, crowdfunds and escrows with deposit and withdraw functions now need exploit tests too, which takes the builder more steps. That is deliberate: they hold other people's money as much as a vault does. A tip jar or anything without both sides is untouched. The live check (10 Nov 2026, DeepSeek) built a savings circle and a crowdfund with no kit: both were held to the rule, wrote their exploit tests and finished ready. An escrow slipped past because it took money through `fundDeal`, so money-in now also counts `fund`, `pledge` and `lock`. The gate guards GoodBuild's own deploy flow; someone who deploys the bytecode with their own tools is outside it.

### D77. 3D kit: plain three.js, a small scene wrapper, and the own-build preview
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user (phase 5 of the harness plan: "3D").
- **`three-d` kit** (`kits/three-d.ts`): the package `three` 0.187.0 (also in `publish-runtime`, with `@types/three` as a platform-only package so the type check can read it) and one file, `src/three/Scene3D.tsx`. `Scene3D` does what goes wrong on a phone: sizing to its box, a pixel ratio capped at 2, no drawing in a hidden tab, drag and pinch controls on request, freeing the scene on leaving, and a plain message where WebGL is missing. The builder writes the scene in `onReady` and returns a frame function.
- **Plain three.js, not react-three-fiber and drei.** Claude's call, against the earlier plan. Two more packages (drei is large) and a React-reconciler layer pinned to React 18, for a style the builder gets wrong more than the scene graph it knows well.
- **Own-build preview, automatically.** `three` is in the own-build package list (D69), so these projects get GoodBuild's own build without anyone choosing. A test checks that the workspace picks it.
- **No outside files yet.** Models and image URLs are refused by a check, because uploads accept images only (the wider upload rules are a separate change) and the page can't reach other sites. The guide tells the builder to build from shapes and canvas textures and to say model uploads come later.
- **Checks:** its own `WebGLRenderer`, the file loaders and react-three-fiber are refused, with the fix named.
- **Verified:** a spinning-cube scene passes the app check and the type check, bundles in a real publish build, and loads in the headless browser run check without errors.
- **UNVERIFIED:** WebGL actually drawing on the checker (software rendering there may fall back to the no-WebGL message, which the run check accepts), a scene built by a real model, and frame rate on a low-end phone. The weight of three.js on a slow connection (about 150 KB gzipped for the parts used is an estimate, not measured).
- **Not in this change:** uploaded 3D models and audio, physics, and the multiplayer and app-data upgrades.

### D78. Uploads beyond images: sounds, fonts and 3D models
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user (phase 3 of the harness plan: "wider file and upload rules"; D65 for where they are kept).
- **What can be uploaded now.** Images as before (PNG, JPEG, WebP, SVG; 5 MB), and sounds (MP3, OGG, WAV; 10 MB), fonts (WOFF2, WOFF, TTF, OTF; 2 MB) and 3D models (binary glTF, `.glb`; 15 MB). The type comes from the file's first bytes, never its name or the browser's claim. A glTF text file, a version-1 binary and anything else is refused with one plain sentence listing what is accepted. A project's uploads add up to at most 25 MB (a published app is limited to 30 MB) and 20 files.
- **Kinds follow from the file.** A person still chooses logo, image or design reference for an image; a sound, font or model gets its kind from what it is. Sounds, fonts and models are stored as they are: no image analysis, no description call (so no model cost).
- **How the builder uses them.** The manifest in its context gives each file's path (`/assets/<name>`), its key in `src/assets`, and one line on use: play a sound with `new Audio(...)` after a tap, wire a font with `@font-face` and `font-display: swap`, load a model with the 3D kit's `GLTFLoader`. The app check rejects a path nobody uploaded, for the new extensions too. The 3D kit now allows `GLTFLoader` and `TextureLoader` on uploaded files and still refuses web addresses, FBX, OBJ, Draco and react-three-fiber.
- **Where they live (D65).** Still the asset store's database implementation, on the server's disk and in the backups, behind the same `AssetStore` interface that Cloudflare R2 will implement. Nothing moved. The upload pre-check is now 15 MB, the largest of the four limits, and each limit is enforced where the file is read.
- **Served and published with the right type.** Previews and published apps serve them by their stored content type under the existing content-security policies (`default-src 'self'` covers sounds, fonts and model fetches); no policy changed.
- **UI.** The attach menu has a "Sound, font or 3D model" item; the chips show a sound, font or model icon and no role menu; drops and pastes accept the new files by name, because browsers don't report a type for fonts and `.glb`.
- **Not in this change:** audio longer than a limit or in a format the browser can't play is not checked beyond the type; fonts aren't checked for licences; Draco-compressed or external-file glTF; moving the store to R2.
- **UNVERIFIED:** a real model using an uploaded sound, font or model in an app, a 15 MB upload through the production proxy, and phone playback.

### D79. App data: queries and polling for live apps; visitor file uploads not built
- Date: 10 Nov 2026 · Proposed and built by: Claude · Approved by: the user (phase 5: "app data upgrades and multiplayer").
- **Queries** on the list API: filters (`where`, up to four), an order, and `since`. The privacy rule is the point of the design: the server first shows each record as this viewer may see it, and compares only after that, so the new parameters can't be used to guess a hidden field (a filter on a field the viewer can't read matches nothing, and a hit looks the same as a miss). It reads the newest 500 records and reports `truncated`. The old list path is unchanged when no query parameter is given. `queriesPerIpPerMinute` (120) limits them, because each can read 500 rows. The attack suite (`app-data/query.attack.test.ts`) tests the hidden-field guess, the owner view, private collections, bad input, the rate limit and the 500-record limit through the real proxy and handler.
- **The helper:** `collection().list` takes `where`, `orderBy`, `dir` and `since`; `useCollection` also takes `liveEvery`. The preview does the same on its local records. Published apps get the new helper when they are published again (D34).
- **Multiplayer without a live connection.** There is no websocket on this server (one process behind the proxy; D27 sizes the data store for about 50 users), so live apps poll every 3 s or more. A new `multiplayer` guide teaches the pattern that fits the existing rule that each wallet writes only its own records: a room is a record, each join and each move is the player's own record with the room id, and every screen derives the same state by reading them in order. It says plainly that fast action games are out of reach and that money never lives in these records.
- **Challenged and not built: visitor file uploads.** Files added by an app's visitors, stored and served by GoodBuild, are a moderation and legal question before an engineering one (docs/OPEN_QUESTIONS.md). Claude asks the owner to decide, and proposes a narrow first version there. The owner's own uploads work since D78.
- **Left out on purpose:** deletes in a `since` poll (a deleted record just disappears from the next full list; the guide says to set a status instead), a shared counter, and a real realtime channel. If the owner wants real-time, a websocket service beside the web process is the next step; it needs its own plan.
- **UNVERIFIED:** a multiplayer app built by a real model, the cost of polling at 50 concurrent users on the real server (120 queries a minute per address is the limit, each reading up to 500 rows), and the preview's filtered list matching the server's on every edge (checked for the main cases only).
- **Changed after review (10 Nov 2026, Claude, owner said "fix everything").** Lists and queries were limited per IP address across all apps, so players behind one mobile network's address (common on Nigerian carriers) or one page with a few live lists could get 429s. Now both are counted per signed-in person in one app, or per address in one app for visitors who aren't signed in, under a ceiling of 1,200 lists a minute per address across everything. `useCollection` also returns `truncated`, and the app-data guide says how to poll with `since` safely: take it from the server's `updatedAt`, don't move it forward while `truncated` is true, and use a status field rather than deleting, since polling never shows deletions. The per-app limit (1,500 requests a minute) still caps how many players one live app can hold: about 20 players with two live lists at 3 seconds.

### D80. The published-app badge is the logo only, bottom left, closable (10 Nov 2026, owner request, built by Claude)
- **What.** The "Built with GoodBuild" pill on published apps is now just the logo at the bottom left with a cross to close it. The words are the logo link's label for screen readers. Notices that matter (demo, "can be changed", Report) still show beside the logo when there are any; the cross hides the whole badge for that visit (pure CSS, so it works under the published page's script rules).
- **Why.** The old centred pill covered the last thing on a phone screen. The live check (docs/evals/live) found a game's Play button unreachable under it. The page now ends with an empty block under the app's content, so the last control can scroll clear.
- **Open.** Closing it also hides the Report link and the demo notice for that visit. If a visitor must always be able to reach Report, keep that link outside the closable badge. Not verified on a real phone.
- **Also found by the live check, not a product bug.** The home page's Build button stayed disabled in dev-mode runs because the dev server kept reloading the page while files in the project folder changed. On a production build it enables at once.
- **Changed after review (10 Nov 2026, Claude).** The close control was a hidden checkbox behind a label, which a keyboard can't reach. Now the checkbox is visually hidden but focusable (Tab, then Space closes the badge), named for screen readers, and the cross shows a focus ring. The block under the page stays on full-screen games too: it adds a short strip to scroll into, which is the price of the Play button never sitting under the badge.



### D82. Fixes from the review of the web-builder stack, before merging (10 Nov 2026)
- Date: 10 Nov 2026 · Found by: a review of PRs #71–#79 (Claude, with the advisor) · Decided by: the owner ("fix everything ... remove the test model switches ... raise the limit to 50 calls and 20 tools for the worst case"), built by Claude.
- **Decision numbers.** main had taken D73 (wait states) and had two D63s. This stack's D73–D79 are now D74–D80, in the docs and the code comments, and GoodCash's D63 is D81.
- **Test-only model switches removed.** `OPENROUTER_FOR_TESTS` (both models through OpenRouter) and `DEEPSEEK_ONLY_FOR_TESTS` (DeepSeek as the fix tier) were in production code behind environment variables; one wrong value on a server would have broken "no OpenRouter resale" or quietly swapped the fix model. They are gone, with the live check's `--openrouter` and `--deepseek-only` options. The live check now needs the real `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY`.
- **Builder limits: 50 model calls per build, 20 tool rounds per pass** (were 30 and 16, then 40 and 20 in the live check). Money contracts now need exploit tests (D76), and the entry-fee game ran out of steps at 40.
- **Cost stays bounded.** The fix budget only covers the fix tier, and free allowance is checked only when a build starts, so more calls meant a free build could run further past its allowance. Now a build on free AI or an exempt wallet stops before its next model call once it has charged $1 (`FREE_BUILD_CEILING_MICRO`, the same as a paid build's hold and about three times the dearest build seen), and then it stops working: it writes its reply and saves what it made, with no more fix attempts (a hard stop at twice the ceiling catches anything that slips past). Change it with `FREE_BUILD_CEILING_MICRO` in the environment; the live check sets it from `--each`. Paid builds were already checked before every call (D49).
- **Gambling refusals say what was built.** The builder refused a real-money slot machine, built a play-money one anyway, and its reply didn't say so. The prompt now requires the reply to say what wasn't built, what was built instead, and that no real money is involved. D63's line is unchanged.
- **Also changed:** the exploit-test rule and mainnet gate follow the contract, not just the kit (D76); app-data lists and queries are counted per signed-in person (D79); the badge's close control works from a keyboard (D80).
- **UNVERIFIED:** none of this was run with real models. The $1 free-build ceiling is a judgement, not measured against real builds. The biggest open risk is D76's change: savings circles, crowdfunds, escrows and bill splitters with deposit and withdraw now need exploit tests, and no real model has built one under that rule yet; projects already on mainnet need them before their next mainnet deploy. Run the live check on those before relying on it.
- **Small trade-off:** lists now look up the visitor's session before the per-person limit, so one address can cause up to 1,200 session lookups a minute (the ceiling) instead of 300.

### D84. A motion kit for generated apps, written for GoodBuild; React Bits is not vendored (amends D7)
- Date: 10 Nov 2026 · Proposed and built by: Claude, from the owner's brief ("the design skill and the design capabilities are top-notch. Search React Bits") · **Owner to review**: it changes how D7 is carried out.
- **What.** A sixth kit, `motion` (`src/server/agent/kits/motion.ts`): twelve animated pieces in `src/fx/` (Reveal, Stagger, SplitText, GradientText, RotatingText, CountUp, SpotlightCard, TiltCard, Magnetic, Marquee, Aurora, GridPattern), one stylesheet, and a guide on when to use each and when not to. No package. It turns on for landing pages, portfolios and requests that ask for polish or animation, for every gallery template build, and whenever the builder calls `add_kit("motion")`. A new `visual-design` guide makes the builder choose one of six directions (type, shape, colour use, layout) before it writes.
- **Why not React Bits (D7).** D7 said generated apps default to "shadcn/ui + React Bits". The second half was never built, so generated apps had no motion at all. React Bits is MIT with the Commons Clause, which forbids selling a product whose value derives substantially from the software, and GoodBuild sells builds whose output would contain it. That is Claude's reading of the licence, not legal advice. The kit is original code in the same spirit, so the question doesn't arise. `src/components/react-bits/BlurText.tsx` on GoodBuild's own landing page is unchanged: **owner to decide** whether to replace it too.
- **Why no animation package.** Measured with the publish bundler on 10 Nov 2026: the `motion` package is 44 kB gzipped (130 kB minified) for a single animated element, about as much again as a whole starter app (45 kB gzipped). The kit with every piece used adds 3.5 kB gzipped (2.4 kB of script, 1.0 kB of styles). These apps are opened on phones and data plans. The kit is CSS transitions and keyframes, one IntersectionObserver and pointer events.
- **Safety of the effect itself.** Nothing stays hidden if the browser can't run it. Everything is in its final state under `prefers-reduced-motion`. Reveals count any part of a section as seen, so a tall section on a short screen still appears. GoodBuild's own screenshots (the visual check, the run check) set `data-fx="off"` on `<html>` first, so a section further down the page isn't reported as blank.
- **Also.** `Kit.replaces`: when the builder imports a package a kit stands in for (`framer-motion`, `recharts`, `phaser`, `@react-three/fiber` and others), the app check now names the kit instead of only refusing the package.
- **Checked.** In headless Chromium on a build made by the publish bundler: the hero arrives, content below the fold waits and then reveals, CountUp ends on the real number, nothing scrolls sideways at 390px, reduced motion and `data-fx="off"` show everything. App check and type check pass.
- **The Sandpack preview: checked on 11 Nov 2026** against CodeSandbox's real bundler (see D88). The kit works there.
- **UNVERIFIED.** No real model has used the kit or the guide. Whether the cheap model uses motion with restraint is the open risk: run the evals before and after ([AUDIT_2026-11-10.md](AUDIT_2026-11-10.md) section 3).

### D85. Game kits: input, feel, 3D checks, and fixes that reach projects already built
- Date: 10 Nov 2026 · Found and built by: Claude, in the audit the owner asked for.
- **2D (`GameCanvas`).** Three bugs. Enter and Space on a focused Play button did nothing, because the game took those keys even while paused (a test that passes now times out on the old file). A key held when the window lost focus stayed held. A key pressed on the start or game-over screen became a jump on the first frame of the next round. Now the keyboard belongs to the page while the game is paused, and everything is let go on pause, on blur and when the tab is hidden. The canvas also fits the height of the screen, so a short or sideways phone shows the whole game.
- **Feel (`src/game/juice.ts`).** Particles, a screen shake, floating score popups, easing and collision tests, none of which allocate while the game runs. The guide asked for feedback on every action and gave the builder nothing to make it with.
- **3D (`Scene3D`).** `onReady` now receives `input` (the same shape as the 2D kit's, with a pointer in the units a raycaster takes) and `onCleanup`. New props: `touch` (stops the page scrolling under a finger that is steering), `paused` and on-screen `controls`. Before this each 3D game added its own `window` listeners with no way to remove them; in the preview, where React mounts twice, they fired twice.
- **The run check plays 3D too.** It presses Start and the keys as it does for a 2D game, then looks at the WebGL canvas from inside the page, straight after the scene's own frame. One flat colour, twice, is reported as a scene with nothing in view. Scenes that wait for an uploaded model or picture are skipped, because uploads are blank stand-ins in the check.
- **Fixes reach existing projects (`Kit.superseded`).** Kit files are never overwritten, so until now a fix to one never reached an app already built. Each kit can list the sha256 of earlier versions it shipped; a project still holding one of those, untouched, gets today's file at the start of its next build. A file the builder or the person changed never matches and is left alone. Both new files take the same props as the old ones.
- **UNVERIFIED.** A real phone, MiniPay, and WebGL in the production `checker` container (without it the 3D check reports nothing, as before).

### D86. Kits turn on from the first request, not from "Start building"; previews use the Tailwind that publishing uses
- Date: 10 Nov 2026 · Found and built by: Claude.
- **Kits after plan-first.** D71 turns a kit on from the request's words so it is there even if the builder forgets to ask. But a first build normally starts from the plan's Start building button (D32), whose message is "Start building": the person's words were in the message before it and were never looked at. On a first build the earlier user messages now count. Later turns still go by their own request, so a word from long ago doesn't turn a kit on.
- **Tailwind.** The Sandpack preview loaded `@tailwindcss/browser@4` from jsDelivr, which resolves to the newest 4.x (4.3.5 on 10 Nov 2026), while publishing compiles with the installed 4.3.4. It is now pinned to the installed version (`TAILWIND_VERSION` in `src/lib/preview-engine.ts`), and a test fails when the two differ. The CDN dependency itself is unchanged (Q36).
- **Chat.** The chat follows a build's new steps only while the reader is at the bottom of it.

### D87. The review: the builder looks at its own page on a phone and a computer, and fixes what it sees (off until measured)
- Date: 10 Nov 2026 · Proposed by: Claude (the audit's first recommendation, Q42) · Decided by: the owner ("yes, build the review step on this branch") · Built by: Claude.
- **What.** After a build passes its checks, the run check (D67) opens it once more and takes a picture at 375px and at 1280px. The strong model reads both with the request and the builder's own plan, and lists up to five things a person would call broken or unfinished. The build model then gets that list for one pass. Code: `src/server/agent/review.ts`, and the block after the fix loop in `runner.ts`.
- **Why the strong model looks and the cheap one fixes.** Looking is cheap on any model; the worst case the hold allows for is $0.022 a look (two pictures, the full 700 output tokens, 25% markup), and Claude's estimate of a typical one is about a cent. The cheap model's own reviews were measured reporting problems that weren't there (HARNESS.md, "Weak spot"), which costs only attention while a person decides and costs a build once the list goes straight to a fix. Writing the fix is where the cheap model is cheap (under $0.01 measured for a "Fix these" build).
- **It can't leave a build worse.** One look and one pass, no second look. If the pass breaks a check, the files go back to how they were and the turn ends as it would have without the review; what was seen is kept on the turn with a "Fix these" button. It doesn't run on a build that is still failing checks, on a build at its free-AI ceiling (D82) or past its fix budget, or on a server without the run check. A reply that isn't a usable verdict changes nothing.
- **When.** Every first build, and a later turn only when it changed 60 or more lines of what people see (`.tsx`, `.css`, `public/index.html`). A look costs about twice a small edit, so a new label isn't worth one.
- **What the reviewer is told not to report**, because the run check has no network, wallet or chain: uploaded pictures show as empty boxes, web fonts fall back to the system font, contract numbers show as loading shapes or zeros, and "Deploy the contract to go live" and "Connect wallet" are expected. Also taste, and new features.
- **Resume and billing (P18, D49).** The look is saved and replayed like every other model call, so a build resumed after a crash never asks or pays for it twice (tested at every save point). It is charged to the build, and on a paid build it is checked against the hold first, like any call.
- **It replaces the browser's visual check (P17) where it runs.** A turn that has a review doesn't trigger the in-browser one. That check needed the tab open and the Sandpack preview, was skipped on the own-build preview (every 3D project), and never changed anything. It stays for builds the review didn't look at.
- **Found while building it.** The run check's screenshots only ever showed the first screen: without `fullPage` the browser cuts a picture off at the bottom of its window, whatever height is asked for. Nothing used them until now. Fixed, with a test. They also showed GoodBuild's own badge; it is closed first.
- **Off by default.** `VISUAL_REVIEW=1` in `.env.production` turns it on (the worker reads it). The Evals workflow has a `visual_review` option, so the suite can be run with and without it.
- **Checked.** With a scripted model: the review's four outcomes (looks right, fixed, fix dropped, nothing changed), the cases where it must not run, and resume after a crash at every save point. With the real headless browser: a build of a landing page produced the two pictures, which were looked at by eye (whole page, no badge, motion content in its final state).
- **UNVERIFIED.** No real model has reviewed anything. The reviewer's prompt, the five-issue limit and the 60-line rule are judgements. What a look really costs, how often it finds something real, and how often the cheap model's fix sticks are all unmeasured: run the evals both ways before turning it on.

### D88. Games ask "work inside MiniPay?", and the MiniPay kit gets a checklist (amends D32, D74)
- Date: 11 Nov 2026 · Asked for by: the owner ("When a user asks for a game, part of the questions you ask them is if they would like the game to be MiniPay compatible. Then add a checklist so all the MiniPay requirements should be built.") · Built by: Claude.
- **The question.** For a game, the server adds a fixed card before the colours one, the same way it adds the palette card (`miniPayQuestion` in `plan-intake.ts`): "Should your game work inside MiniPay, the wallet app on many phones?", with "Yes, make it MiniPay ready" (recommended, because most GoodBuild users are in places where MiniPay is common) and "No, just the web". It is in the fallback questions too. The model is told not to ask it, any MiniPay question the model writes is dropped, and the model gets one card fewer so a game is never more than five. It isn't asked when the request already says MiniPay, because the kit turns on from those words. A request counts as a game by the game kit's words, or by "game" in a request that isn't a website, so 3D games are asked too.
- **Yes turns the `mini-app` kit on** for the build: `planBrief` returns `miniPay`, and the runner adds the kit. The No label never says MiniPay, so the kit's keywords can't turn it on from that answer.
- **The checklist** (`MINIPAY_CHECKLIST` in `kits/mini-app.ts`) lists every MiniPay requirement from its docs and listing: connects by itself, no sign-in signature, legacy transactions with the fee in dollar coins, the right decimals, Add cash, no new tabs, the footer, the info pages filled in, the phone layout, opening from the test page, and Celoscan verification. Each item says whether GoodBuild checks it from the files, only a phone can show it, or it's only for the listing. The builder gets the list in the kit's guide. `miniPayChecklist(files)` gives each item's status for a project, so the chat can show it. The payment items are "not needed" in a game with no money in it.
- **One new check:** a link with `target="_blank"` in a MiniPay app. MiniPay's docs say links must not open new tabs, because it has none.
- **The published bar's links** (the GoodBuild logo and Report) were `target="_blank"` on every app. In a MiniPay app they now open in the same view.
- **The chat's MiniPay guide** (`components/workspace/minipay-guide.tsx`). The owner picked option A, step cards, from https://claude.ai/artifact/YFBsBnrvZU61RJeKKpq9c2, and said "they should deploy and publish first". It shows under the newest reply in any project with the MiniPay kit. The steps are: deploy (only if the app has contracts), publish (or publish again when the public link is older than the current version), copy the link, open Settings, tap Version, open Developer Settings, turn on Developer Mode and Use Testnet (on Celo mainnet: leave Use Testnet off), Load test page, check it works. Next stays locked on deploy and publish until each is done, and the card opens on the first step still to do. Each step has a phone sketch with a pink dot on what to tap. The sketches are drawings, not MiniPay's real screens, so they don't go out of date when MiniPay changes its look. The last step says how many checklist items GoodBuild checked, with a "Fix these" button when some aren't met. The card can be hidden; a "Test it in MiniPay" chip brings it back, remembered per browser. To see it: `/dev/preview?minipay=deploy|publish|ready`.
- The checklist moved to `src/lib/minipay-checklist.ts` so the browser and the builder read the same list.
- **UNVERIFIED:** any of this with a real model, and in the real MiniPay app. The testing steps come from MiniPay's "Test in MiniPay" page (11 Nov 2026), which doesn't say how many taps on Version it takes. The add-cash link the kit uses (`link.minipay.xyz/add_cash`) wasn't checked against MiniPay's deeplinks page, which says not to hard-code the link.

### D89. Ten more UI pieces in every app: dialog, sheet, tabs, select, dropdown menu, tooltip, toast, accordion, avatar, switch (numbered D88 at first; renumbered because main took D88 for the MiniPay guide while this was open)
- Date: 11 Nov 2026 · Proposed by: Claude (the audit, item 6) · Decided by: the owner ("build the ten more UI primitives next") · Built by: Claude.
- **What.** Ten pieces beside the starter's eight, in `src/components/ui/` of every project, with a `ui-components` guide. Source: `src/server/agent/ui-primitives.ts`. Projects made before them get them at the start of their next build, the way missing starter helpers always have; a file a project already has under one of those names is never replaced.
- **Why in the starter and not a kit.** A kit is turned on by a request's words, and nobody asks for "a dialog": they ask for a tip jar, and the tip jar needs a confirmation. So the pieces are simply there. They cost a published app nothing until one is imported.
- **No package, and the browser does what it does better.**
  - Dialog and Sheet are the native `<dialog>` opened with `showModal()`. The browser traps focus, makes the page behind inert, closes on Escape and gives focus back. A hand-written focus trap is the part these components most often get wrong.
  - Select is the native `<select>`, styled. On a phone that opens the system picker. It is deliberately not shadcn's Select, and the prompt and the guide both say so, because the builder will expect `SelectTrigger`.
  - The rest (tabs, dropdown menu, tooltip, toast, accordion, avatar, switch) are small React components with the roles, keys and focus behaviour of the ARIA patterns for each.
- **Names follow shadcn/ui** where the shape is the same (`Dialog`, `DialogContent`, `DialogTitle`, `Tabs`, `TabsTrigger`, `Accordion`, `DropdownMenuItem`, `asChild` on triggers), because that is what the builder already expects to write. Toast follows sonner's `toast()`, `toast.success()`, `toast.error()`, and needs no setup: it adds its own `<Toaster />` if the page has none, so a toast is never silently lost.
- **Toast and Notice.** A toast is for a passing confirmation ("Copied"). Anything a person must read or act on (a failed transaction, a form error, "Deploy the contract to go live") stays a Notice on the page; the guide says so, and the ui-states guide is unchanged.
- **Where toasts appear.** At the top on a phone, bottom right on wider screens. The first version put them at the bottom everywhere, and on a phone the "Built with GoodBuild" badge of a published app (D80) covered the message. Seen in a screenshot, fixed, tested.
- **Cost to builds.** The pieces are about 33,000 characters of source. Sent with every turn that would cost more than most small edits do, so they are left out of the files sent in full (like the data helpers): the builder sees them in the file list with their exports, and the guide documents them. The system prompt grew by one sentence.
- **The file limit went from 80 to 92.** The pieces add 11 files to every project, and without this an app would have had that much less room for its own.
- **Size.** Measured with the publish bundler: a page using all ten adds 7.3 kB gzipped of script and 0.2 kB of styles over a page using three of the first eight. A page that imports none adds nothing.
- **Other guides now point at them.** The phone menu in `pages-and-routing` is a Sheet in place of a hand-written panel, and FAQs in `landing-page` and `content-pages` are an Accordion in place of `<details>`.
- **Checked.** In headless Chromium on an app built by the publish bundler, at phone width: the dialog opens centred with focus inside, is named by its title, keeps Tab off the page behind, closes on Escape, on Cancel and on a tap outside, and gives focus back; the sheet fills its edge; tabs and the menu answer the arrow keys; the switch and its label both toggle it; a link in a closed accordion section can't be reached by Tab; the avatar is the same colour for the same wallet; nothing scrolls sideways. App check and type check pass on a page using every piece.
- **Checked afterwards (11 Nov 2026), at the owner's request.**
  - **The Sandpack preview.** A page with the workspace's own `SandpackProvider` settings (template, dependencies, the pinned Tailwind) was opened in headless Chromium against CodeSandbox's real bundler. All ten pieces work there: the stylesheet loads, the dialog and sheet open and close, tabs, select, switch, menu, toast, accordion and avatar behave as on the own build. The motion kit (D84), which had the same gap, was run the same way and passes: reveals, the aurora, count-up, no sideways scroll.
  - **A phone, emulated.** The same run with a touch screen, a 390px screen and a MiniPay-style Android browser identity, using taps: all pass. This is Chromium pretending, not MiniPay.
  - **What a screen reader is given.** The browser's accessibility tree has the right roles, names and states for every piece (tab selected, button expanded, switch, the select's label, the avatar's name), leaves out a closed accordion section, and with a dialog open contains the dialog and nothing of the page behind it. This is in the test suite.
  - **A real model, five builds (11 Nov 2026, `scripts/live-check.mjs --no-claude`, the owner's DeepSeek key).** Five new live-check scenarios (`ui-*` in `docs/evals/live/scenarios.json`) ask for a confirmation pop-up, a slide-in phone menu with an FAQ, tabs with a dropdown and a switch, a members list with pictures and a three-dot menu, and a pop-up order form added on a second turn. None names a component.
    - All six turns ended ready on the first try with no fix attempts, for $0.20 in all ($0.025 to $0.054 a build, 45 to 174 seconds a turn).
    - Every build imported the right pieces: dialog and toast; sheet and accordion; tabs, select and switch; avatar, dropdown-menu and dialog; dialog. None hand-wrote a modal, tabs, a menu, a `<details>` FAQ or an overlay, and none used shadcn's `SelectTrigger`: Select was written as the browser's own, with `<option>`s and a Label.
    - Each built app was then opened at phone width and clicked through (menu sheet, FAQ, tab, dropdown, switch, order pop-up): no errors.
    - **One defect, the builder's own:** the bakery page scrolls 16px sideways on a phone. This is the kind of thing the review (D87) is for; it was off in this run.
    - **Limits of this run:** five builds on one day. No Claude key could be used in the test session, so a fix would have fallen back to DeepSeek; none was needed. The live check's own playback step failed on every app because the test machine lacks the video recorder it needs, so the click-through was done separately.
- **UNVERIFIED.** A real phone, the real MiniPay browser, and a real screen reader (VoiceOver, TalkBack), which can read a correct tree badly. More than five real builds: the eval suite is still the proper measure.

### D90. MetaMask connects when the wallet hasn't added Celo Sepolia
- Date: 11 Nov 2026 · Reported by: the owner (an app built with GoodBuild showed `endowment:caip25 error: Received scopeString value(s): eip155:11142220 for caveat of type "authorizedScopes" that are not supported by the wallet.`) · Decided by: the owner ("fix both") · Built by: Claude.
- **Cause.** Commit `0f7530a33` (10 Nov) asks MetaMask for an account with `endowment:permitted-chains` set to Celo and Celo Sepolia, so Tron stays out of the approval. MetaMask turns that list into CAIP-25 scopes and refuses the whole request if it names a network the wallet hasn't added. Celo Sepolia is a new network, so a wallet often hasn't added it (unverified how often), and generated apps run on it by default. The fallback took every such error for the Tron case: it revoked the visitor's permission and sent the same request again, which failed the same way. `ensureChain`, which adds the network, only runs after an account comes back, so it never got the chance.
- **Fix.** In the generated apps' wallet layer (`src/server/agent/wallet-template.ts`) and GoodBuild's own sign-in (`src/lib/auth/metamask.ts`): when the error names `eip155:` networks, ask again without them, without revoking anything. If neither Celo network is left, ask for Ethereum (`0x1`), which every MetaMask has and which still keeps Tron out. The app then adds and switches to its chain as before. Revoke-and-retry stays, once, for errors with no `eip155:` network (the Tron case).
- **Reach.** Builder projects get the new wallet layer on their next turn or publish (`withCurrentWalletHelpers`). Apps already published stay broken until they are republished.
- **Checked.** Unit tests with the exact error message (both files). **UNVERIFIED:** a real MetaMask without Celo Sepolia and with a Tron account. In particular, whether switching to a network added after connecting also extends this site's permission to it without a second prompt.

### D91. A public stats page at /stats, with the same data at /stats.json (owner, 11 Nov 2026; numbered D90 at first, renumbered because main took D90 for the MetaMask fix)
- **What.** A signed-out page with users, sign-ups (weekly chart), projects, finished builds, live apps, contracts and transactions on Celo, and lists anyone can check: every mainnet contract linked to Celoscan with its deploy transaction, and the live apps. `/stats.json` carries the same numbers and the full contract list, open to any site (CORS `*`). Linked from the footer and the sitemap.
- **Owner's choices (11 Nov 2026).** On-chain figures are **Celo mainnet only** (the request said "Java networks", read as Celo; the owner chose mainnet only). **Counts only, no money**: no revenue, credits sold, G$ paid or AI spend. **Addresses and explorer links** to make it checkable, not a live chain re-read.
- **How it counts.** All numbers come from our own database; there is no web analytics tool, and adding one would be a privacy and terms change. Contracts are distinct mainnet addresses. Transactions are distinct deploy transactions plus one more for each contract behind a proxy (code, then proxy), plus two per upgrade (code, then switch), plus distinct credit-purchase transactions. "Signed in this week/month" is `users.last_seen_at`, which only moves at sign-in. A finished build is a `build`-mode turn job with status `done` (planning turns are left out). Live apps use the landing showcase's filter (no unpublished apps, no takedowns).
- **Privacy.** The credits contract is not linked: its Celoscan page would show every amount paid, which the owner chose to keep private. No wallets (deployer or buyer), emails, user ids or project names except live apps' names, which are already public. A test checks the output holds none of them.
- **Load.** The numbers are worked out in a `"use cache"` function at most every 10 minutes, so a public page can't be used to hammer Postgres.
- **Known gap.** Deleting a project deletes its deployment rows (`onDelete: cascade`), so its contracts drop out of the count while they stay on Celo. The page says so. Fixing it means keeping deployment rows after a project is deleted, a schema change left for later.
- **UNVERIFIED** on the live site and against production data.

### D92. Games right first time: a drawn start screen, a leaderboard that works in MiniPay, and plan cards for obstacles, power-ups and characters (amends D72, D88; numbered D90 and then D91 at first, renumbered because main took D90 for MetaMask and D91 for the stats page while this was open)
- Date: 11 Nov 2026 · Asked for by: the owner, after a MiniPay car racer took 7 versions ("Go ahead with Phase A and B together. wallet only for leaderboard"; picked the hybrid leaderboard) · Built by: Claude · Plan and diagnosis: [GAMES_PLAN.md](GAMES_PLAN.md).
- **The start screen was always empty (kit bug).** `GameCanvas` skipped drawing while `paused`, and the guide said to pause on the start and game-over screens, so those screens showed an empty box ("large empty pink space" in the owner's build). New `onIdleFrame` prop: called while paused, it draws the game world and never moves the game on. `onFrame` is unchanged, so games already built behave the same. The old file's hash is in `superseded`, so untouched copies get the new one. A file check asks for `onIdleFrame` whenever a `GameCanvas` is paused. It reads the whole tag, arrow functions included.
- **Leaderboard: wallet-only to post, hybrid by the owner's choice.** Playing never needs a wallet. Posting does. MiniPay forbids the sign-in signature, so:
  - In a browser, the kit's `useLeaderboard` signs in once (free) and keeps one best per wallet in app data. The rule is `"scores": {"create": "signed-in", "read": ["anyone"], ...}`, and a check asks for it.
  - Inside MiniPay, it posts to `contracts/GameBoard.sol`, which keeps each wallet's best and the top 25. The network fee is paid in the first dollar coin the player has.
  - The board reads both and shows one row per wallet.
  - The contract is its own kit, `game-board`. The runner turns it on only for a 2D game that has a leaderboard and works in MiniPay, because a contract means a deploy.
  - Its five tests run in the local EVM. Earlier, the two guides contradicted each other: the game guide's leaderboard needed the signature MiniPay forbids.
- **Kit files:**
  - `src/game/leaderboard.ts` (`useLeaderboard`, `cleanName`, `SCORES_RULE`).
  - `src/game/Leaderboard.tsx` (`Leaderboard` and `PostScore`). These cover loading, empty, error with Retry, "(you)", what posting costs, and the wallet being cancelled.
  - `src/game/Sprite.tsx`. One drawing function is shown outside the canvas, in garage cards, the store and leaderboard rows, instead of the same car being drawn a second way.
  - `src/game/chainBoard.ts` (game-board kit). It needs nothing from the MiniPay kit.
  - The MiniPay sign-in check leaves `src/game/leaderboard.ts` alone, because that file signs in only outside MiniPay.
- **Saved data reads clamp `limit` to 100** in `collection().list` (and so `useCollection`), for every app. Before, a board asking for 200 got an error.
- **Free play first** is now the opening rule of the game guide. The guide also asks for these, and closes with a checklist:
  - every obstacle, power-up and character the plan names, each with its own name in the code;
  - the first obstacle within 3 seconds;
  - NPCs that signal before they act;
  - power-ups with a visible timer;
  - the score drawn on the canvas.
- **Run check (D67):**
  - For a 2D game it looks at the start screen before pressing Play. It reports a canvas that is one flat colour, and a start screen with no Play or Start button (also "race").
  - The blank check after play now treats a one-colour canvas as blank, not only a see-through one.
  - With screenshots on, a 2D game's phone pictures are its start screen and a moment of play, then the computer width.
- **Review and visual check:** the review (D87) is told which picture is the start screen and which is play. The in-browser visual check (P17) is told it sees a game before Play, so it doesn't report obstacles, characters or a counting score missing. A request is a game by any of the project's own messages. Those false reports cost the owner a build each.
- **Plan (D32, D88):**
  - For a game, the planner always asks about obstacles and challenges, power-ups, and the computer's characters, each on its own multiple-choice card fitted to the game. If the model leaves one out, a generic card is added.
  - The model gets 5 cards. The server adds Leaderboard (skipped when the request already asks for one), MiniPay and Colours, so the most is 8. The owner didn't pick between 6 and 8; Claude went with the proposal's 8.
  - The model's score questions are dropped for games.
  - The planner also returns a game brief (name, pitch, loop, how a round ends, how it gets harder, two or three extras). The plan card shows it and the builder gets it as the spec. It can't be edited on the card yet: a later message changes it.
  - The game rules and the brief field go only with a game's request, so other plans cost what they did. The plan's output limit went from 1,500 to 2,000 tokens. The worst case is still inside the planning headroom (tested).
- **Checked:**
  - In a real headless browser, a lane racer written the new way passes the run check, with screenshots in the right order.
  - The same game without `onIdleFrame` is caught, and so is a start screen with no Play button.
  - The contract compiles and its tests pass.
  - A MiniPay game passing `gameBoard(GameBoardAbi, GameBoardAddress[chain.id])` passes the app check, the MiniPay checks and the type check. Forgetting it is caught.
  - The runner turns `game-board` on for "A snake game for MiniPay with a leaderboard", and not without MiniPay.
  - Planner cards, brief and costs are tested.
  - The whole test suite passes.
- **UNVERIFIED:**
  - Any of this with a real model: whether DeepSeek writes fitting obstacle, power-up and character cards, and a good brief.
  - The leaderboard on a published app with a real wallet signature.
  - A real MiniPay post: fee-currency payment for a contract call, and how MiniPay shows it.
  - The plan card's look in the workspace (only tested in jsdom).
- **Not in this change:** Phases C (building blocks and the game probe), D (a bot that plays, and run-check tests of the leaderboard and wallet), E (shop contract) and F (extras) of the plan. B4 (checking that the planned obstacles appear) needs the probe from Phase C.

### D93. Games are played and tested: building blocks, a game probe, and a run check that plays, posts a score and connects a wallet (phases C and D of GAMES_PLAN.md)
- Date: 11 Nov 2026 · Asked for by: the owner ("go ahead with phase C and D") · Built by: Claude.
- **Building blocks** (new kit files in `src/game/`, source in `kits/game-blocks.ts`). No packages, and nothing is allocated while the game runs. The guide has a section on each and asks the builder to use them instead of writing its own:
  - `world.ts`: `Pool`, `Spawner` (a short grace before the first spawn, faster with difficulty, never closer than its fastest gap), `difficulty(seconds)`, `lanes`, `pick`.
  - `npc.ts`: one `Actor` shape for `traffic`, `oncoming`, `chaser`, `patrol`, `shooter` and `rival`. Each sets `warn` from 0 to 1 before it acts, so a player can react. Also `hitBox` (a little smaller than what is drawn) and `offscreen`.
  - `powerups.ts`: `Effects` (activate, isActive, remaining, fraction, update with an end callback), with colours for shield, magnet, slow, double, boost and life.
  - `hud.ts`: `drawHud` (the score panel, distance, best, lives, combo, a shrinking bar per power-up) and `drawBanner`.
  - `haptics.ts`: `buzz`, which the mute button also turns off.
- **The game probe** (`src/game/probe.ts`). The game calls `declareGame({ obstacles, powerups, npcs })` once, `spawned(kind)` when one is created, and `probe(score, x, y, speed)` each frame. `GameCanvas` reports rounds: one starts when the game runs, and ends when it pauses or the canvas leaves the page. All of it returns at once unless the run check turned it on (`window.__gbGame`), so real players never pay for it. A file check asks for all three calls in any project with a `GameCanvas`.
- **Checking is faster than real time.** While the check runs, `GameCanvas` runs 4 game steps per screen frame, so about 7 seconds of play cover about 28 seconds of game. The probe keeps its own clock, so a game that mounts a fresh canvas each round is timed right. The first moments of play run at normal speed, so the blank-canvas check and the review's "playing" picture see what a player sees.
- **The run check plays a 2D game** (new `game-check.ts`; not for the review's screenshot run):
  - **The bot.** It presses Play with no wallet, then taps both sides and presses the keys for about 7 seconds. After each game over it presses Play again and checks a new round starts.
  - **What it reports to the builder's fix loop:**
    - a score that never rises;
    - no obstacle or character within 3 seconds of Play;
    - a declared kind that never appeared in a round of 15 seconds or more;
    - controls that never moved the player (x or y);
    - a game that didn't get harder (the speed passed to `probe` never rose) in a round of 10 seconds or more;
    - no Play again button, or one that doesn't start a round;
    - no `probe` calls at all.
  - **It stays silent when it can't tell.** If the bot never survived long enough, it writes a note rather than an issue, because a false finding costs a fix.
- **With a stand-in wallet** (a second page with `window.ethereum` that says yes and logs what it was asked):
  - If the page has a Connect wallet button, pressing it must ask the wallet for an account and then show the short address.
  - If the game shows `PostScore`, the check plays until a game over, posts a score as "Check Bot", and needs both "You're on the board!" and the name in the leaderboard list. This runs on the preview store, because the run check's build has no data server; the data rule itself is the file check from D92.
- **As MiniPay** (a third page, only with the MiniPay kit): a visible Connect wallet button is reported, and so is any signature request. Play must still work.
- **Time.** A game's run check may take up to 50 seconds (other apps keep 25). Measured locally, a game with a leaderboard took 12 to 15 seconds per check.
- **Planned kinds (B4)** are tested through `declareGame`: the guide tells the builder to declare the kinds the plan named, with the same short names. Nothing yet compares the plan's wording with the declared names.
- **Changed from the plan.** There is no forced game over (`endRound`): a game that never ends during the check simply isn't judged on Play again. The leaderboard is tested on the preview store rather than an in-memory server that applies the project's rules, which the file check already covers.
- **Games already built** get the new kit files (they are added, never overwritten). Their next build will be asked to add `declareGame`, `spawned` and `probe`, which costs one fix round.
- **Checked:**
  - Unit tests for every rule, including when it stays silent (`game-check.test.ts`).
  - In a real headless browser:
    - a racer built only from the blocks passes the type check and the run check, meeting every kind it declared;
    - a game with no obstacles, score, control or rising speed gets all five findings;
    - a game over with no Play again is caught;
    - posting a score with the stand-in wallet shows it on the board;
    - a `PostScore` wired to a different board than the one on screen is caught;
    - a MiniPay game is opened as MiniPay, and a Connect wallet button there is caught.
  - The game tests passed twice in a row, and the whole suite passes.
- **UNVERIFIED:** a real model writing games with the blocks and the probe; how often the random bot survives long enough to judge everything in real builds; the extra check time on the production checker; real wallets and real MiniPay.
