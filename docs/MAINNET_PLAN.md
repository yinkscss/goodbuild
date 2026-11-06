# Launch plan: M6 paid credits and Celo mainnet

Written 6 Nov 2026 and updated the same day with the owner's launch strategy (D37 to D43 in [DECISIONS.md](DECISIONS.md)). Checked against `main` after PR 30 merged. Planning only: no product code, keys, payments or transactions were touched.

**PR 32 (wallets) should merge first.** It claims D36, and the "apps follow their chain" PR builds on its template.

**Honest timing:** about 10 build sessions plus a lawyer and Paystack's answer. It won't fit the 9 Nov date in ROADMAP.md. Whether that date is a hard one is UNVERIFIED.

## 1. What blocks the launch, in order

1. **Lawyer and Paystack.** This is smaller now that there's no naira to crypto conversion, but it stands: nobody has reviewed the legal pages, Paystack hasn't confirmed in writing that selling AI credits is fine, and the gas grant is a new question for the lawyer (section 11).
2. **Mainnet now depends on GoodDollar verification, which has never run end to end.** A real face check, Magic signing and the "Twin" case are all UNVERIFIED (D30), and whether GoodDollar needs to approve this use is unanswered. If it objects, mainnet has no gate.
3. **There's no ledger.** Nobody can hold a balance today (section 3).
4. **Paying customers would be refused by free-trial rules** (section 5).
5. **Generated apps can't use mainnet, and there's no per-project toggle.** Every app is hard-coded to Celo Sepolia (`template.ts:131`, and `appChain` on PR 32), so a mainnet contract would look "not deployed" in its own app. A project's chain is fixed when it's created.
6. **The mainnet switch doesn't work as documented, and can't be turned off quickly** (section 6).
7. **Nothing enforces fund safety.** The withdraw rule is one prompt line, and visitors' funds in a replaced contract have no way out (section 6).
8. **The AI review doesn't exist, and nobody has shown DeepSeek catches anything** (section 8).
9. **The gas grant is the first hot key on a single server** (section 7).
10. **Operations aren't ready for money** (section 10), and nothing compares what customers hold in credit with the AI provider balance.

## 2. How the launch works

**The money rules (D38, D39):**
| | Needs verification? | Paid by |
|---|---|---|
| Buy and use AI credits | No | Paystack, naira. Credits only pay for builds. |
| Extra free AI (D30) | Yes | The owner's AI budget |
| Sepolia deploy | No | Test CELO |
| Mainnet deploy | **Always, even for paying customers** | The user's CELO, or the gas grant |
| Gas grant | Yes | The owner's dedicated wallet, funded separately. **Paystack money can never fund gas.** |

Parked for this launch: naira to crypto conversion, the treasury batch (D21, D24) and the G$ vault. **The cost, for the owner to see, not blocking:** ROADMAP.md promises G$ payment "live from M6" and scores G$ volume and transactions per user (S5 criteria UNVERIFIED). Credits add nothing to those numbers until the vault ships. Mainnet apps paying in G$ still count.

**One launch, three steps.** People see one launch. If B or C goes wrong, nobody else is affected.
| Step | State | Why |
|---|---|---|
| A. Dark | All code merged. Test keys, top-ups, mainnet and gas grant all off | Every merge deploys to production, so unfinished work must be harmless. |
| B. Live money, owner only | Live keys, top-ups set to admins only, low limits, for 1 to 2 days | The first real payment, webhook, credit and spend. |
| C. Mainnet, owner first, then everyone | Mainnet and grant set to admins only, the owner's small deploy, then all switches to everyone the same day | The first real verification, grant, review and deploy. |

Each switch has three settings (off, admins, everyone), kept in the database so it changes without a rebuild.

## 3. What exists versus what's missing (checked in code)

| Area | Today | Missing |
|---|---|---|
| Ledger | `src/server/credits.ts` returns nulls. No ledger or balance tables. | All of it |
| Usage | `usage_events` recorded, idempotent on `call_id`. Five call sites. | A funding source, and any debit |
| Free limits | `cap.ts`: $0.20 (D28), $0.70 verified (D30), $4 total (D29) | Any idea of paid money |
| Reservation | A $0.35 hold per build for the free total. `runner.ts` has no per-build spending limit. | Per-user holds and a stop |
| Paystack, top-up UI, admin | No code. The pill shows "Testnet beta · $0.20 free". | All of it |
| Verification | Built (D30). `syncGoodId` trusts `verifiedAt` once recorded and doesn't re-read. | A live test, and a fresh read for mainnet and the grant |
| Mainnet deploy | `assertChain`, real G$ address, explorer links, Sourcify, D33 refusal | Sections 6 to 8 |
| Network choice | `NetworkToggle` on the prompt box when creating a project | A toggle per project |
| Attestation | 18+ and not-US at sign-in, region block in `proxy.ts` | Nothing more for top-ups |
| Email-wallet key export | Menu item exists (`wallet-button.tsx:187`), not tested live | A live test, since wallets will hold real money |

