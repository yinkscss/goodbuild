# Open questions

**These are NOT final.** Claude is invited to propose answers, challenge or change Ego's recommended decisions (D5–D10 in [DECISIONS.md](DECISIONS.md)) with reasons. User decisions (D1–D4) stay fixed unless the user changes them. Resolved answers move to DECISIONS.md.

## Q1. Contract templates vs free-form generation?
- Ideas so far: start from vetted templates (token, NFT, escrow, voting, ajo/ROSCA) that the AI customises; allow free-form later. Templates cut bug risk.
- Claude's input: _TBD_

## Q2. Which chains and testnets?
- Ideas so far: Celo mainnet + testnet only (see Q2 update: Alfajores retired, use Celo Sepolia) for Stage 1 (G$ lives on Celo). Others later, if ever.
- Claude's input: _TBD_

## Q3. How does G$ pay for generation?
- Ideas so far: G$ deposit (`transferAndCall`) into a vault → USD-denominated, non-transferable credits; free starter credits per GoodID root; daily claim-and-top-up. G$ is volatile and illiquid (see RESEARCH.md).
- Claude's input: _TBD_

## Q4. Security/audit of generated contracts
- Ideas so far: OpenZeppelin base contracts, static checks (e.g. Slither-style rules; tooling in browser UNVERIFIED), testnet-first by default, clear "unaudited" warnings, mainnet value caps.
- Claude's input: _TBD_

## Q5. MiniPay / mobile
- Ideas so far: mobile-friendly web first; MiniPay mini-app later (MiniPay supports G$ swaps). Is building on a phone realistic?
- Claude's input: _TBD_

## Q6. Pricing
- Ideas so far: per-generation credits at model cost + 10–15% fee; free tier funded from grant stream. Cost per generated app UNKNOWN.
- Claude's input: _TBD_

## Q7. Naming of credits
- Ideas so far: "Build credits"? Keep clearly non-money (closed-loop, non-redeemable).
- Claude's input: _TBD_

## Q8. Integrate the AntSeed vault?
- Ideas so far: use GoodDollar's `antseed-integration` vault/ledger as the funding layer instead of our own; ask GoodDollar whether allowed and whether a proxy is coming in S5.
- Claude's input: _TBD_

## Q9. Questions to ask GoodDollar
- Ideas so far: S5 scoring weights and Demo Day dates; whether deposits/deploys count as G$ volume; use of AI credits; grant-funded free credits.
- Claude's input: _TBD_

