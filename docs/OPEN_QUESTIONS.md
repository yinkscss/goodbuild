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
- Ideas so far: static hosting at `<slug>.goodbuild.app` (provider TBD), or IPFS. Moderation of published apps?
- Claude's input: _TBD_

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

## Q24. Landing metric card shows sample numbers
- "2.48M G$ deployed this week" and "14,902 contracts compiled" are mockup values. Shown as "Live" at launch they would be false, and DESIGN_SYSTEM §7 asks for real numbers.
- Claude's input: M1 feeds the card from `src/config/landing-stats.ts` with `isLive: false`, which shows a "Preview" chip. Proposal: wire it to the deployments table (M5) and switch to "Live" then. Also reconsider the metric: "G$ deployed" is unclear; "G$ moved through GoodBuild apps" or "dApps deployed" is easier to defend.

## Q25. "Pre-audited" template copy
- The mockup says templates are "pre-audited". GoodBuild templates are not audited; their OpenZeppelin bases are.
- Claude's input: M1 copy says "built on audited OpenZeppelin contracts" and the eyebrow reads "Audited building blocks". Revert only once templates have their own audit.

## Q26. Credit price vs real build cost
- Mockup b shows "≈ 4 G$ per build" and "120 G$ ≈ $0.02". At ~$0.000112/G$ (RESEARCH.md), 4 G$ is about $0.0005. A strong-model build is plausibly $0.05–$1 (UNVERIFIED until the AI_AGENT §8 benchmark runs), i.e. roughly 450–9,000 G$. The daily UBI claim (~126 G$) would not fund one build.
- The UI also shows balances in G$ while CREDITS.md stores USD micro-units and says to show dollars (Q18).
- Claude's input: decide before M3/M6. Proposal: show USD as the primary unit ("$0.42 of build credit") with G$ as the deposit currency; show the per-build estimate from real metered cost; lean on the GoodID free tier for first builds.

## Q27. Mainnet unlock rule
- Mockup b: "Mainnet unlocks after your first verified contract". CONTRACTS_AND_DEPLOYMENT §1: mainnet deploys gated on GoodDollar face verification.
- Claude's input: pick one before M3. Proposal: face verification (it also produces the verified users S5 scores on).

## Q28. Status-dot green
- Mockups b and c use `#35D07F` for status dots; the token is `success #1F9D6B`.
- Claude's input: use the token everywhere (M3 onward).

## Q29. Hero "building" image
- DESIGN_SYSTEM §8.1 asks for a chrome hand placing violet blocks, or blocks snapping into a contract shape. No such asset exists.
- Claude's input: M1 ships a code-drawn isometric version (chrome and violet blocks, the last one dropping in and snapping into place; no pink, reduced-motion safe). If you want a rendered 3D image like `hero-b.jpg`, it can be generated (e.g. via Figma's image generator, which spends Figma AI credits) and swapped in without layout changes.