**Where docs and code disagree:**
- HANDOFF.md lists face verification as M6 step 1, but it's built. Its "waiting on the owner" list is partly overtaken, and it describes M5 as unmerged.
- DEPLOY.md says "CI must pass" before merging. The only workflow is `deploy.yml`, which runs no tests.
- **`scripts/set-secret.mjs` only writes `.env.local`.** No server version exists in git, and `deploy.sh` deletes everything in `/opt/goodbuild/deploy` except `.env.production`. A separate server script is UNVERIFIED (no SSH, as agreed).
- DESIGN_SYSTEM.md's pill is G$ first. D13 says USD is primary, and D38 means USD only for now. Its spec needs updating before M8.
- CREDITS.md and ROADMAP.md still describe the vault as part of M6 (D38 parks it).
- CONTRACTS_AND_DEPLOYMENT.md §4 proposes AI-written contracts on testnet only. D42 replaces that with review and gates on mainnet.
- D29 calls $0.35 "about the dearest" build, while D19 records a $0.50 one.
- D33 says "UNVERIFIED on Celo Sepolia", but it was tested live on 6 Nov.
- `docs/DECISIONS.md` has two D25 entries, and CLAUDE.md item 3 is out of date. Neither blocks anything.

## 4. Build order

One build session at a time. Efforts are rough guesses in tokens, against about 400k for a past session. **Total about 4.0M, or about 10 sessions.** Every PR must be safe to deploy alone, with new features off and migrations that only add. Merging even a docs PR rebuilds production. The ledger migration is `0010` (PR 30 took `0009`, and PR 32 adds none).

| # | PR | Contents | Depends on | Effort |
|---|---|---|---|---|
| | **Safety first** | | | |
| O1 | Tests before deploy, rollback | Checks on every PR, tagged images | | 120k |
| O2 | Off-site backups, restore drill | Section 10 | Decision 8 | 100k |
| | **Credits** | | | |
| M1 | Ledger | Append-only `ledger_entries`, `balances`, a `funding` column on `usage_events` and `turn_jobs`. Existing rows become `free`. No cascade delete on money records. | | 150k |
| M2 | Separate free and paid | `cap.ts` as in section 5 | M1 | 200k |
| M3 | Reservation and debit | Hold, debit in `recordUsage`, stop when the hold runs out, release on every ending | M2 | 300k |
| M4 | Crediting core | `topups`, `fx_rates`, one crediting function. Replay, double delivery, wrong amount and race tests. No network. | M1 | 200k |
| M5 | Paystack test flow | `POST /api/topups`, Initialize, signed webhook on the raw body, Verify, live keys refused unless `PAYSTACK_ALLOW_LIVE=true` | M4 | 200k |
| M6 | Webhook region exemption | One exact path, POST only. Test: nothing else gets through. | M5 | 40k |
| M7 | Reconciliation | Worker timer, disputes as a negative entry, flag mismatches | M5 | 150k |
| M8 | Top-up UI and pill | Modal, USD pill, low-credit card, new refusals, per DESIGN_SYSTEM. Says before paying: **credits pay for AI builds, not gas, and mainnet needs verification.** | M3, M5 | 250k |
| M9 | Admin and switches | Admin page by `ADMIN_WALLETS`: inflows, flagged top-ups, rates, what customers hold versus provider balance, three-setting switches. No batch tools (D38). | M5 | 150k |
| | **Mainnet** | | | |
| C1 | Mainnet switch | Compose build arg, server check of the database switch, split prepare from record | M9 | 120k |
| C2 | Apps follow their chain | Chain from the project, including older projects' locked helpers (as D34 did), prompt and guides. Both this and PR 32 rewrite the template's chain code. | **PR 32** | 250k |
| T | Toggle and flow | Section 6 | C1, C2 | 200k |
| C3 | Fund-safety checks | Withdraw rule and value cap at prepare | C1 | 300k |
| R1 | Review benchmark | Fixtures and scoring, before building the block. Spends under $1 of real DeepSeek, with the owner's OK (decision 4). | | 150k |
| R2 | AI review | Section 8 | C3, R1 | 250k |
| G1 | Gas grant | Section 7 | T | 350k |
| C4 | Real-money deploy flow | Typed confirmation, warning, CELO guide, old-funds and replace fixes | T | 150k |
| C5 | RPC and verification | Second RPC with fallback, repeat the PR 29 read tests, explorer check | C1 | 150k |
| W | Payment message | Section 9 | T | 60k |
| | **Before live** | | | |
| O3 | Monitoring and secrets | Health endpoint, alerts, a server secret script | | 120k |
| L1 | Legal pages | Lawyer's wording, `NEXT_PUBLIC_CONTACT_EMAIL` | Lawyer | 60k |

