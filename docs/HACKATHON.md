# GoodBuild Million Hackathon

Status: page built (D98). Credit claims built (D99): 20 credits on registering, 30 after the first Celo deploy, one grant per GoodDollar root. Expiry of unspent credits and the admin page at `/hackathon/admin` are built too (D100).

## 1. The page (`/hackathon`)
- Code: `src/app/hackathon/page.tsx`, pieces in `src/components/hackathon/`. All copy and numbers live in `content.ts`. Prize split, dates, tracks, team size and partner links there are **DRAFT** until the owner confirms. A test checks the prizes add up to 1,000,000 G$.
- Styles: `hackathon.css`, plain global CSS with every class prefixed `hk-`, mapped in `styles.ts`. CSS modules don't work in this repo because the Turbopack rule in `next.config.ts` renames every `*.css` file.
- Registration uses what already exists: the sign-in modal (with its 18+ and not-a-US-person attestation), then GoodDollar face verification through `useGoodIdVerify` (shared with the workspace's `VerifyCard`). The server re-reads the Identity contract (`/api/account/goodid`). Step 3 claims credits through `POST /api/hackathon` (`src/server/hackathon/claim.ts`).
- Partner links: set `href` on each entry in `PARTNERS` (GoodCash and GoodBuild are linked; Jara is not yet).
- Entries must start on GoodBuild, whose first commit they carry; builders may then continue through GitHub sync (D101). Not checked in code until submissions exist.

## 2. Granting hackathon credits without being gamed (D99)
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

## 3. Prizes in G$
The owner puts 1,000,000 G$ at about ₦150,000 (12 Nov 2026). So the page and all marketing say "1,000,000 G$" and never "$1 million".

## 3a. Owner's numbers so far (12 Nov 2026)
- First said 500 credits per builder against about $30 of AI spend, which covers only about 7 builders. The owner then chose (D99): **50 credits per builder, in two parts**, for **about 100 builders**.
- So the cap is 5,000 credits ($50 billed, about $40 of AI cost), and it's reached only if every builder deploys. Change it with `HACKATHON_BUDGET_CREDITS`.
- **Refills:** hackathon builders top up like anyone else. The grant is one ledger entry on the same balance. If unused grant credits expire (§2.6), only the unspent part of the grant is removed, never credits someone bought.

## 4. How the claim works (D99)
- `hackathon_registrations` (migration 0018), unique per hackathon on the GoodDollar root and on the account.
- `claimHackathon` reads the root from the Identity contract, then takes a hackathon-wide advisory lock. Inside it, it checks the budget and posts `adjust` ledger entries keyed `hackathon:million-2027:start:<root>` and `...:deploy:<root>`.
- **The deploy part** needs a row in `deployments` on Celo or Celo Sepolia, made after registering. Those rows are written only after the server reads the receipt, so a browser can't fake one.
- **Switches:** `HACKATHON_CLAIMS=off` pauses claims. They stop by themselves at `CLAIMS_CLOSE` (8 Feb 2027, DRAFT).
- **Expiry (D100):** after `CLAIMS_CLOSE`, the worker runs a sweep every hour. Admins can also run it from `/hackathon/admin`.
  - AI usage since registering counts against the grant first, so only the unspent part of the 50 is removed (a negative `adjust` keyed `...:expire:<root>`).
  - Bought credits are never removed, and no balance goes below zero.
  - A row whose balance moved during the sweep is left for the next run.
- **Admin page (D100):** `/hackathon/admin`, for wallets in `ADMIN_WALLETS` only (everyone else gets a 404). It shows:
  - totals and budget used
  - registrations per day
  - every builder, flagged when the account was made under 10 minutes before claiming, or the wallet is linked to another GoodDollar identity
  - refused claims, which are logged in `hackathon_refusals`

## 5. Needs the owner
- Split 20 + 30: Claude's choice. Change `START_CREDITS` and `DEPLOY_CREDITS` in `claim.ts`; a test keeps the page's copy in step.
- Prize split, dates, tracks and team size (all DRAFT in `content.ts`).
- Partner links, and whether GoodCash, GoodBuild and Jara have logos to use.
- Who judges, and whether the community vote happens on GoodBuild.
- Whether GoodDollar must approve this use of face verification (also open from M6).
