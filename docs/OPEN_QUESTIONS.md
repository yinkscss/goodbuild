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

## Q17. How does GoodBuild spend users' GoodDollar AI credits?
- Ideas so far: (A) hold user's derived AntSeed buyer key in a server-side AntSeed gateway; (B) wait for GoodDollar's `gd_live_` keys + Worker proxy (not yet implemented). See [GOODDOLLAR_AI_CREDITS.md](GOODDOLLAR_AI_CREDITS.md) §4–6.
- Claude's input: _TBD_