### Money path rules (M4 to M7)
- **Only the webhook and reconciliation credit,** through one function keyed `topup:<reference>`, in one transaction.
- **Fee on top (D37).** The server works out the total and sends Paystack that exact amount, so verified amount must equal our stored total. Credit is the base. Example at the published local rate: ₦5,000 base is ₦5,177.66 charged, because the fee on that total is ₦177.66. Keep Paystack's dashboard "customer pays" option off, since it could change the reported amount (UNVERIFIED, test it). Test the ₦100 waiver below ₦2,500 and the ₦2,000 cap.
- **Store** the rate, source, spread and reported fee on every row. Any fee difference is absorbed and logged.
- **The top-up switch stops new payments only.** Money already taken must still be credited.
- **Red-team tests:** forged signature, replayed event, a real signature with another reference, a tampered amount, two deliveries at once, webhook before our row commits, a chargeback after the credit is spent.

### Paystack facts used
| Fact | Source |
|---|---|
| `x-paystack-signature`, HMAC SHA512 with the secret key. Must return 200. Source IPs 52.31.139.75, 52.49.173.169, 52.214.14.220. | docs-v2 webhooks page, read directly |
| Live retries: every 3 minutes for 4 tries, then hourly for 72 hours. Test retries: **the docs disagree** (72 hours or 10 hours). | docs-v2 directly, current page by search summary |
| Local fee 1.5% + ₦100, waived under ₦2,500, capped at ₦2,000. International 3.9% + ₦100 (one article says flat 3.9%). | Search summaries. **paystack.com blocked direct reads**, so check the dashboard. |
| Verify returns `amount`, `currency`, `status`, `reference`, `fees`, in kobo. | Sample payloads. **UNVERIFIED** until a test-mode run. |

Traffic arrives through Cloudflare, so don't rely on those IPs. Whether Cloudflare challenges Paystack's requests is UNVERIFIED, and M5's first test delivery checks it.

## 5. The free-trial trap, and how paid usage works

`checkAiAllowance` is worse than one wrong message:
- `spentMicro` and `identitySpentMicro` add up **all** usage. After $0.20 of any spending, a payer is told "Verify with GoodDollar", which D39 says they must never need for credits.
- `budgetHasRoom` adds up **all** provider cost and counts **all** queued and running builds. Paid builds would fill the $4, shut free AI for everyone, and show payers "The free trial is full".
- `hasPlanHeadroom` and `shouldOfferVerification` have the same problem.

**The fix (M2 and M3):**
1. **Every usage row and job records who funds it:** `free`, `paid`, `exempt` or `platform` (the AI review, decision 3). A job has one source from start to finish.
2. **Free counters and the $4 only add up `free` and `exempt`.** Past rows count as free, so today's total doesn't change.
3. **At build start:** exempt goes ahead. If free room and budget remain, it's a free build (decision 5). Otherwise, if balance minus holds covers the minimum, it's a paid build. Otherwise, refuse.
4. **Refusals:** anyone who has paid sees "You're out of credits. Top up to keep building." A test proves a user with balance can't get a free-limit message.
5. **The hold.** Start at $1 charged, to be checked against real data. Before each model call, extend the hold from the balance if needed, or stop cleanly with the worker's existing abort. A stopped build keeps what's saved and says why.
6. **One debit point.** `recordUsage` debits in the same transaction, and only if the row was inserted, because today it returns a cost even on a duplicate. Uploads, visual check and project names debit directly. Small negatives are written off (CREDITS.md §4).
7. **Crash-lost calls** (P18) cost money and bill nothing. Compare provider invoices with recorded cost monthly, by hand at first.

## 6. Toggle and mainnet safety gates

**The flow (D40):** toggle, verify if needed, gas grant, AI review, typed confirmation, deploy.

**How the toggle works (T):**
- New projects always start on Sepolia, and the prompt box's network choice goes away. Only the project's own toggle reaches mainnet.
- Refused while a build is running. Refused for projects in the D33 proxy trial, until it's turned off.
- Contracts don't move. Addresses are already kept per chain, so each network has its own.
- A published app is a snapshot, so it stays on its old chain until published again. The toggle says so.
- **The preview on mainnet would spend real money.** Show a clear banner there.
- The wallet pill follows the project's chain, not the global flag (`expectedChainId` today would tell testnet users to "Switch to Celo").

Each gate must pass before step C. "Check" means something that can fail.

