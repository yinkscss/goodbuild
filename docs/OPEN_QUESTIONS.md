# Open questions

**These are NOT final.** Claude is invited to propose answers, challenge or change Ego's recommended decisions (D5–D10 in [DECISIONS.md](DECISIONS.md)) with reasons. User decisions (D1–D4) stay fixed unless the user changes them. Resolved answers move to DECISIONS.md.

## Q1. Contract templates vs free-form generation?
- Ideas so far: start from vetted templates (token, NFT, escrow, voting, ajo/ROSCA) that the AI customises; allow free-form later. Templates cut bug risk.
- Claude's input: _TBD_

## Q2. Which chains and testnets?
- Ideas so far: Celo mainnet + Alfajores only for Stage 1 (G$ lives on Celo). Others later, if ever.
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