## Q2 update (4 Nov 2026)
- Alfajores was retired 30 Sep 2025; the current testnet is **Celo Sepolia** (chainId 11142220) (https://docs.celo.org/operate/notices/archive/celo-sepolia-launch). Proposal: Celo mainnet + Celo Sepolia.
- Claude's input: _TBD_

## Q10. Wallet kit and social login
- Ideas so far: wagmi/viem + RainbowKit vs Reown AppKit (built-in email/social); or thirdweb/Privy/Dynamic embedded wallets. Celo support and custody model per vendor UNVERIFIED. See [CONTRACTS_AND_DEPLOYMENT.md](CONTRACTS_AND_DEPLOYMENT.md) §1.
- Claude's input: _TBD_

## Q11. On-chain registry or factory?
- Ideas so far: DB-only first; CREATE2 factory for top templates later (events count as on-chain activity, if GoodDollar counts them: UNVERIFIED). Pros/cons in CONTRACTS_AND_DEPLOYMENT.md §3.
- Claude's input: _TBD_

## Q12. Gas: who pays, and in what?
- Ideas so far: user pays in CELO; cUSD/USDC fee currency where the wallet supports it. G$ as fee currency UNVERIFIED (not on the Sepolia allowlist). Sponsored gas (paymaster/relayer) later from grants?
- Claude's input: _TBD_

## Q13. Where do Slither / Foundry tests run?
- Ideas so far: solhint + browser EVM tests in-browser every build; Slither + forge in a small server worker before mainnet. Is a server acceptable in Stage 1?
- Claude's input: _TBD_

## Q14. Edit format and model routing
- Ideas so far: search/replace diff edits via tool calls; strong model for builds, cheap for small edits/fixes; 3-retry cap. Which models within D9 constraints? See [AI_AGENT.md](AI_AGENT.md).
- Claude's input: _TBD_

## Q15. Free-form contracts on mainnet?
- Ideas so far: templates only on mainnet in Stage 1; free-form testnet-only, or allowed with strong warnings and value caps.
- Claude's input: _TBD_

## Q16. Publishing / hosting of generated apps
- Resolved for hosting by P19: GoodBuild serves each app at `<slug>.goodbuildit.xyz` from a stored build.
- Still open: wildcard DNS through Vercel's nameservers (D26), moderation, and a real contact address. Takedown is `scripts/takedown.mjs`, `/report` takes reports once `NEXT_PUBLIC_CONTACT_EMAIL` is set, and `/support` takes tickets once `SUPPORT_EMAIL` or the Telegram bot is set (D89). `/terms` and `/privacy` are unreviewed drafts.

## Q17. How does GoodBuild spend users' GoodDollar AI credits? (superseded by D11; kept for a future AntSeed provider)
- Ideas so far: (A) hold user's derived AntSeed buyer key in a server-side AntSeed gateway; (B) wait for GoodDollar's `gd_live_` keys + Worker proxy (not yet implemented). See [GOODDOLLAR_AI_CREDITS.md](GOODDOLLAR_AI_CREDITS.md) §4–6.
- Claude's input: _TBD_

## Q18. Credit unit and display
- Ideas so far: 1 credit = 1 micro-USD, show dollars. See [CREDITS.md](CREDITS.md).
- Claude's input: _TBD_

## Q19. G$ price source
- Ideas so far: GoodDollar reserve\/static oracle, fallback DEX TWAP or CoinGecko; snapshot per deposit. See [CREDITS.md](CREDITS.md).
- Claude's input: _TBD_

## Q20. Spend metering
- Ideas so far: LiteLLM callback debit (B) vs per-user virtual keys (A). See [CREDITS.md](CREDITS.md).
- Claude's input: _TBD_

## Q21. Markup
- Ideas so far: 20–30% over provider cost. See [CREDITS.md](CREDITS.md).
- Claude's input: _TBD_

## Q22. Refunds and withdrawals
- Ideas so far: non-refundable by default; 30-day refund of unused paid balance at snapshot price minus fees. See [CREDITS.md](CREDITS.md).
- Claude's input: _TBD_

## Raised during the Stage 1 build (Claude, 4 Nov 2026)

## Q23. Tailwind v4 instead of `tailwind.config.js`
- DESIGN_SYSTEM §6 is written for Tailwind v3. Current Tailwind is v4.3 and the shadcn CLI targets v4, where theme config lives in CSS `@theme`.
- Claude's input: M1 uses v4 with §6's tokens mapped 1:1 into `src/app/globals.css` (same names and hex values, shadcn variables as `hsl()` colours). The default Tailwind palette is reset so only design-system colours compile. Pinning v3 is possible but would fight current shadcn. **Needs user OK** (recorded as P6).

## Q24. Landing metric card shows sample numbers (resolved 5 Nov 2026: removed before launch; the card now states facts about the beta, and real numbers can return once they exist)
- "2.48M G$ deployed this week" and "14,902 contracts compiled" are mockup values. Shown as "Live" at launch they would be false, and DESIGN_SYSTEM §7 asks for real numbers.
- Claude's input: M1 feeds the card from `src/config/landing-stats.ts` with `isLive: false`, which shows a "Preview" chip. Proposal: wire it to the deployments table (M5) and switch to "Live" then. Also reconsider the metric: "G$ deployed" is unclear; "G$ moved through GoodBuild apps" or "dApps deployed" is easier to defend.

## Q25. "Pre-audited" template copy
- The mockup says templates are "pre-audited". GoodBuild templates are not audited; their OpenZeppelin bases are.
- Claude's input: M1 copy says "built on audited OpenZeppelin contracts" and the eyebrow reads "Audited building blocks". Revert only once templates have their own audit.

## Q26. Credit price vs real build cost (resolved: D13)
- Mockup b shows "≈ 4 G$ per build" and "120 G$ ≈ $0.02". At ~$0.000112/G$ (RESEARCH.md), 4 G$ is about $0.0005. A strong-model build is plausibly $0.05–$1 (UNVERIFIED until the AI_AGENT §8 benchmark runs), i.e. roughly 450–9,000 G$. The daily UBI claim (~126 G$) would not fund one build.
- The UI also shows balances in G$ while CREDITS.md stores USD micro-units and says to show dollars (Q18).
- Claude's input: decide before M3/M6. Proposal: show USD as the primary unit ("$0.42 of build credit") with G$ as the deposit currency; show the per-build estimate from real metered cost; lean on the GoodID free tier for first builds.

## Q27. Mainnet unlock rule
- Mockup b: "Mainnet unlocks after your first verified contract". CONTRACTS_AND_DEPLOYMENT §1: mainnet deploys gated on GoodDollar face verification.
- Claude's input: pick one before M3. Proposal: face verification (it also produces the verified users S5 scores on).

## Q28. Status-dot green
- Mockups b and c use `#35D07F` for status dots; the token is `success #1F9D6B`.
- Claude's input: use the token everywhere (M3 onward).

## Q29. Hero "building" image (resolved)
- DESIGN_SYSTEM §8.1 asked to replace the hero render with a "building" image. M1 first shipped a code-drawn block stack.
- Resolved 4 Nov 2026 by the user: keep the original render `design/landing/assets/hero-b.jpg`. §8.1 updated; the SVG version was removed.

## Q30. Storing the email of email-login users
- AUTH.md says to store the email for email logins. The browser knows it, but the server can't trust a client-supplied email.
- Claude's input: M2 stores no email. Doing it properly means verifying the Magic DID token server-side (D22 already does this on sign-in; Magic returns the email in its user metadata). Proposal: add that when email is actually used (receipts, notifications).

## Q31. Hosting and the geo-block
- The API returns 451 for US and comprehensively sanctioned regions (CU, IR, KP, SY; list UNVERIFIED, confirm with counsel), read from the host's country header (`x-vercel-ip-country` or `cf-ipcountry`). With neither header (other hosts, local dev) only the attestation applies.
- Published app hosts also return 451 for these regions (P19), so a public link isn't viewable there.
- **Running on one VPS with Cloudflare in front (D27);** the plan below is on hold.
- **Host decided (D26):** Vercel in front, Railway behind on its trial first. Vercel sets the country header and applies the block; `EDGE_SECRET` stops anyone reaching Railway directly.
- Claude's input: confirm the country list with counsel. Pages stay viewable everywhere; only sign-in, building and credits are blocked.

## Q32. MiniPay / Valora detection
- The modal marks MiniPay as detected when `window.ethereum.isMiniPay` is set, and connects it as the injected wallet; elsewhere "MiniPay / Valora" falls back to WalletConnect. Not yet tested inside MiniPay (UNVERIFIED), per AUTH.md's pre-M2 check.

## Q33. Home (M3) choices to confirm (resolved: user approved all defaults)
- **Credits pill before M6:** shows "Testnet beta · free" instead of a balance, because the ledger doesn't exist yet. The low (≤10 G$) and zero states are built and tested; M6 supplies the real balance. Still depends on Q26 (G$ vs USD as the main unit).
- **Mainnet copy:** "Mainnet unlocks after GoodDollar face verification" (CONTRACTS_AND_DEPLOYMENT §1), not the mockup's "after your first verified contract". See Q27.
- **Account pill:** follows DESIGN_SYSTEM §3 (white pill, pink dot, address) rather than mockup b's black pill, so it matches the landing and workspace.
- **Chips:** mockup b's "Streaming G$ payroll" is swapped for "Crowdfund with refund", since Superfluid streaming is post-MVP (CREDITS.md §2).
- **Not yet built:** Templates, Deployments and Credits pages (shown as "Soon" in the sidebar) and "View all" (the grid shows the latest 8).

## Q34. `deepseek-chat` vs `deepseek-flash` (resolved: D16)
- On 4 Nov 2026 DeepSeek's pricing page (https://api-docs.deepseek.com/quick_start/pricing) listed only `deepseek-flash` (DeepSeek-V4.1-Flash-1017; $0.30 / $1.20 per MTok input/output at peak, half off-peak) and `deepseek-v4-pro`, and said older names route to the current Flash model. `deepseek-chat` isn't mentioned, so it may stop resolving.
- Claude's input: use `deepseek/deepseek-flash` for `gb-cheap`. Switching is one constant in `MODEL_IDS` in `src/server/agent/model.ts`. Update (D18): `@ai-sdk/deepseek` 3.0.79 lists `deepseek-flash` as a model ID, so it is used as is.

## Q35. Is Celo (and Celo Sepolia) Cancun-compatible? (resolved: D17)
- OpenZeppelin 5.6 uses the MCOPY opcode, so contracts compile for EVM `cancun`. Celo's docs say Celo L2 is "fully EVM-compatible" on the OP Stack but don't name an EVM version (UNVERIFIED, checked 4 Nov 2026).
- Claude's input: M5 simulates every deploy on Celo Sepolia first, which will show it before anyone pays gas. Fallback if Cancun isn't supported: pin an OpenZeppelin release without MCOPY and compile for `shanghai`.

## Q36. Preview depends on CodeSandbox's hosted bundler and the Tailwind CDN
- Sandpack loads its bundler from CodeSandbox, and generated apps load Tailwind's browser build from jsDelivr. If either is down or blocked (some campus or corporate networks), the preview is blank while chat, code and contract views still work.
- **Partly answered by D69 (10 Nov 2026):** when Sandpack fails or stays silent for 20 s, the workspace now shows GoodBuild's own build instead, which needs neither CodeSandbox nor the CDN.
- Claude's input: acceptable for Stage 1. Later options: self-host the Sandpack bundler (supported via `bundlerURL`) and vendor the Tailwind browser build.

## Q37. Workspace chat width
- DESIGN_SYSTEM §4 says a 420px chat panel; mockup c splits 50/50.
- Claude's input: followed the design system (420px, 460px on very wide screens), which leaves more room for the preview. Easy to change.

## Q38. Editing code by hand
- The Code tab is read-only in M4, so the agent's files and checkpoints stay the single source of truth.
- Claude's input: allow manual edits later, saved as their own version.

## Q39. There is no G$ on Celo Sepolia (resolved: D23, deploy a test G$)
- Checked 4 Nov 2026 in GoodProtocol's `releases/deployment.json` (https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json):
  - `production-celo` (42220): G$ `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`, Identity `0xC361A6E67822a0EDc17D899227dd9FC50BD62F42`. Matches the docs (https://docs.gooddollar.org/for-developers/core-contracts).
  - `staging-celo`, `development-celo` and `pre-production-celo` are also on Celo **mainnet** (42220), with their own G$ addresses.
  - The only testnet listed is `alfajores` (44787), which Celo retired on 30 Sep 2025. **No Celo Sepolia (11142220) deployment.**
- So a G$ app deployed to Celo Sepolia has no real G$ to accept, and the M6 credits vault has the same problem on testnet.
- Claude's input: in M5, GoodBuild deploys one **test G$** on Celo Sepolia: an ERC-20 with ERC-677 `transferAndCall`, 18 decimals, and a rate-limited faucet (for example 1,000 test G$ per wallet per day). M5 prefills it as the G$ address for Celo Sepolia deploys, and the production G$ address for mainnet. Ask GoodDollar whether they plan an official Celo Sepolia deployment, and switch to it if so.
- Also confirm with GoodDollar that Celo G$ (a Superfluid SuperToken) implements ERC-677 `transferAndCall`. GoodDollar's antseed-integration relies on it, but the core-contracts page doesn't say (UNVERIFIED).

## Q40. Top-ups (D21): G$ in the UI, treasury design, rate source
- See [TOPUPS.md](TOPUPS.md) §10: D13 vs D21 on showing G$, why convert to G$ at all, the NGN→USD rate source and spread, fee bearer, email at top-up, admin identity, refund policy. Waiting for the user's review.

## Q41. Magic (D22): wallet list and pricing
- Coinbase Wallet is dropped from the connect modal (not in the user's list). Magic's pricing tier and key-export story were not compared; check before launch (UNVERIFIED).

### Template gallery: should templates be "unlockable"? (8 Nov 2026, from the gallery build)
The brief called the section unlockable. Today every template is open. Options: keep open (best for sign-ups), gate a few "premium" ones behind verified or paid credits (touches the credits code), or unlock by publishing a first app. Owner to choose. See [TEMPLATES.md](TEMPLATES.md).

### Files uploaded by an app's visitors (10 Nov 2026, from the app-data upgrades, D79)
The harness plan listed "file uploads" as an app-data upgrade: a visitor of a published app (a member adding a profile photo, a customer attaching a receipt) uploading a file that GoodBuild stores. Claude did **not** build it, and asks the owner to decide first:
- **Moderation and law.** Anyone who can add a file to an app can put illegal or abusive content on a `*.goodbuildit.xyz` address that GoodBuild serves and is responsible for. Records are small JSON and are easy to audit; files are not. It needs, at least: images only, a size cap, type check on the bytes, a report path on the file itself, and a takedown that reaches the file (the current takedown covers apps, not visitor files).
- **Storage.** Visitor files would live in the database now (D65) and Cloudflare R2 later. A free app with open uploads can fill the disk; it needs its own quota, below the 20 MB per-project data limit.
- **Claude's input.** Start narrow if wanted: signed-in visitors only (never anonymous), images only up to about 300 KB, stored per wallet and counted in the wallet's 2 MB, served from the app's own host with `nosniff` and no scripting, and removed with the wallet's data. The owner's own uploads (logos, sounds, fonts, models) already work (D78); this question is only about visitors'.


## Q42. Should the builder look at its own page, and should the strong model write first builds? (raised by the audit, 10 Nov 2026)
- **The builder couldn't see what it built.** Answered by D87 (10 Nov 2026): the review is built and off by default. Still open: whether to turn it on, which the evals decide.
- **D19 (DeepSeek builds, Claude fixes) was chosen on cost before quality was measured.** Design judgement is where the models differ most. Claude's input: three eval runs (today's routing, strong for the first build only, strong for every build) and decide on cost per good build.
- **Both wait on the eval baseline**, which has never been run with real models. Details: [AUDIT_2026-11-10.md](AUDIT_2026-11-10.md) section 3.

## Q43. React Bits' licence on GoodBuild's own landing page (raised by D84)
`src/components/react-bits/BlurText.tsx` is React Bits code (MIT with the Commons Clause) on the landing page of a paid product. The Commons Clause restricts selling a product whose value derives substantially from the software; one hero animation is unlikely to be that, but it is the owner's call. The motion kit's `SplitText` does the same job and could replace it.

## Q44. Games: right first time (raised 11 Nov 2026 after the owner's Neon Drift test build)
A MiniPay car racer with a leaderboard and G$ store took 7 versions. Claude traced most retries to GoodBuild itself: `GameCanvas` never draws while paused, so every start screen is blank; the game guide's leaderboard needs a wallet sign-in that the MiniPay guide forbids; the planner never asks about obstacles, power-ups or NPCs; the run check plays for one second and can't tell a flat canvas from a game. The proposed fix, in phases, with the owner's open choices (plan card count, leaderboard default, G$ inside MiniPay): [GAMES_PLAN.md](GAMES_PLAN.md). Phases A and B (D92) and C and D (D93) are built. The owner chose a wallet-only leaderboard (hybrid for MiniPay). Still open: phases E to G, G$ inside MiniPay (E3), and the v4 wallet failure, which needs the build transcript.