| Gate | Today | Check |
|---|---|---|
| **Verification** | `verifiedAt` kept forever (D30) | At prepare on mainnet, read `getWhitelistedRoot` fresh. Refuse if zero, or if the read fails. Whether expiry returns zero is UNVERIFIED (decision 6). Test both paths, including a paying user being refused. |
| **Mainnet switch** | Compose doesn't pass `NEXT_PUBLIC_ENABLE_MAINNET` though the Dockerfile declares it. `.env.production` reaches running containers, so the worker would see it and the web build wouldn't. | C1 adds the build arg and tests what server code sees after a build (UNVERIFIED today). |
| **Kill switch** | `assertChain` guards prepare and record alike, and the flag is build-time | The database switch stops prepare only. A signed transaction must still record, and withdrawals still work. Test both. |
| **Withdraw rule** | One prompt line (`prompt.ts`), plus a name match for the old-funds card | At prepare on mainnet, a contract that can receive G$ or CELO is refused without an exit function **and** a passing contract test in which a non-owner deposits and withdraws. It proves one path, not safety. |
| **Typed confirmation and warning** | An "Unaudited" chip | Type the contract name beside "Unaudited, may lose funds". The server refuses without it. |
| **Value caps** | None | A required constant limits what a contract holds, with a contract test that going over reverts (decision 7). It only binds generated code. |
| **D33 proxy trial** | Refused at toggle, prepare and record, with tests at `upgradeable.evm.test.ts:758-770` | Those stay in CI. There's **no upgrade delay**, which doesn't matter while proxies are refused. Allowing them later needs a delay and a new decision. |
| **Real G$ address** | `0x62B8…9c7A` | **Verified 6 Nov:** matches GoodProtocol's production-celo, and reads as "GoodDollar", "G$", 18 decimals. Check: a test pins the address. |
| **Real G$ differs from test G$** | Test token has no fees or pause | The real one has `getFees` (0 for 1,000 G$ today) and `pause`. Whether fees can change is UNVERIFIED. Refuse at prepare if the fee isn't 0, and teach the builder to count what's received. |
| **Source verification** | Sourcify only, tested on Sepolia. Links go to Celoscan. | Sourcify lists 42220 (checked 6 Nov). A mainnet match and Celoscan showing it are UNVERIFIED. Owner's first deploy checks it. |
| **Old-funds card** | Failed reads count as 0. Only G$ is read. Says "Nothing is lost". Matches `rescue` and `sweep`. | On mainnet: "couldn't check" instead of hiding funds, check CELO too, soften the copy, and don't offer `rescue` or `sweep`, since an owner could take other people's money. Each has a test. |
| **Replace warning** | Warns and lists the old balance | **Visitors' funds stay in the old contract, and a republished app points at the new one.** Replacing a contract that holds funds, or whose balance couldn't be read, needs a second typed confirmation. A way for visitors to reach old contracts is a follow-up. |
| **RPC** | One forno URL per chain, no fallback. PR 29 was tested only in a local EVM and with fakes. | Set `CELO_RPC_URL` with a fallback, and repeat a deploy in a real browser with MetaMask. A new RPC host needs adding to Magic's allowed list. |
| **Free rules** | No difference by chain | D28 to D30 stay as they are. They limit AI money, not chains. |
| **Testnet leftovers** | "Celo Sepolia for now", "Mainnet unlocks later" | Search for these strings. |

**Not gated:** no external audit or Slither run. Every contract stays labelled unaudited.

## 7. Gas grant (D41)

**What it does:** a dedicated wallet the owner funds in small amounts tops the signed-in wallet up to 1 CELO, once per GoodID root, up to 20 grants a day, automatically. Past the limit or when the wallet is empty, people see the owner's Telegram link, a setting left blank until the owner fills it in. A blank link shows nothing.

### Costs
Measured 6 Nov on mainnet, read only, by the coordinating session: a compiled 2,157-byte tip jar estimates 479,062 gas, 0.097 CELO at 202.5 gwei (0.116 at maxFee), with base fee steady at 200 gwei over about 1,000 blocks. CELO was about $0.069 on CoinGecko.

| Item | Amount |
|---|---|
| One grant | At most 1 CELO, about 7 cents. Less if they hold some. Sending adds about 0.004 CELO (21,000 gas, my calculation). |
| What 1 CELO buys | About 10 small deploys, or **under one** 24 kB contract (hand estimate about 1.3 CELO). Multi-contract manifests add up. |
| **20 a day, every slot used** | About 20.1 CELO: **about $1.39 a day, or $42 a month** |
| CELO at 10 times the price | $13.90 a day, or $420 a month, for the same grants |
| Base fee doubles | Costs us the same. The grant buys half as much: about 5 small deploys. |

The grant is fixed in CELO, so the price risks fall on different people: a price rise costs the owner, and a fee rise shortchanges the builder. **The wallet's balance is the real ceiling,** which is why it stays small. Suggested: fund about 25 CELO at a time, about $1.70. Amount and daily limit are settings. Using 20 slots a day also needs 20 new verified people a day.

**The deploy step compares the plan's estimate with the wallet's balance plus any grant.** If it won't be enough, it says so before anyone uses the grant, and shows the Telegram link. The estimate is exact only for the first argument-free contract today (HANDOFF), so C4 improves it or adds a margin.

### What it doesn't cover
- **Visitors.** Anyone using a mainnet app needs their own CELO and G$. The builder must know this before launch day, and it's in section 9's message.
- **Linking a wallet in the Twin case.** GoodDollar's guide says `connectAccount` is a transaction, so it costs gas. It appears to be signed from the already verified wallet (my reading, UNVERIFIED). The grant can't help, since it only comes after verification. These people need CELO already, so the verify card points them to Telegram too.
- **G$ for testing.** A new builder has none, and there's no mainnet faucet. Claiming G$ costs gas (UNVERIFIED how much).
- **Later transactions:** moving funds out of old contracts, using their own app, redeploying after the grant runs out, failed deploys. It's once per person, so these come from what's left.
- Not gas: face verification, sign-in, publishing and app data sign-in are all signatures or server work. The proxy trial stays off mainnet, so "Lock it" doesn't apply.

