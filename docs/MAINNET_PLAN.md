# Launch plan: M6 paid credits and Celo mainnet

Written 6 Nov 2026 against `main` at `c6d9bbdfe`. Planning only: no product code, keys, payments or transactions were touched. Decision record: D36 in [DECISIONS.md](DECISIONS.md).

**The owner's choice:** one launch, both together. Claude recommended M6 first and the owner chose together, so this plans for together, and section 2 names where steps inside the launch are safer.

**Honest timing:** this is about 8 build sessions plus a lawyer and Paystack's answer. It won't fit the 9 Nov date in ROADMAP.md. Whether that date is a hard one is UNVERIFIED (S5 dates are unverified there too).

## 1. What blocks the launch, in order

1. **No legal or Paystack clearance.** No lawyer has read the legal pages, and Paystack's Nigeria list names crypto categories while our treasury design converts naira to crypto (section 8). This can stop the whole launch, so start it now, alongside the build.
2. **There's no ledger.** Nobody can hold a balance today (section 3).
3. **Paying customers would be refused by free-trial rules** (section 5).
4. **Generated apps can't use mainnet.** Every app is hard-coded to Celo Sepolia, so a mainnet contract would look "not deployed" in its own app (`src/server/agent/template.ts:131`).
5. **The mainnet switch doesn't work as documented, and can't be turned off quickly.** `deploy/docker-compose.yml` doesn't pass `NEXT_PUBLIC_ENABLE_MAINNET` to the build, and it is a build-time value (section 6).
6. **Nothing enforces fund safety.** The withdraw rule is one line in the AI's prompt, and visitors' funds in a replaced contract have no way out (section 6).
7. **Operations aren't ready for money.** Backups sit on the same server, a restore has never been tested, no tests run before a deploy, there's no rollback and there are no alerts (section 7).
8. **The AI provider balance could run out while customers hold credit.** D29 recorded $5 of AI credit. Nothing compares what we owe with what's in that account.

## 2. How "together" works: one launch, three steps

| Step | State | Why |
|---|---|---|
| A. Dark | All code merged. Test keys only, top-ups and mainnet set to off | Every merge deploys to production, so unfinished work must be harmless. |
| B. Owner only, live money | Live keys in, top-ups set to admins only, low limits, for 1 to 2 days | The first real payment, webhook, credit and spend, with nobody else's money at risk. |
| C. Owner only, mainnet, then everyone | Mainnet set to admins only, the owner's small deploy, then both set to everyone on the same day | People see one launch. |

If B or C goes wrong, the public launch waits and nobody else is affected. This is the only staging recommended, and it costs days, not weeks. Both switches have three settings (off, admins, everyone), kept in the database so they change without a rebuild.

## 3. What exists versus what's missing (checked in code)

| Area | Today | Missing |
|---|---|---|
| Ledger | `src/server/credits.ts` returns nulls. No `ledger_entries` or `balances` table in any schema. | All of it |
| Usage | `usage_events` is recorded with cost and charge, idempotent on `call_id` (`store.ts`). Five call sites. | A link to a funding source, and any debit |
| Free limits | `cap.ts`: $0.20 (D28), $0.70 verified (D30), $4 total (D29) | Any idea of paid money |
| Reservation | Only a $0.35 hold per build for the free total | Per-user reservations and a stop. `runner.ts` has no per-build spending limit, only round and fix-attempt limits. |
| Paystack | No code at all, and no webhook route | All of it |
| Top-up UI and admin | `credits-pill.tsx` shows "Testnet beta · $0.20 free". No `/admin`. | All of it |
| Face verification | Built (D30, `goodid.ts`). A real face check end to end is UNVERIFIED. | A live test |
| Mainnet deploy | `assertChain` gate, real G$ address, explorer links, Sourcify, D33 refusal | See section 6 |
| Sign-up attestation | 18+ and not-US enforced at sign-in (`auth/service.ts`), region block in `proxy.ts` | Nothing for top-ups beyond what's in section 4 |
| Email-wallet key export | A menu item exists (`wallet-button.tsx:187`). Not tested live. | A live test, because it matters once wallets hold real money |

