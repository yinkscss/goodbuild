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
- **Treasury:** the weekly batch keeps about one month of provider bills in USDT and converts only the surplus to G$, because credits are USD liabilities and provider bills are paid in USD. **Parked by D38 (6 Nov 2026), along with the G$ vault deposit, for this launch.**
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

