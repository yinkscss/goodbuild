# GoodBuild Million Hackathon

Status: page built (D98), credit grant **not built**. The plan below needs the owner's answers in §4 before code.

## 1. The page (`/hackathon`)
- Code: `src/app/hackathon/page.tsx`, pieces in `src/components/hackathon/`. All copy and numbers live in `content.ts`. Prize split, dates, tracks, team size and partner links there are **DRAFT** until the owner confirms. A test checks the prizes add up to 1,000,000 G$.
- Styles: `hackathon.css`, plain global CSS with every class prefixed `hk-`, mapped in `styles.ts`. CSS modules don't work in this repo because the Turbopack rule in `next.config.ts` renames every `*.css` file.
- Registration uses what already exists: the sign-in modal (with its 18+ and not-a-US-person attestation), then GoodDollar face verification through `useGoodIdVerify` (shared with the workspace's `VerifyCard`). The server re-reads the Identity contract (`/api/account/goodid`). Step 3 only says "You're in". No hackathon credits are granted yet.
- Partner links: set `href` on each entry in `PARTNERS`.

## 2. Granting hackathon credits without being gamed (proposal, Claude)
What stops abuse is that **every grant is keyed to a GoodDollar identity root, not a wallet or an account**, and the chain decides what that root is.

1. **Claim, don't auto-grant.** A `POST /api/hackathon/claim` route. Signed-in session required. It is region-gated like the rest of the API (D10), and the attestation was already taken at sign-in.
2. **Re-read the chain at claim time.** Call `readGoodIdRoot` fresh. Don't trust the stored `verifiedAt` (it never expires) or GoodDollar's redirect. No root means no credits. If GoodDollar's verification has expired, the person re-verifies first.
3. **One grant per human.** Post one ledger entry with `idempotencyKey = hackathon-2027:<root>`. The ledger already refuses a reused key: a replay changes nothing, and a second account linked to the same root gets `IdempotencyConflictError`. Add a `hackathon_registrations` table with a unique index on `goodid_root` as a second lock, and to list who registered.
4. **Credits only buy AI on GoodBuild.** They can't be withdrawn, sent or swapped (true of the ledger today). That leaves farming accounts worth little.
5. **Give it in two parts.** A first tranche at registration, the rest after the first real build or first Celo deploy from that account. Someone who verifies only to collect gets the small part.
6. **Expire them.** Unused hackathon credits lapse when submissions close (a dated `adjust` entry), so they aren't a standing liability.
7. **Budget kill switch.** A total cap for the whole hackathon (`HACKATHON_BUDGET_MICRO`). Claims stop with a clear message once it's spent, in the same way as D29.
8. **Watch it.** An admin view of claims per day, with duplicate-root attempts and claims from wallets created minutes earlier. Blocking stays manual.

**What this does not stop (honest limits):**
- Someone who passes GoodDollar's face check on several identities. That's GoodDollar's dedup to catch, not ours.
- People renting or buying verified wallets. Steps 4 to 6 make that unprofitable rather than impossible.

The same root-keyed rule should drive the community vote (one vote per root) and prize payouts (to the root's verified wallet).

## 3. Prizes in G$ (UNVERIFIED)
The dollar value of 1,000,000 G$ depends on G$'s market price, which hasn't been checked here. Before launch, confirm what the pool is worth and whether "$1 million" anywhere in marketing means 1,000,000 G$ (the page says G$).

## 4. Needs the owner
- Credits per verified builder, and the split between the two parts (§2.5).
- The total hackathon credit budget (§2.7).
- Prize split, dates, tracks and team size (all DRAFT in `content.ts`).
- Partner links, and whether GoodCash, GoodBuild and Jara have logos to use.
- Who judges, and whether the community vote happens on GoodBuild.
- Whether GoodDollar must approve this use of face verification (also open from M6).