**Where docs and code disagree:**
- HANDOFF.md lists face verification as M6 step 1, but it's built. Its "waiting on the owner" list is partly overtaken by D29 and D30. It also says the pill reads "Testnet beta · free", and it describes M5 as unmerged.
- DEPLOY.md says "CI must pass" before merging. The only workflow is `deploy.yml`, which runs no tests.
- DEPLOY.md says to move the database off the box. D27 only says "revisit". Section 7 challenges the move.
- **`scripts/set-secret.mjs` only writes `.env.local` in the current folder.** It rejects `NEXT_PUBLIC_` names and only checks the format of Magic keys. No server version exists in git. `deploy.sh` deletes everything in `/opt/goodbuild/deploy` except `.env.production`, so a script kept there would not survive a deploy. A separate server script is UNVERIFIED (not checked, as agreed: no SSH).
- DESIGN_SYSTEM.md's pill is G$ first (`120 G$`). D13 says USD is primary and D24 keeps G$ beside it. With no G$ deposits (decision 1) there's no rate to show G$ at.
- CREDITS.md's G$ vault and indexer don't exist, and ROADMAP.md still lists them for M6. The brief for this launch doesn't include them (decision 1).
- D29 calls $0.35 "about the dearest" build. D19 records a $0.50 build (RTX eval), so $0.35 is too low as a paid hold.
- D33 says "UNVERIFIED on Celo Sepolia", but it was tested live on 6 Nov (HANDOFF.md).
- CONTRACTS_AND_DEPLOYMENT.md §4 proposes AI-written contracts on testnet only, which conflicts with this launch (decision 7).
- `docs/DECISIONS.md` has two D25 entries and CLAUDE.md item 3 is out of date (D20, D31). Neither blocks anything.

## 4. Build order

One build session at a time. Efforts are rough guesses in tokens, against about 400k for a past session. **Total about 3.1M, or about 8 sessions.** Every PR must be safe to deploy alone, with new features off and migrations that only add. Each adds tests, and `pnpm check` must pass.

**Before starting:** PR 30 uses D35 and migration `0009`, so if it merges first the ledger migration is `0010`. `feat/app-wallet-connect` is one WIP commit in a local worktree, not on the remote. It rewrites `template.ts`, so settle it before C2 (decision 15).

| # | PR | Contents | Effort |
|---|---|---|---|
| O1 | Tests before deploy, and rollback | A workflow that runs the checks on every PR. Tag each image so the last good one can be restarted. See section 7. | 120k |
| O2 | Off-site backups and restore drill | Section 7. Needs decision 12. | 100k |
| M1 | Ledger | `ledger_entries` (append-only, unique idempotency key), `balances`, and a `funding` column on `usage_events` and `turn_jobs`. Existing rows become `free`. No cascade delete on money records. `getCredits` reads real data. No behaviour change. | 150k |
| M2 | Separate free and paid | Rewrite `cap.ts` as in section 5. Free users see no change. | 200k |
| M3 | Reservation and debit | Hold before a build, debit in `recordUsage`, stop when the hold runs out, release on every ending, and clear stale holds. | 300k |
| M4 | Crediting core | `topups` and `fx_rates` tables and one crediting function. Replay, double delivery, wrong amount and race tests. No network. | 200k |
| M5 | Paystack test flow | `POST /api/topups`, Initialize, signed webhook on the raw body, Verify, live keys refused unless `PAYSTACK_ALLOW_LIVE=true`. | 200k |
| M6 | Webhook region exemption | One exact path, POST only, in `proxy.ts`. The signature is the protection. Everything else stays blocked. Test: nothing else gets through. | 40k |
| M7 | Reconciliation | A timer in the worker: check unsettled top-ups with Verify, compare totals, handle disputes with a negative ledger entry, flag mismatches. | 150k |
| M8 | Top-up UI and pill | Modal, USD pill, low-credit card, new refusal messages. Per DESIGN_SYSTEM (update its pill spec first, decision 1). No G$ or treasury words in the top-up flow (D21). | 250k |
| M9 | Admin and switches | `/admin/treasury` behind `ADMIN_WALLETS`, top-up and mainnet switches, liabilities versus provider balance, `pnpm treasury:report`. | 200k |
| C1 | Mainnet switch | Add the build arg to compose. Add a server check of the database switch. The wallet pill follows the project's chain, not the flag. Fix "Mainnet unlocks later" copy. | 120k |
| C2 | Apps follow their chain | The chain comes from the project, including older projects' locked helpers (as D34 did), the prompt and the guides. Test: a mainnet project's app finds its address. | 300k |
| C3 | Fund-safety checks | Withdraw rule and value cap, enforced at prepare (section 6). | 300k |
| C4 | Real-money deploy flow | Typed confirmation, warning, who may deploy, CELO-needed guide, old-funds and replace fixes. | 200k |
| C5 | RPC and verification | A second RPC with fallback, repeat the PR 29 read tests, explorer check. | 150k |
| O3 | Monitoring and secrets | Health endpoint, alerts, a server secret script that writes `.env.production`. | 120k |
| L1 | Legal pages | Terms, Privacy and refund wording from the lawyer. Set `NEXT_PUBLIC_CONTACT_EMAIL`. Small, but it waits on the lawyer. | 60k |

