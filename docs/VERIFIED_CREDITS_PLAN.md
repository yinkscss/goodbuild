# Verified free credits: build plan (D112)

Status: plan, waiting for the owner's go-ahead. Rules: [DECISIONS.md](DECISIONS.md) D112. Flow mock: https://claude.ai/artifact/FfoVGAPT5tPFoAYxHa9vPf

## Steps
1. **Settings and pure rules** (`src/server/credits/free-grants.ts`): welcome amount, refill amount, the per-day, per-week and per-month limits, and a pure `refillStatus(claims, now)` that answers "can claim / claimed today / weekly limit reached / monthly limit reached", with the next reset time. Unit tests for week and month edges (Monday 00:00 UTC, the 1st, a week that spans two months).
2. **Chain reads** (`src/server/goodid.ts`): add `lastAuthenticated` and `authenticationPeriod` to the ABI and add `readGoodIdStatus(wallet)` → `{ root, expiresAt }`. Sign-in calls `syncGoodId`, so already-verified wallets are recognised at once.
3. **Claims** (`claimWelcome`, `claimRefill`): one transaction under an advisory lock on the root. Re-read the chain, check the monthly budget, count claims from the ledger keys, post an `adjust` entry. Tests on PGlite: unverified refused, replay pays once, second account on the same root refused, linked wallet shares the refill count, weekly and monthly limits, expired verification, budget full.
4. **Funding change**: `startTurn` drops the free-usage counters for builds (exempt, then balance). Plan-mode turns from unverified accounts run as `free`, limited per day and counted in the monthly budget. Keep the D48 equivalence test for exempt and paid paths, and replace the free-path cases.
5. **Back-fill script**: give accounts that are already verified the welcome grant minus the free usage they've had. Dry run first, then the owner runs it.
6. **UI** (D12 tokens): the verify card replaces the "trial used" card for unverified Send. Add a daily refill card on the Credits page and in the out-of-credits state, with the 5-slot month meter and "N left this week". Add states for a linked wallet, a face already used, an expired verification and a full budget. Update the free-start copy (D97) and the blog line in BLOG.md.
7. **API**: `POST /api/credits/welcome` and `POST /api/credits/refill` (SIWE session required), and `GET /api/credits/free` for the card's state.
8. **Docs**: HANDOFF.md, DEPLOY.md (new settings), and remove `UNVERIFIED_CAP_MICRO` and `VERIFIED_CAP_MICRO` once nothing reads them.

## Out of scope
On-chain minting, streaks or referral bonuses, and changes to paid top-ups.
