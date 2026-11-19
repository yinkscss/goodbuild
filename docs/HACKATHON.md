# GoodBuild Hackathon

Status: **Dates, prizes and credits changed by D130 (18 Nov 2026): 18 Nov to 10 Dec, 1,000,000 G$ capped (700k top-20 rank prizes + 300k shared by approvals at up to 5,000 G$ each), credits stay usable. Section 7 below describes the older top-10 design.** email onboarding, required in-app FlowState support, public submissions, verified approvals, leaderboard and admin CSV built (18 Nov 2026). The top 10 published projects receive 100,000 G$ base each from a 1,000,000 G$ reserve; every verified approval adds 50,000 G$ outside that reserve. Earnings are estimates until settlement. Page built (D98). Credit claims built (D99): 20 credits on registering, 30 after the first Celo deploy, one grant per GoodDollar root. Expiry of unspent credits and the admin page at `/hackathon/admin` are built too (D100).

## 1. The page (`/hackathon`)
- Code: `src/app/hackathon/page.tsx`, pieces in `src/components/hackathon/`. All copy and numbers live in `content.ts`. Prize split, dates, tracks, team size and partner links there are **DRAFT** until the owner confirms. The confirmed total pool is 1,000,000 G$. Podium prizes have been replaced with a top-10 shared reserve and separately funded approval top-ups.
- Styles: `hackathon.css`, plain global CSS with every class prefixed `hk-`, mapped in `styles.ts`. CSS modules don't work in this repo because the Turbopack rule in `next.config.ts` renames every `*.css` file.
- Registration uses what already exists: the sign-in modal (with its 18+ and not-a-US-person attestation), then GoodDollar face verification through `useGoodIdVerify` (shared with the workspace's `VerifyCard`). The server re-reads the Identity contract (`/api/account/goodid`). Step 3 requires confirmed support for GoodBuildIt through the in-page FlowState popup. Step 4 explicitly claims credits through `POST /api/hackathon` (`src/server/hackathon/claim.ts`).
- Partner links: set `href` on each entry in `PARTNERS` (GoodCash and GoodBuild are linked; Jara is not yet).
- Entries must start on GoodBuild, whose first commit they carry; builders may then continue through GitHub sync (D101). Submissions currently collect an editable live/source link; GoodBuild provenance and Celo deployment are not automatically validated for reward eligibility.

## 2. Granting hackathon credits without being gamed (D99)
What stops abuse is that **every grant is keyed to a GoodDollar identity root, not a wallet or an account**, and the chain decides what that root is.

1. **Claim, don't auto-grant.** A `POST /api/hackathon` route. Signed-in session required. It is region-gated like the rest of the API (D10), and the attestation was already taken at sign-in.
2. **Re-read the chain at claim time.** Call `readGoodIdRoot` fresh. Don't trust the stored `verifiedAt` (it never expires) or GoodDollar's redirect. No root means no credits. If GoodDollar's verification has expired, the person re-verifies first.
3. **One grant per human.** Post one ledger entry with `idempotencyKey = hackathon-2027:<root>`. The ledger already refuses a reused key: a replay changes nothing, and a second account linked to the same root gets `IdempotencyConflictError`. Add a `hackathon_registrations` table with a unique index on `goodid_root` as a second lock, and to list who registered.
4. **Credits only buy AI on GoodBuild.** They can't be withdrawn, sent or swapped (true of the ledger today). That leaves farming accounts worth little.
5. **Give it in two parts.** A first tranche at registration, the rest after the first real build or first Celo deploy from that account. Someone who verifies only to collect gets the small part.
6. **Credits stay usable (D130).** Unused hackathon credits are not expired. The old expiry sweep is off.
7. **Budget kill switch.** A total cap for the whole hackathon (`HACKATHON_BUDGET_CREDITS`). Claims stop with a clear message once it's spent, in the same way as D29.
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
- **Switches:** `HACKATHON_CLAIMS=off` pauses claims. They stop by themselves at `CLAIMS_CLOSE` (10 Dec 2026, D130).
- **Expiry (D100, switched off by D130):** the worker no longer sweeps. `expireUnusedCredits` and the admin button remain as a manual tool only.
  - AI usage since registering counts against the grant first, so only the unspent part of the 50 is removed (a negative `adjust` keyed `...:expire:<root>`).
  - Bought credits are never removed, and no balance goes below zero.
  - A row whose balance moved during the sweep is left for the next run.
- **Admin page (D100):** `/hackathon/admin`, for wallets in `ADMIN_WALLETS` only (everyone else gets a 404). It shows:
  - totals and budget used
  - registrations per day
  - every builder, flagged when the account was made under 10 minutes before claiming, or the wallet is linked to another GoodDollar identity
  - refused claims, which are logged in `hackathon_refusals`

## 5. Community flow and exports (18 Nov 2026)
- Run migration `0022_hackathon_community` (`pnpm db:migrate`) before deploying. Embedded development databases migrate automatically.
- Email login reads Magic metadata on the server only after validating the DID token bound to the wallet sign-in. `users.email` is returned only in that account's session response. External wallets can supply a contact email; the CSV distinguishes contact-only addresses from email logins.
- `hackathon_participants` records signup and FlowState progress before verification. Legacy `visited` / `skipped` states are not proof. Initial free credits require `voted` plus a fresh, settled on-chain support check.
- `/hackathon/submit`: any signed-in person with a saved email can post one idea and later edit it. Alias, title and a 160-character pitch are required; HTTPS live/source links are optional. The actor's account determines ownership; no browser-supplied payout wallet is accepted.
- `/hackathon/projects`: public showcase ordered by approval count, then submission time. Email and internal user/identity data are excluded. Approvals open after a live link is added.
- `POST /api/hackathon/projects` re-reads the voter and owner's GoodDollar identities. A database unique index allows one approval per identity per project, even across linked wallets or retries. Self-approvals are rejected. Approvals close at `CLAIMS_CLOSE`. They are free; they do not debit build credits or pay out G$.
- `/hackathon/admin` links to `GET /api/hackathon/export`. The CSV requires a wallet listed in `ADMIN_WALLETS`, includes every signup (including unverified people and people who never claim), progress, project links, approval counts and credit grants. It is not limited by the claim report's 500-row preview. Fields are quoted and spreadsheet formulas neutralized.
- `pnpm test -- src/server/hackathon src/components/hackathon src/app/api/hackathon/export/route.test.ts src/server/auth` covers signup, ownership, duplicate roots, fresh owner verification, required vote/explicit claim, private export access and email persistence. Browser verification uses controlled identity/chain responses; real Magic OTP and GoodDollar face checks require configured services and a human.

## 6. Needs the owner
- Split 20 + 30: Claude's choice. Change `START_CREDITS` and `DEPLOY_CREDITS` in `claim.ts`; a test keeps the page's copy in step.
- Dates, tracks and team size (DRAFT in `content.ts`).
- Partner links, and whether GoodCash, GoodBuild and Jara have logos to use.
- Final eligibility and payout schedule. Approvals and estimated earnings are implemented on GoodBuild; automated prize payments are not.
- Whether GoodDollar must approve this use of face verification (also open from M6).

## 7. Reward policy (owner update, 18 Nov 2026)

`src/lib/hackathon-rewards.ts` defines a 1,000,000 G$ shared reserve, ten fixed base slots of 100,000 G$ each, and 50,000 G$ per verified approval funded outside that reserve. Top-ups apply to every published entry, including those beyond the top 10. They are not capped by, deducted from, or funded by the reserve. Fewer than ten eligible projects leave unused base slots rather than redistributing them. Published projects rank by approval count, then original submission time/id; ideas do not occupy reward slots. The public cards and private CSV show the same estimated base, top-up and total amounts. The estimates are not wallet balances, ledger build credits or confirmed payments.

## 8. In-app FlowState support (18 Nov 2026)

The required FlowState step supports direct voting with the existing Magic email wallet. See [FLOWSTATE.md](./FLOWSTATE.md) for verified protocol targets, review/signature/confirmation rules, gas requirements and remaining live checks. Migration `0023_flowstate_vote_proof` adds durable claim throttling and confirmation evidence. CSV export now distinguishes an external link visit from a server-confirmed vote, and includes its transaction hash/confirmation time. Existing supporters can confirm their actual ballot without spending another network fee.

## 9. Live ladder (18 Nov 2026, D130)
`src/components/hackathon/ladder.tsx` is the one leaderboard, used on `/hackathon` (`mode="web"`) and in the app at `/home/hackathon` (`mode="app"`). It reads the public `/api/hackathon/projects` list every minute and ranks it with `src/lib/hackathon-ladder.ts`, which wraps `allocateHackathonRewards`, so ranks and estimates match the project cards and the CSV. Top 20 are the prize zone; leagues are Bronze 5+, Silver 15+, Gold 30+ approvals (badge only, `LEAGUE_AT`, D133). In the app it highlights the builder's own project and says how many approvals reach the prize zone, ties included. **Not built:** rank movement arrows (needs a daily rank snapshot), quests, voter badges, weekly Rising Star, referral.

## 10. Four app pages and three approvals (19 Nov 2026, D132)
`/home/hackathon` has Get started, My project, Leaderboard and Vote as separate pages (`src/app/home/hackathon/*`, tabs in `home-tabs.tsx`). Registered people see a summary instead of the steps (`get-started.tsx`). Voting is limited to **3 approvals per verified person** and needs a confirmed FlowState vote; the server enforces both (`approveEntry` in `src/server/hackathon/community.ts`, status at `GET /api/hackathon/votes`). The public page has a Vote section and the same list powers `/hackathon/projects` (`vote-list.tsx`).

## 11. Quests and badges (19 Nov 2026, D133)
`src/lib/hackathon-quests.ts` turns what the app already knows into six quests and seven badges; `quests.tsx` shows them on Get started for registered builders. Credits come only from the existing 20 + 30 claims; badges never carry G$. Weekly Rising Star, referral and rank-movement arrows are still not built.