**O1 goes first** because the money PRs are all releases when merged. Merging this document also triggers a production rebuild, since the workflow doesn't filter by file.

### Money path rules (M4 to M7)
- **Only the webhook and reconciliation credit.** The browser never does. Each uses the same function, keyed `topup:<reference>`, in one transaction.
- **Fee on top (D36).** The server works out the total and sends Paystack that exact amount, so the check in TOPUPS.md §3 stays simple: verified amount equals our stored total. Credit is the base. Example at the published local rate: ₦5,000 base is ₦5,177.66 charged, because Paystack's fee on that total is ₦177.66.
- **Keep Paystack's dashboard "customer pays" option off,** because it would change the amount they report (UNVERIFIED, test this in test mode). Also test the edges: the ₦100 waiver below ₦2,500, the ₦2,000 cap and foreign cards (decision 3).
- **Store** the rate, source, spread and Paystack's reported fee on every row. If the fee differs from what we expected, the platform absorbs it and logs it.
- **The top-up switch stops new payments only.** Money already taken must still be credited, whatever the switch says.
- **Red-team tests:** forged signature, replayed event, a real signature with another reference, a tampered amount, two deliveries at once, webhook before our row commits, a chargeback after the credit is spent.

### Paystack facts used
| Fact | Source |
|---|---|
| `x-paystack-signature`, HMAC SHA512 of the payload with the secret key. Must return 200. Source IPs 52.31.139.75, 52.49.173.169, 52.214.14.220, the same for test and live. | Paystack docs-v2 webhooks page, read directly |
| Live retries: every 3 minutes for 4 tries, then hourly for 72 hours. Test retries: **the docs disagree** (72 hours on docs-v2, 10 hours on the current page). | docs-v2 read directly. Current page by search summary only. |
| Local fee 1.5% + ₦100, ₦100 waived under ₦2,500, capped at ₦2,000. International 3.9% + ₦100 (one article says flat 3.9%). Fee-passing exists in the dashboard for Nigerian businesses. | Search summaries of paystack.com/pricing and support articles. **Direct reads were blocked**, so check the dashboard. |
| Verify response has `amount`, `currency`, `status`, `reference`, `fees`. Amounts in kobo. | Partly from sample payloads. **UNVERIFIED** until a test-mode run. |

Paystack's IPs can't simply be allowlisted at the server, since traffic arrives through Cloudflare. Don't rely on them. Whether Cloudflare will challenge Paystack's requests is UNVERIFIED and M5's first live test-mode delivery checks it.

## 5. The free-trial trap, and how paid usage works

`checkAiAllowance` is worse than one wrong message. For any non-exempt account:
- `spentMicro` and `identitySpentMicro` add up **all** usage. After $0.20 of any spending, a paying user is told "Verify with GoodDollar". A verified one is told "Top-ups are coming soon".
- `budgetHasRoom` adds up **all** provider cost and counts **all** queued and running builds. Paid builds would fill the $4 and shut free AI for everyone, and paying users would see "The free trial is full".
- `hasPlanHeadroom` and `shouldOfferVerification` have the same problem.

**The fix (M2 and M3):**
1. **Every usage row and build job records who funds it:** `free`, `paid` or `exempt`. A job has one funding source from start to finish.
2. **The free counters and the $4 budget only add up non-paid rows and jobs.** Exempt spending still counts, as D29 says. Paid usage never touches them. Past rows count as free, so nothing about today's total changes.
3. **The order at build start:**
   - exempt wallets go ahead;
   - if free room is left and the budget has room, it's a free build (decision 4);
   - otherwise, if balance minus holds covers the minimum hold, it's a paid build;
   - otherwise, refuse.