### Required design
1. **Who gets it:** the route takes no address. It uses the session wallet only.
2. **Fresh check:** the server reads `getWhitelistedRoot` right before queuing, and the sender reads it again before signing. It must not use `syncGoodId`, which returns early for anyone already recorded. A failed read means no grant.
3. **Contract ready:** only for a mainnet project whose contract passes prepare and all deterministic checks, so grants aren't farmed. Decision 2 asks whether to wait for the AI review too.
4. **No double pay:** a `gas_grants` table with `goodid_root` unique. The insert decides who wins a race. A wallet already at 1 CELO gets nothing and uses up no grant.
5. **Daily limit:** counted in the same transaction, under a lock, by day.
6. **One sender, one at a time,** to avoid nonce collisions.
7. **Crash-safe sending, in this order:** claim the row, read the balance, sign, **save the signed transaction, hash and nonce to the row, then broadcast.** After a crash or an unclear answer, send the same signed transaction again, never a new payment. It has the same nonce, so it can only land once. A stuck one is replaced with the same nonce, recipient and amount at a higher fee. Anything still unclear after that goes to `needs_review` and alerts the owner. It's never retried automatically.
8. **The key.** `.env.production` goes to web, worker and migrate through `env_file`, and `execFile` at `checks.ts:150`, `contract-tests.ts:30` and `upgrade-check.ts:30` passes no `env`, so children inherit everything. So the key **isn't** in `.env.production`. It's a mounted file only the faucet module reads, never in `process.env`. As well, those three calls get an explicit short env, with a test that a child sees no key.
   - **Challenge, for decision 1:** the worker runs compiles and tests over AI-written code. A small separate sender container with the key and no child processes is safer than the worker doing it, for little extra. If the owner prefers the worker, the rules above still hold.
9. **Kill switch:** the same three-setting switch, read before every send. Turning it off doesn't strand a signed transaction: it can still confirm.
10. **Alerts by email through Resend, no new bot:** when someone verifies, when the wallet can fund under 3 more grants, on `needs_review`, on any send not matching a row. These shouldn't use up the visitor-email cap (`EMAIL_DAILY_CAP`), and verification emails should become a daily digest if they get noisy.
11. **Separate from money:** the module imports nothing from credits or Paystack, enforced by a test, so Paystack money can't reach gas by code. The owner funds it separately.

### Red team
| Attack | Result | Test |
|---|---|---|
| Send someone else's address | Route has no address field | Extra fields ignored, grant goes to session wallet |
| Two tabs or parallel requests | Unique root, only one row | 30 parallel requests, one send |
| Many wallets, one person | Linked wallets share a root | Two wallets on one root, one grant |
| Fresh wallets, one face | Depends on GoodDollar's duplicate check. **UNVERIFIED** (Twin) | Live test, once |
| Fake the verification callback | The callback is never read, only the chain | Forged redirect, no grant |
| RPC returns a false or stale root | Second read before signing. A lying provider is still a risk, limited by the wallet balance. | Fake RPC tests |
| Crash between sign and broadcast, or a timeout | Same signed transaction resent | Kill at every step, count transfers in a local EVM |
| Take the grant and send it on, no contract use | Accepted: 7 cents per face. Contract-ready makes it harder, not impossible. | Monitor |
| Trivial contract to qualify | Accepted, for the same reason | Monitor |
| Drain speed | 20 a day and the balance | Limit test at 20 and 21 |
| AI-written code reads the key | Not in env or any path it can reach. Contracts run in a local EVM only. | Child env test. AI-written app code runs in browsers, never on the server. |
| Server compromised (root) | **The key is lost.** So is the Paystack secret, which is worse. Loss is limited to the balance. | Keep it small, and rotate: new wallet, move funds, replace the file |
| Key leaks in logs or errors | Nothing logs signing inputs | Search logs after step C |
| Key reused elsewhere | One wallet, one purpose, generated by the owner, never seen by Claude | Owner's checklist |
| Backup leak | Key isn't in the database. Signed transactions saved there are already-public payments. | Inspect a dump |

## 8. AI review (D42)

