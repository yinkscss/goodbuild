# Roadmap

Draft. S5 Demo Day dates are UNVERIFIED.

## Stage 1: pre-S5 dApp MVP (now → 9 Nov 2026, continuing into week 1–3)
- Chat → generated Solidity + React app → Sandpack preview → server compile (cancun, paris fallback) → wallet-signed deploy to Celo Sepolia (mainnet behind a flag). Auth via Magic (email wallet) plus external wallets (MetaMask, MiniPay, WalletConnect). AI via the Vercel AI SDK (Anthropic/DeepSeek).
- Milestones M1–M5 done on `main`; M6 credits (G$ vault + ledger, Paystack naira top-ups per TOPUPS.md) in progress. Publish = real server build (esbuild + Tailwind, static hosting).
- Save projects, chat and contract addresses.
- GoodDollar face-verification check; 18+ and US-person attestation, geoblock.

## Season 5, weeks 1–12
| Weeks | Milestones |
|---|---|
| 1–3 | MVP live on Celo Sepolia + mainnet; credits ledger; starter credits for verified users; 5–10 tested starter templates/prompts |
| 4 | Showcase gallery of deployed apps; first campus session; ~100 verified users (Demo Day 1, date UNVERIFIED) |
| 5–8 | Better generation reliability (auto-fix compile errors, tests); G$ payment for generation (live from M6); share/remix projects; ambassador programme across campuses |
| 9–12 | Weekly showcase prizes voted by verified users; MiniPay exploration; on-chain metrics dashboard; 500+ returning users (Demo Days 2–3). Backend/DB support for generated apps (D3) |

## 500-user growth plan
- **Campus ambassadors** (UNILAG first, then other Nigerian schools), paid in G$ per retained verified user; "build your first dApp" sessions.
- **Free starter credits** on face verification (creates verified users).
- **Showcase**: public gallery, weekly G$ prizes, community votes.
- Referral credits once the referee is verified and active on 3 days.

## Metrics that matter for scoring
(Based on S3/S4 criteria; S5 UNVERIFIED.)
- Verified (face-verified) users, and returning weekly users.
- G$ volume and number of G$ transactions per user.
- Contracts deployed and transactions to generated apps.
- Community votes (showcase) and mentor feedback (demo quality).

## Credits system milestones (proposed, D11)
- Stage 1: vault on Celo Sepolia, indexer + ledger, usage billing via the AI SDK wrapper (cost + 25%), Paystack naira top-ups (backend treasury buys G$), preflight/cutoff, GoodID free tier.
- S5 early weeks: mainnet vault (after Slither/review), manual treasury swaps.
- Later: Superfluid streaming, bonuses, optional AntSeed provider. See [CREDITS.md](CREDITS.md).