4. **Refusal messages:** anyone who has ever paid sees "You're out of credits. Top up to keep building." `BUDGET_MESSAGE` becomes "Free AI is full right now. Top up to keep building." when top-ups are on. A test proves a user with balance can't get any free-limit message.
5. **The hold.** Start at $1 charged (about twice the dearest seen, to be checked against real data). Before each model call, if what's been used plus a worst-case call would pass the hold, extend it from the balance, or stop cleanly using the worker's existing abort. A stopped build keeps what's saved and says why.
6. **One debit point.** `recordUsage` debits in the same transaction, and only if the row was actually inserted, because today it returns a cost even on a duplicate. Non-build calls (uploads, visual check, project name) debit directly and may go slightly negative. Small negatives are written off, per CREDITS.md §4.
7. **Crash-lost calls** (P18) cost us money and bill nothing. A monthly comparison of provider invoices against recorded cost, by hand at first, shows how much.

Free builds stay as D28 says: they may finish over the cap. `one_build_at_a_time` stays for everyone at launch to keep things simple.

## 6. Mainnet safety gates

Each must pass before step C. "Check" means something that can fail, not a promise.

| Gate | Today | Check |
|---|---|---|
| **Withdraw rule** | One prompt line (`prompt.ts:69`). A name match on the ABI for the old-funds card. | At prepare on mainnet, a contract that can receive G$ (has `onTokenTransfer`, or calls `transferFrom` to itself) is refused without a matching exit function **and** a passing contract test in which a non-owner deposits and withdraws. Limit: this proves one path works, not that the contract is safe. Native CELO needs the same rule. |
| **Typed confirmation and warning** | An "Unaudited" chip only | Mainnet deploy requires typing the contract name, beside "Unaudited, may lose funds". The server refuses prepare without the confirmation, not just the button. Test covers both. |
| **Value caps** | None | A required limit on what a contract can hold, in a constant, with a contract test that a deposit over it reverts (amount: decision 8). Limit: it's a check on generated code. A wallet owner can deploy elsewhere. |
| **D33 proxy trial** | Refused at toggle, prepare and record. **Tests exist** in `upgradeable.evm.test.ts:758-770`. | Those tests stay in CI. There's **no upgrade delay** (a D33 follow-up), which doesn't matter while proxies are refused. Allowing proxies on mainnet later needs a delay first, and a new decision. |
| **Real G$ address** | `0x62B8…9c7A` in code | **Verified 6 Nov:** matches GoodProtocol's production-celo deployment, and on-chain reads give "GoodDollar", "G$", 18 decimals. It is a proxy with `transferAndCall`. Check: a test that pins the address, and a read at deploy time. |
| **G$ differs from test G$** | Test token has no fees or pause | The real token has `getFees` (0 for 1,000 G$ today, read 6 Nov) and `pause`. Whether fees can change is UNVERIFIED. Check: at prepare, refuse if the fee isn't 0. Add a guide rule to count what's received, not what's sent. |
| **Source verification** | Sourcify only, tested on Sepolia. Links go to Celoscan. | Sourcify lists chain 42220 (checked 6 Nov), but a mainnet match is UNVERIFIED and so is Celoscan showing it (the comment in `verify.ts` assumes so). Check: owner's first deploy shows verified on Celoscan, or else link to a viewer that does. |
| **Old-funds card** | Failed reads count as 0 (`old-contracts.ts`). Only G$ is read. Says "Nothing is lost". The match includes `rescue` and `sweep`. | On mainnet: a failed read shows "couldn't check" rather than hiding funds. Check for CELO too. Soften the copy. Don't offer `rescue` or `sweep` as "move funds out", since an owner could take other people's money. Each has a test. |
| **Replace warning** | Warns, and lists the old balance | **The card only moves the owner's own share. Visitors' funds stay in the old contract, and a republished app points at the new one.** On mainnet, replacing a contract that holds funds, or whose balance couldn't be read, needs a second typed confirmation. A way for visitors to reach old contracts is a follow-up (decision 9). |
| **RPC reliability** | Single forno URL for each chain, no fallback. PR 29's fix was tested in a local EVM and with fakes. | Set `CELO_RPC_URL` with a fallback. Repeat a deploy from a real browser with MetaMask, which HANDOFF still lists as open. forno accepted a state override on mainnet (6 Nov). Changing RPC hosts means updating Magic's allowed list (DEPLOY.md). |
| **Free and verification rules** | No difference by chain | Recommended: D28 to D30 are unchanged, because they limit AI money and gas is the user's. New rule: mainnet deploys need a verified or paying account (decision 5), checked at prepare. |
| **Testnet leftovers** | Prompt says "Celo Sepolia for now", and home says "Mainnet unlocks later" | C1 and C2 fix them. Check with a search for these strings. |
| **Switch behaviour** | `assertChain` guards both prepare and record | The kill switch stops prepare only. A transaction already signed must still be recorded, and withdrawals must still work. Test both. Today's flag would refuse the record too. |