**Who:** `deepseek-flash`, not Sonnet (the owner's choice). It checks for vulnerabilities and whether the contract matches the brief. It's an **AI review, never called an audit.** "Unaudited, may lose funds" and typed confirmation stay, including after a clean result: "The AI review found no serious problems. That doesn't mean it's safe."

**Design:**
1. **Exact source.** Runs on what prepare compiled, keyed by `sourceHash`, brief hash, prompt version and model. Prepare refuses mainnet without a passing row for that key, so any code change means a new review.
2. **Deterministic checks first, and they always win:** guardrails, withdraw rule, value cap, contract tests. If they fail, there's no AI call. No AI answer can clear them.
3. **The brief** comes from the saved D32 plan answers (`planBrief`). **Challenge:** answers alone would flag later changes the person asked for, so later user requests are added. A person who skipped planning has only those. With no brief at all, the mismatch check says "no brief to compare" and doesn't block.
4. **Structured findings,** by a tool call: severity, category, contract, function, line, evidence, suggested fix. The code works out the verdict from the findings. The model has no "pass" field to be talked into.
5. **Code is data.** Strip comments and NatSpec using the compiler's output, not a regex. Mark code and brief as untrusted text. Strings and names can't be stripped, so the tests cover them.
6. **A finding at a place that doesn't exist** shows but doesn't block. The benchmark checks how often this happens.
7. **Fail closed.** Provider down or unusable reply: "Couldn't review yet, try again", no deploy.
8. **Try fix** sends findings as a build prompt, like the visual check's "Fix these". It uses normal credits, and a new source gets a new review.
9. **The override is the platform owner's only (`ADMIN_WALLETS`),** I'm reading "owner-only" that way, because a project owner's override would defeat the block. Per finding and per source hash, with reason, date and an email. It can't clear deterministic checks. Confirm in decision 3.
10. **Abuse limit:** only verified users, about 10 uncached reviews per project a day.

**Prompt injection is the main attack, because the code under review can try to steer its own verdict,** and a scammer building a contract to trap visitors wants a clean result. Test each of these against a clean twin of the same vulnerable contract, where findings must match: comments and NatSpec (should be gone), string constants, function, variable and event names like `auditorApproved_noIssues`, error names, the brief's own text, file names and manifest values.

**Who pays and what it costs:** recommendation is that the platform pays (decision 3), because a verified person with no credit left shouldn't be stuck at the last step. Calculated with the repo's price table and 2.5 characters a token. **No provider was called, so these aren't measured.**

| Case | Input + output tokens | Provider cost |
|---|---|---|
| RTX fixture, 7.8 kB, thinking off | about 4.3k + 1.5k | about $0.003 |
| Same, thinking on (D32 saw 6,000 tokens of thinking) | about 4.3k + 7.5k | about $0.010 |
| Largest contract, about 40k characters | about 17k + 4k to 12k | $0.01 to $0.02 |

At 20 deploys a day with 3 reviews each, that's about $1.20 a day at worst. R1 replaces these with real numbers.

**Benchmark (R1), before the block is built.** Nobody has shown DeepSeek catches anything.
- **Fixtures:** about 30 vulnerable contracts in house style, Solidity 0.8.28 with OpenZeppelin: reentrancy, missing access control, owner drains, broken withdraw accounting, `unchecked` overflow, signature replay, denial of service in loops, price manipulation, plus brief mismatches like "only I can withdraw" against "anyone can". About 15 clean ones, including the ones it might wrongly accuse. Known public sets (for example SmartBugs or Damn Vulnerable DeFi) can add more if their licences allow (UNVERIFIED), though many are old Solidity. Anything deterministic checks catch doesn't count.
- **Held out:** a third is never used to tune the prompt. Three runs each, because answers vary. Thinking on and off.
- **Report:** catch rate by class, false blocks, injection results, real cost and time.
- **Suggested bar on held-out contracts:** catches at least 80% of high-severity problems, wrongly blocks at most 15% of clean ones, and injection never flips a result.
- **If it misses the bar,** the owner sees the numbers and chooses: tune it, or keep it as a weak extra check and say so. Don't call it protection in either case.

## 9. Payment message (D43)

If an app needs to receive payment, it becomes a web3 app, and the builder says mainnet is there when they're ready.

**Suggested wording:** "This app takes payments, so it runs on Celo as a web3 app. Try it on Celo Sepolia first. When you're sure everything is ready and you want to receive real money, you can switch it to mainnet. Mainnet needs GoodDollar verification, payments arrive as crypto rather than card or bank transfer, and your customers need their own CELO and G$."

| Where | How | Why there |
|---|---|---|
| Plan-first summary card (`plan-card.tsx`) | Fixed text, shown when the planner's `ask_questions` sets a new `needs_payment` field | Before they commit. `INTAKE_PROMPT` bans words like "deploy" and "gas", and any talk of networks, in the model's questions, so this is GoodBuild's text, not the model's. Those bans stay. |
| Builder's replies (`prompt.ts`) | A rule: when an app takes payment, say it's a web3 app on Celo and that real money means switching to mainnet when ready. Don't say it's ready or safe. | Follow-ups and first requests with no plan |
| After a build, in chat | Fixed system note, with a button to the toggle, when section 6's check finds a contract can receive funds | The reliable backstop, since the planner's field comes from a cheap model |
| Deploy step on mainnet | The same facts beside the warning | Last chance to read it |

**Honest limit:** generated apps can't take naira, because Paystack is only for GoodBuild's own credits. A salon wanting card payments has to be told that, not given a G$ contract as if it were the same. The planner's rule against asking regular apps about money stays. The note only appears if they asked for payments.

## 10. Operations before real money

| Need | Today | Plan | Check |
|---|---|---|---|
| Backups | Nightly, 7 days, same server | Encrypted copies off the server, at least hourly | New copy appears, and an alert fires after 2 hours without |
| Restore | Documented, no recorded drill | Restore elsewhere and compare ledger totals | Dated record. **A gate for step B.** |
| Moving the database | DEPLOY.md says to | **Challenge:** it adds cost and doesn't fix the single web server. Off-site backups plus reconciliation cover the money risk first. | |
| One server | Accepted by D27 for free use | Accept for launch, with a written recovery plan. Paystack retries for 72 hours. | Time it once |
| Hosting terms | Written permission covers "blockchain and testnet work" | Ask iHostio about mainnet, payments and a hot wallet | Written answer |
| Secrets | `.env.production`, mode 600 | O3's server script. Live keys only entered by the owner. Gas key per section 7. | Search logs for key prefixes |
| Tests before deploy | None | O1, plus a branch rule | A failing PR can't merge |
| Rollback | None. `goodbuild:latest` is overwritten, built on the live box. | Tagged images. Migrations only add during launch. | One rollback before step B |
| Monitoring | A post-deploy check that `/` returns 200 | Outside uptime check, `/api/health`, email alerts: webhook failures, flagged top-ups, reconciliation lag, RPC errors, old backups, disk | Trigger each once |
| Provider balance | Nothing | Admin records provider top-ups. Alert when balance falls below what customers hold plus the free budget, and **top-ups pause by themselves**. A balance API is UNVERIFIED for both. | Test the pause |
| Provider bills | Naira settles to the owner, and bills are in USD | With no conversion, the owner needs a way to pay them. D27 notes a card declined by another vendor. | Owner confirms |
| Kill switches | None at runtime | Top-ups, mainnet, gas grant | Flip each, effect within a minute |
| Merge freeze | Every merge restarts production | No merges during B and C, except fixes | Agreed |
| Main site headers | No security policy found in `next.config.ts` or `proxy.ts`. Cloudflare's settings not checked. | Review before M8 | Header present, checkout works |

## 11. Legal and compliance

No legal conclusions here. **Live keys wait for the first three. Mainnet waits for the next two.**

| Question | What we know | Who |
|---|---|---|
| Terms, Privacy and refund wording | Unreviewed drafts. They don't mention credits, payments or Paystack. D37's refund policy needs wording. | Lawyer |
| Do prepaid credits count as stored value? | CREDITS.md flags it, UNVERIFIED. They're non-transferable and only pay for builds. | Lawyer |
| Will Paystack confirm selling AI credits in writing? | Its Nigeria list names "Cryptocurrency trading" and "Forex trading and currency exchange", and its global list "cryptocurrency operators" (support article 2127042). No word on digital credits. D38 removes conversion, but the business still helps people deploy to mainnet, so describe all of it. Starter Business limits UNVERIFIED. | Owner |
| **Is the gas grant a problem?** New | Giving out crypto automatically from a platform wallet, based on an identity check. Virtual-asset rules, sanctions, tax and promotions are all UNVERIFIED. | Lawyer |
| Is using GoodDollar verification allowed, and as a gate for a grant? | No approval process found, which isn't the same as none needed. ToS §11 needs approval for its marks, and §18 limits links. **Mainnet now depends on this.** | Owner asks GoodDollar |
| Mainnet liability | Users deploy AI-written contracts holding real money, and an "AI review" could be read as assurance. Wording UNVERIFIED. | Lawyer |
| 18+ and no US persons | Attested, IP-blocked. The country list is UNVERIFIED in `geo.ts`. | Lawyer |
| Selling AI at cost + 25% | D9 records Anthropic forbids reselling unless approved. Whether metered credits count is UNVERIFIED, and DeepSeek's terms aren't checked. | Owner, lawyer |
| Personal data | Top-up emails, visitor emails (PR 30). Nigerian rules UNVERIFIED. | Lawyer |
| Tax | Not looked at, UNVERIFIED. | Accountant |

## 12. Go-live checklist

**Only the owner:** adds live keys, sets `NEXT_PUBLIC_ENABLE_MAINNET`, creates and funds the gas wallet, merges, makes the first real payment and first mainnet deploy.

| # | Step | Who |
|---|---|---|
| | **Before step A** | |
| 1 | Answer section 13. Merge PR 32, after setting its WalletConnect ID. | Owner |
| 2 | Hire a lawyer. Write to Paystack, GoodDollar, iHostio. | Owner |
| 3 | Build the PRs in section 4, one session at a time | Claude |
| 4 | Review and merge each. Turn on branch protection. | Owner |
| | **Step A: dark, test keys** | |
| 5 | Add Paystack test keys and webhook URL | Owner |
| 6 | Full test run: pay, double delivery, lost webhook, failed card, mismatch, build, debit, out of credits | Claude writes it, owner runs it |
| 7 | **A real face check on a real wallet,** with an email wallet too | Owner |
| 8 | Real-browser Sepolia run with MetaMask and an email wallet, through the toggle | Owner, with Claude's steps |
| 9 | Review benchmark reviewed against the bar | Claude reports, owner decides |
| 10 | Restore drill and one rollback | Owner |
| 11 | Trigger each alert, flip each switch | Owner |
| 12 | Section 6 gates recorded in HANDOFF.md | Claude for tests, owner for live |
| 13 | Lawyer's wording merged. Written answers in hand. | Lawyer, owner |
| | **Step B: live money, owner only** | |
| 14 | Top up the AI provider, and back up the database off the server | Owner |
| 15 | Add live keys and `PAYSTACK_ALLOW_LIVE=true`, webhook URL, limits | Owner |
| 16 | First real payment, smallest amount, from a wallet **not** in `UNCAPPED_WALLETS` (exempt skips the ledger) | Owner |
| 17 | Confirm charge, fee, credit and bank settlement match. Do a small build and see the debit. | Owner |
| 18 | Test a refund and, if Paystack allows, a dispute | Owner |
| | **Step C: mainnet** | |
| 19 | Set `NEXT_PUBLIC_ENABLE_MAINNET=true` and redeploy, switches on admins only | Owner |
| 20 | Create the gas wallet on your own device, install the key file, fund a little, set the Telegram link if ready | Owner |
| 21 | From a separate verified wallet: toggle, grant, review, typed confirmation, deploy with a small amount | Owner |
| 22 | Check exactly one grant was sent, and one email. Try for a second: refused. | Owner |
| 23 | Deposit, withdraw, publish, use the app, replace once, check Celoscan and Sourcify | Owner |
| 24 | Switch everything to everyone the same day. Watch alerts for 48 hours. | Owner |

### What Claude can't verify
- Anything legal, or how Paystack, GoodDollar or iHostio will respond.
- Whether DeepSeek catches anything, until R1 runs. Review costs here are calculated, not measured.
- Anything needing live keys, real money or a real wallet: settlement, disputes, MetaMask, Magic on mainnet, a real face check, Twin.
- What `getWhitelistedRoot` returns after verification expires. Whether one face can get a second root.
- The citizen-sdk and multi-chain registration facts in D39, and the gas and price measurements in section 7, came from the coordinating session. I didn't re-run them.
- Who signs and pays for `connectAccount`. How much claiming G$ costs.
- Production: secrets, `UNCAPPED_WALLETS`, disk, memory, whether backups run, whether a server secret script exists.
- Real provider balances. Whether G$ fees can change, and whether Celoscan shows Sourcify matches.
- Paystack details labelled search summary. Whether 2% covers the real cost of dollars.

## 13. Decisions for the owner

Settled and removed: G$ vault, naira conversion, who may deploy to mainnet, who pays gas, AI-written contracts on mainnet, and the Sonnet or DeepSeek question.

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| 1 | Where does the gas key live? | **A small separate sender,** not the worker that compiles AI-written code. | G1 |
| 2 | Grant before or after the AI review? D40 says before. | **After.** A blocked contract doesn't need gas, and it makes farming harder. Costs nothing, but changes your order, so it's yours to say. | G1, T |
| 3 | Review: who pays, and who overrides? | **The platform pays** (under 2 cents each), and **only you can override,** not project owners. | R2, M2 |
| 4 | Approve under $1 of real DeepSeek for the benchmark, and its bar? | **Yes.** 80% caught, at most 15% wrongly blocked, no injection flips. | R1 |
| 5 | Free AI first, or paid first? | **Free first.** | M2 |
| 6 | Verification expired on mainnet? | **Must verify again to deploy.** The one grant isn't renewed. | T |
| 7 | Limits? | Contracts: a small cap you set in dollars of G$ (needs a price source, UNVERIFIED). Top-ups: ₦1,000 to ₦20,000 each, ₦50,000 a day per user, ₦200,000 a day overall, tighter than TOPUPS.md. | C3, M5 |
| 8 | Backups? | **Off-site hourly and a tested restore now,** managed database later. Pick where they go (cost UNVERIFIED). | O2 |
| 9 | Named rate source, and foreign cards? | Whichever is closest to what you really pay for dollars. **Compare before launch:** if it gives more dollars than you can buy, by more than the 2% spread, every top-up loses money. An official rate may fail this (gap UNVERIFIED). Keep an override, and keep foreign cards off. | M4 |
| 10 | Prepaid or subscriptions? (HANDOFF) | **Prepaid.** | M1, M4 |
| 11 | Free limits versus D28 to D30? (HANDOFF) | **Keep them** and the $4. Ignore HANDOFF's older $2 and $5-a-day ideas. | M2 |
| 12 | Per-IP sign-up limit? (HANDOFF) | **Yes, about 10 a day, not 3,** because campuses share IPs. None exists today. Not launch-blocking while $4 holds. | Small extra PR |
| 13 | Your wallet exempt? (HANDOFF) | **Yes,** but test from a separate wallet. | Step 16 |
| 14 | How will you pay provider bills from naira? | Your call, and needed before step B. | Step 14 |
| 15 | Lawyer, and a registered business for Paystack? | Nigerian fintech experience. Start this week. | Live keys |

**For you to see, no decision needed:** dropping the vault gives no G$ numbers from credits (section 2).

**Option beyond this plan:** turn sections 6 and 10's checks into one `pnpm launch:check` that CI runs. About one more small PR, and not required.
