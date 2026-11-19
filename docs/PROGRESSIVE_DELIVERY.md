# Progressive first builds and recovery

Approved by the owner on 19 November 2026: implement recovery, loop protection, staged first delivery, bounded platform sponsorship and truthful contract readiness. This changes the execution mechanism; it does not raise the 50-call ceiling.

## Delivery

New first build jobs retain the original request in `build_deliveries`. Their first scope is a working local interface. Wallet, multiplayer, integrations and on-chain features requested in the original prompt become separate saved milestones. The model receives the original goal and current scope on every turn, including answers from planning. Contract edits and transaction-writing code are refused before the on-chain milestone. Kit/template seeding respects that scope.

The first milestone requires a nonstarter app and a successful browser acceptance check. For tic-tac-toe the checker independently plays both winners, a draw, restart, occupied-cell and post-win protection. Wallet acceptance connects a stand-in wallet and checks that its account is shown. Other games retain the existing game probe checks. The isolated checker cannot prove live multiplayer or deployment: a checked implementation can be saved, but its capability remains in the plan's unverified list. `completed` is the implementation cursor; `verified` is the independent browser evidence. The UI does not claim all capabilities work merely because code compiles.

Next-step chips use the saved milestone names. A person can choose a different pending milestone, which reorders only the remaining work. The chat displays the estimated cost before continuation. Normal edits preserve the current scope. Existing projects with working versions do not get retroactively restructured. After the first interface is delivered, a request that names wallet, multiplayer, integration or on-chain work starts that milestone, and adds it to the plan if the first message didn't ask for it (D153). Once an on-chain milestone has been delivered, contract edits stay allowed. A paid build turn whose only edits were refused for scope, so nothing changed, is refunded (D153).

## Recovery and validation

Each completed tool batch saves a lease-fenced `build_drafts` snapshot. The last working `project_files` and version are promoted only after checks pass for queued jobs. Failed generation, funding exhaustion and provider errors keep their draft and diagnostics. A worker crash replays committed model responses without another provider call or debit. The draft is never the replay base when an earlier saved setup exists.

Retry creates one new child job per failed job, enforced by a unique index. Its internal message is labelled as a retry action rather than displayed as something the person said. It carries the original request, saved planning answers, attachments and matching draft. Duplicate clicks return the same child before funding checks. A draft based on an older working version is refused. Queued jobs record their actual base version when claimed, after earlier jobs finish.

Two failed edits supply current file contents and request a different strategy. Four failed/no-op editing rounds stop the loop; different legitimate reads do not count as a stalled edit loop. Two model calls remain reserved for wrap-up. Validation, durable save and fallback reporting do not need another model call. Contract-test failures remain `needs_fix`; the existing independent mainnet custody gate is retained.

## Platform cost protection

Settings are micro-USD, with 10,000 micro-USD per displayed credit:

| Setting | Default | Admission limit |
| --- | --- | --- |
| `FIRST_DELIVERY_MICRO` | 1,000,000 (100 credits) | One first-interface job per live-verified GoodDollar root |
| `BUILD_REPAIR_MICRO` | 300,000 (30 credits) | One recovery job per live-verified root per UTC month |
| `BUILD_SPONSOR_BUDGET_MICRO` | 50,000,000 (5,000 credits) | Monthly actual platform usage plus unspent active reservations |

These are conservative launch limits based on the existing $1 build ceiling and $0.30 repair budget, not measured p95 guarantees. The platform pool is separate from welcome/refill grants. Review these amounts before merging/deploying; the PR does not deploy itself. Set an allowance or pool to zero to disable new sponsored admissions. Existing reservations can finish.

Whole sponsored jobs retain `funding=platform`; each live model call, including memory, checks that the remaining reservation covers its estimated maximum. Naming is disabled for sponsored jobs. Usage rows retain provider cost and list price, while no paid ledger debit occurs. `TurnRecord.sponsoredMicro` displays the platform contribution separately from the person's `chargedMicro`. Incurred usage is inserted idempotently and the sponsorship spend is updated in the same transaction. Terminal jobs release unused reservation from the admission calculation. Allowance keys survive project deletion so deletion cannot reclaim eligibility.

The first allowance is claimed at admission, including a first build that subsequently fails. A matching recovery job uses the repair allowance. Planning retries use their normal planning funding. A build retry cannot silently become paid when sponsorship is unavailable: it explains that progress is saved and the person can request a smaller paid change in the composer. Unverified users retain the existing verification/credit admission rules.

## Validation and limits

Tests cover exact-request scoping, draft preservation, idempotent retry/usage, identity eligibility and expiry, exhausted sponsorship, stale drafts, queued-version capture, planning recovery and real browser game acceptance. No claim of a 95% production success rate is made: measure that after rollout using ready first milestones, failed checks, tool-loop logs, sponsor spend and usage rows. A live-provider replay and production cost percentile analysis require production telemetry; scripted provider tests do not establish those numbers.