**Flag detail:** the Dockerfile declares the arg, but compose doesn't pass it. `.env.production` reaches the running containers, so the worker would see it while the web build wouldn't. How Next treats it in server code after a build is UNVERIFIED, and C1 tests that.

**Not gated:** no external audit or Slither run for generated contracts (Q13). Every contract stays labelled unaudited.

## 7. Operations before real money

| Need | Today | Plan | Check |
|---|---|---|---|
| Backups | Nightly, 7 days, same server | O2: encrypted copies off the server, at least hourly, so a lost server loses under an hour of ledger | A new copy appears, and an alert fires if none does for 2 hours |
| Restore | Command documented, never run as far as the docs show | Restore into an empty database elsewhere, and compare ledger totals | Owner or Claude runs it and records the date and time taken. **A gate for step B.** |
| Moving the database | DEPLOY.md says to | **Challenge:** a managed database adds cost and a network hop, and doesn't fix the single web server. Off-site backups plus reconciliation against Paystack cover the money risk first. Decision 12. | |
| One server, no failover | Accepted by D27 for free use | Accept for launch with a written plan: new server, restore, reconcile. Paystack keeps retrying for 72 hours, and reconciliation covers the rest. During an outage nobody can build. | Time the restore plan once |
| Hosting terms | Written permission covers "blockchain and testnet work" | Owner asks iHostio whether it covers mainnet and taking payments | Written answer |
| Secrets | `.env.production`, mode 600 | O3 adds a server script that writes there and refuses to echo. Live keys only entered by the owner, never in chat, git or logs. | Search logs for key prefixes after step B |
| Tests before deploy | None | O1, plus a branch rule the owner turns on | A failing PR can't merge |
| Rollback | None. `goodbuild:latest` is overwritten and built on the live box. | O1 tags images. Rollback restarts the last tag. Migrations only add during the launch, so old code still runs. | Do one rollback before step B |
| Monitoring | Only a post-deploy check that `/` returns 200 | O3: outside uptime check, `/api/health` with a database check. Alerts by email for webhook failures, flagged top-ups, reconciliation lag, RPC errors, old backups, disk. | Trigger each alert once |
| Provider balance | Nothing | Admin records provider top-ups. Alert when balance falls below what customers hold plus the free budget, and **top-ups pause by themselves**. An API to read balances is UNVERIFIED for both providers. | A test for the pause, and a test alert |
| Kill switches | None at runtime | Section 2's switches. Paystack dashboard can also disable a key. | Owner flips each one in step B and sees the effect in under a minute |
| Merge freeze | Every merge restarts production | No merges during steps B and C, except fixes | Agreed by the owner |
| Main site headers | No security policy header found in `next.config.ts` or `proxy.ts`. Cloudflare's settings aren't checked. | Review before the payment UI ships (M8) | Header present, and checkout still works |

## 8. Legal and compliance

No legal conclusions here. All of this goes to the lawyer or the named party. **Live keys wait for the first four.**

| Question | What we know | Who |
|---|---|---|
| Terms, Privacy and refund wording | Unreviewed drafts. Terms and Privacy don't mention credits, payments or Paystack. Refund policy in D36 needs lawyer's wording. | Lawyer |
| Do prepaid credits count as stored value? | CREDITS.md flags it as UNVERIFIED. Credits are designed to be non-transferable and non-withdrawable. | Lawyer |
| Does naira to USDT to G$ treasury work trigger virtual-asset rules? | TOPUPS.md §9 flags it as UNVERIFIED. Decision 2 avoids it at launch. | Lawyer |
| Can Paystack serve this business? | Its Nigeria list names "Cryptocurrency trading" and "Forex trading and currency exchange", and its global list names "cryptocurrency operators" and "unlicensed financial services" (support article 2127042, read directly). It doesn't mention stored value or digital credits for Nigeria. Its terms page couldn't be read directly. Whether we fit is UNVERIFIED. Starter Business limits are UNVERIFIED too. | Owner asks Paystack in writing, describing it accurately |
| 18+ and no US persons | Attested at sign-in, blocked by IP. IP is a backstop, not proof. The country list is marked UNVERIFIED in `geo.ts`. | Lawyer confirms it's enough for payments |
| Is using GoodDollar face verification allowed? | The docs and terms page show no approval process, which isn't the same as no approval needed. ToS §11 requires approval to use its marks, and §18 limits links to the home page, which may affect our verify link. Whether Good Labs objects is UNVERIFIED. | Owner asks GoodDollar |
| Selling AI at cost + 25% | D9 records that Anthropic's terms forbid reselling unless approved. Whether metered credits count is UNVERIFIED. DeepSeek's terms aren't checked. CLAUDE.md rule 7 applies. | Owner and lawyer, then Anthropic if needed |
| Personal data | Top-ups add an email and payment records, and PR 30 adds visitor emails. Nigerian data rules and retention are UNVERIFIED. | Lawyer |
| Mainnet liability | Users deploy AI-written contracts holding real money, and others use them. Terms say "unaudited", but whether that's sufficient is UNVERIFIED. | Lawyer |
| Tax on sales and fees | Not looked at. UNVERIFIED. | Accountant or lawyer |

## 9. Go-live checklist

**Only the owner:** adds live keys, sets `NEXT_PUBLIC_ENABLE_MAINNET`, merges, makes the first real payment and first mainnet deploy. Claude does none of these.

| # | Step | Who |
|---|---|---|
| | **Before step A** | |
| 1 | Answer section 10's decisions | Owner |
| 2 | Hire a lawyer. Write to Paystack, GoodDollar, iHostio. | Owner |
| 3 | Merge or park PR 30 and wallet-connect | Owner |
| 4 | Build O1 to L1, one session at a time, each with a PR | Claude |
| 5 | Review and merge each PR. Turn on branch protection. | Owner |
| | **Step A: dark, test keys** | |
| 6 | Add Paystack test keys and webhook URL to the server | Owner |
| 7 | Full test-mode run: pay, double delivery, lost webhook, failed card, mismatch, build, debit, out of credits | Claude writes the script, owner runs it on production |
| 8 | Real-browser Sepolia run with MetaMask and an email wallet | Owner, with Claude's steps |
| 9 | Restore drill and one rollback | Owner or a session the owner lets on the server |
| 10 | Trigger each alert, flip each switch | Owner |
| 11 | Check all section 6 gates, and record the results in HANDOFF.md | Claude for tests, owner for live ones |
| 12 | Lawyer's wording merged. Paystack, GoodDollar, iHostio answers in hand. | Lawyer, owner |
| | **Step B: live money, owner only** | |
| 13 | Top up the AI provider account | Owner |
| 14 | Back up the database and copy it off the server | Owner |
| 15 | Add live keys and `PAYSTACK_ALLOW_LIVE=true`, set the live webhook URL, set limits | Owner |
| 16 | First real payment: the smallest amount, from a wallet **not** in `UNCAPPED_WALLETS` (an exempt wallet skips the ledger) | Owner |
| 17 | Confirm the charge, Paystack fee, credit and bank settlement match. Do a small build and see the debit. | Owner, with Claude reading anything the owner pastes |
| 18 | Test a refund and, if Paystack allows, a dispute | Owner |
| | **Step C: mainnet** | |
| 19 | Set `NEXT_PUBLIC_ENABLE_MAINNET=true` and redeploy, with the database switch on admins only | Owner |
| 20 | First mainnet deploy with a small amount of G$ and a separate wallet: deposit, withdraw, publish, use the app | Owner |
| 21 | Confirm Celoscan, Sourcify, the app's address and the old-funds card (replace it once) | Owner |
| 22 | Fund-loss check: nothing stranded, keep that contract for reference | Owner |
| 23 | Switch both to everyone, on the same day, and watch alerts for 48 hours | Owner |

### What Claude can't verify
- Anything legal, or how Paystack or GoodDollar will respond.
- Anything needing live keys, real money or a real wallet: real settlement, disputes, MetaMask screens, Magic signing on mainnet, a real face check, and "Twin" reporting.
- Production: secrets, `UNCAPPED_WALLETS`, disk, memory, backups actually running, and whether a server secret script exists (no SSH, as agreed).
- Real provider balances, and how much the AI providers really charged compared with what we recorded.
- Whether G$ fees can change, and how Celoscan treats Sourcify matches.
- Exact Paystack details wherever section 4 says search summary. Its main docs blocked direct reads.
- Whether 2% covers the real cost of dollars. Only real conversions show that.

## 10. Decisions for the owner

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| 1 | G$ vault deposits in this launch? (D13 and D24 keep them, and this brief lists only Paystack.) | **Leave out**, and show USD only until it exists. It adds a contract holding funds, an indexer and a price oracle. | M1, M8 |
| 2 | Convert naira to USDT and G$ at launch? (D21, D24) | **No.** Record inflows and hold naira until the lawyer and Paystack answer. Provider bills still need dollars, so plan how you'll buy them. | M9, lawyer's brief |
| 3 | Which named rate source (D36), and foreign cards? | Whichever is closest to what you really pay for dollars. Try CBN's published rate if it can be fetched reliably (UNVERIFIED), with an owner override. Compare weekly, and raise the spread if 2% doesn't cover it. Keep foreign cards off at launch. | M4 |
| 4 | Use free AI first, or paid first? | **Free first.** People get what was promised, and it's simple. | M2 |
| 5 | Who may deploy to mainnet? | **Verified or has paid.** Limits disposable scam contracts. Verified alone depends on an untested face check. | C4 |
| 6 | Who pays gas? (Q12) | **The user brings their own CELO.** Add a clear guide, since email wallets start empty and no real faucet exists. | C4 |
| 7 | AI-written contracts on mainnet, or templates only? (CONTRACTS §4) | **Allow them, only through section 6's gates.** Templates only would need a catalogue that doesn't exist. | C3 |
| 8 | What limits? | Contracts: a small cap you set in dollars of G$ (a G$ price source is needed, UNVERIFIED). Top-ups, starting tighter than TOPUPS.md: ₦1,000 to ₦20,000 each, ₦50,000 a day per user, ₦200,000 a day overall. Raise once disputes are understood. | C3, M5 |
| 9 | Should visitors get a way to reach funds in old contracts? | **Follow-up after launch,** with the second typed confirmation until then. | C4 |
| 10 | Free limits versus D28 to D30? (HANDOFF) | **Keep D28 to D30** and the $4 total. Ignore HANDOFF's older $2 and $5-a-day suggestions. Raise the total deliberately, when you add money for it. | M2 |
| 11 | Prepaid or subscriptions? (HANDOFF) | **Prepaid.** It's what's designed, and subscriptions add recurring billing and new legal questions. | M1, M4 |
| 12 | Per-IP sign-up limit? (HANDOFF) | **Yes, but about 10 a day, not 3,** because a campus shares IPs and campus sessions are the growth plan. None exists today. Not launch-blocking while $4 holds. | Small extra PR |
| 13 | Database and backups? | **Off-site hourly backups and a tested restore now,** managed database later. Pick where they go (cost UNVERIFIED). | O2 |
| 14 | Keep your wallet exempt? (HANDOFF) | **Yes,** but test with a separate wallet (step 16). | Step 16 |
| 15 | PR 30 and wallet-connect? | **Merge PR 30 first** after one real email test. Push `feat/app-wallet-connect` to the remote now, since it exists only on this Mac. Finish it before C2, or C2 will have to be redone. | C2 |
| 16 | Which lawyer, and by when? Is there a registered business for Paystack? | Nigerian fintech experience. Start this week. | Live keys |

**Option beyond this plan:** turn section 6 and 7's checks into one `pnpm launch:check` script that CI runs, so future launches depend less on anyone's memory. Worth about one more small PR, and not required.
