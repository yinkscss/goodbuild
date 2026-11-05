# Naira top-ups via Paystack (D21, part of M6)

**Status: design for review. No code yet.** Written 5 Nov 2026 on branch `m5-deploy`. Everything marked **UNVERIFIED** must be checked against Paystack's current docs and dashboard before it is built on. Challenge anything here (CLAUDE.md rule 2); open points are collected in §10.

User brief (D21): users top up in NGN through Paystack (Starter Business). Treasury logic is backend-only. The UI shows only "Top up" in NGN and the resulting credit balance, and **never** G$ conversion, batching or treasury details. Test mode only for now.

## 1. Overview
```text
User (NGN) -> Paystack checkout -> charge.success webhook -> verify -> USD ledger credit (instant)
                                                                  \-> topups row (unconverted)
Admin, weekly: unconverted NGN -> USDT (off-platform) -> Celo treasury -> G$ via GoodDollar reserve
               -> treasury_batches row (tx hashes) <- covers N topups
```
- Credits are the USD-denominated ledger of D13 / [CREDITS.md](CREDITS.md) §3. A top-up appends one `ledger_entries` row (`kind = deposit`, key `topup:<reference>`) and bumps `balances` in the same DB transaction.
- The user-facing path ends at the ledger. Treasury conversion happens later, off the request path, and never changes a user's balance.
- **Dependency:** the ledger tables (`ledger_entries`, `balances`) are built first in M6. TOPUPS adds `topups`, `fx_rates` and `treasury_batches` on top.

## 2. User flow
1. **Top up** opens a modal (DESIGN_SYSTEM §4 style): NGN presets (for example ₦2,000 / ₦5,000 / ₦10,000) and a custom amount. Under the amount: "You'll get **$X.XX** of AI credits" at today's rate, after fees. No G$ anywhere.
2. `POST /api/topups { amountNgn, email }` (session required): validates limits, creates a `topups` row (`status = initialized`, unique `reference = gb_<uuid>`), calls Paystack **Initialize Transaction** with the amount in kobo, and returns the `access_code`.
3. The browser opens Paystack's checkout (card, bank transfer, USSD) using `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` and the server-issued `access_code`. The amount is fixed server-side, so the client can't change it.
4. On close/callback the modal polls `GET /api/topups/:reference` and shows "Payment received. $X.XX added" or "Still confirming…". **The client never credits anything.** Only the webhook and the reconciliation job do.
5. The credits pill updates. If the balance was low or zero, the inline "Top up" card in chat goes away.

Paystack requires a customer **email** on initialize. Wallet-only users have none, so the modal asks for one (receipts) and stores it on the top-up row only, not on the user (Q30). Copy must say users **buy GoodBuild credits, not crypto**; see §9.

## 3. Webhook and verification (the money path)
`POST /api/webhooks/paystack`, public, no session:
1. Read the **raw body** (before JSON parsing). Compute `HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)` and compare with the `x-paystack-signature` header using a constant-time comparison. Reject with 401 on mismatch. Optionally also allowlist Paystack's published IPs (UNVERIFIED, check docs; do not rely on it alone).
2. Only handle `charge.success`. Ignore other events with 200.
3. **Do not trust the payload.** Call **Verify Transaction** for `data.reference` and require: `status = success`, `currency = NGN`, and `amount` equal to the amount stored on our `topups` row. A reference we never issued is logged and ignored.
4. In one DB transaction: lock the `topups` row, return early if it is already `credited` (idempotent by reference), compute and snapshot the credit (§4), insert the ledger entry with `idempotency_key = topup:<reference>`, update `balances`, mark `credited`. A unique index on `reference` and on the ledger key makes a replay a no-op even under concurrent deliveries.
5. Respond 200 fast. Failures after verification return 5xx so Paystack retries.
- **Reconciliation job:** every few minutes, `initialized`/`paid` top-ups older than 10 minutes are checked with Verify Transaction, so a lost webhook never strands a payment. Stuck or mismatched rows go to a `flagged` status for the admin page.
- **Dev/test:** test-mode webhooks need a public URL (tunnel), or the reconciliation job alone can credit test top-ups locally.

## 4. Crediting maths
```text
net_ngn      = amount_ngn - paystack_fee_ngn            (fee from the verified transaction)
credit_usd   = net_ngn / ngn_per_usd                    (rate snapshotted for the day)
credited_micro = floor(credit_usd * 1_000_000)          (1 credit = 1 micro-USD, CREDITS.md §1)
```
- `fees` come from the verified transaction (`fees` field, UNVERIFIED), not from our own formula. Paystack's published NGN local fee is about 1.5% + ₦100 (waived under ₦2,500, capped at ₦2,000), UNVERIFIED, so check the dashboard. By default the merchant bears the fee, which is why we subtract it.
- **Rate source ("the day's NGN→USD rate")** is the biggest financial risk in this design. Options:
  - **A. An FX API's mid-market or official rate.** Simple, but the official NGN rate can differ materially from what we later get converting NGN to USDT.
  - **B. A parallel/P2P NGN→USDT rate** (closer to what the treasury really realizes). Needs a reliable source (UNVERIFIED which).
  - **C. An admin-set daily rate** in `fx_rates(day, ngn_per_usd, source)` with an automated suggestion, plus a configurable **spread** in basis points that is added to the rate to cover the weekly-batch delay, the USDT off-ramp spread and G$ slippage.
  - **Claude's input: C**, anchored to B. The credit rate must not be better than the rate the treasury will realize, or each top-up loses money. Store `ngn_per_usd`, `fx_source` and `spread_bps` on every top-up, so the credit is reproducible.
- Limits (proposal): minimum ₦1,000, maximum ₦200,000 per top-up, a daily cap per user, and the D10 attestations (18+, not a US person) required before the first top-up.
- Rounding always favours the platform by under one micro-USD.

## 5. Data (Postgres, Drizzle; migration added with M6)
| Table | Key columns |
|---|---|
| `topups` | id, user_id, reference (unique), paystack_tx_id, email, amount_kobo, fee_kobo, currency, status (`initialized`/`paid`/`credited`/`failed`/`flagged`), ngn_per_usd, fx_source, spread_bps, credited_micro, ledger_entry_id, batch_id (null until covered), created_at, paid_at |
| `fx_rates` | day (pk), ngn_per_usd, source (`manual`/`api`), set_by, created_at |
| `treasury_batches` | id, created_by, ngn_net_kobo, offramp_ref, usdt_amount, celo_deposit_tx, gd_buy_tx, gd_received_wei, min_return_wei, notes, created_at |
| `ledger_entries` / `balances` | as in CREDITS.md §3 |

A `topups` row is never deleted. `batch_id` is the only field the treasury side writes.

## 6. Treasury (admin only, never in the user UI)
- **Who:** a wallet allowlist (`ADMIN_WALLETS`, env) checked against the SIWE session on every admin route. Nothing else in the app links to it.
- **Page `/admin/treasury` and a script `pnpm treasury:report`:**
  - unconverted totals: sum of `net` NGN (amount minus fee) for `credited` top-ups with `batch_id IS NULL`, per day and in total;
  - the rate and spread used, so the admin can compare against the realized off-ramp rate;
  - flagged/mismatched top-ups.
- **Weekly manual batch:**
  1. Admin selects the unconverted top-ups (default: all older than the cutoff) and records a batch.
  2. Off platform: NGN → USDT (exchange/OTC). Record `offramp_ref` and `usdt_amount`.
  3. USDT → the Celo treasury address (Safe). Record `celo_deposit_tx`.
  4. Buy G$ from the GoodDollar reserve with `@goodsdks/good-reserve` (**UNVERIFIED** package API and whether it works on Celo mainnet only) with `minReturn` set from a quoted amount minus tolerance. Record `gd_buy_tx`, `gd_received_wei`, `min_return_wei`.
  5. The batch row then stamps `batch_id` onto every covered top-up in one transaction, and the page shows realized vs credited USD per batch.
- The platform **never holds user private keys** (CLAUDE.md rule 8). Treasury transactions are signed by the admin's own wallet or Safe, outside the app, and only their hashes are logged.
- **Test mode:** Paystack test money isn't real, so no real batch can exist. In test mode the page works end to end with a fake batch (hashes are free text) and a banner "Test mode".

## 7. Keys and config
| Variable | Where | Notes |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | server only | `sk_test_…` now. Used for initialize, verify and the webhook HMAC. Never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | client | `pk_test_…`. Opens checkout only. |
| `ADMIN_WALLETS` | server | comma-separated lowercase addresses. |
| `TOPUP_SPREAD_BPS`, `TOPUP_MIN_NGN`, `TOPUP_MAX_NGN` | server | defaults per §4. |
The server refuses a live key (`sk_live_…`) unless `PAYSTACK_ALLOW_LIVE=true`, so test-only is enforced in code.

## 8. Failure and abuse cases
- **Duplicate/replayed webhook:** no-op (§3 step 4).
- **Amount or currency mismatch, unknown reference:** logged, `flagged`, no credit.
- **Webhook before our row commits:** the handler retries the lookup once, then returns 5xx so Paystack retries.
- **Chargebacks/disputes and reversed transfers:** post an `adjust` ledger entry for the credited amount. A balance may go negative; generation is blocked until topped up. The refund policy is open (§10).
- **Card testing/fraud:** per-user daily cap, rate limit on `POST /api/topups`, and a block when a user has several failed charges in an hour.
- **Rate spike between payment and credit:** the rate is read at credit time (webhook), snapshotted, never re-read.

## 9. Compliance and copy (UNVERIFIED legal points)
- Copy says "Buy GoodBuild credits". It never says "buy crypto", "G$", "tokens", "wallet funding" or "treasury". Receipts and the checkout description say "GoodBuild credits".
- Credits are prepaid usage: non-transferable, non-withdrawable, refunds per CREDITS.md §6.
- **Risks to check with counsel and Paystack before going live:** whether Nigerian rules on virtual-asset activity apply to a merchant whose treasury converts naira to crypto (the user flow doesn't, the backend does); whether Paystack's acceptable-use terms restrict merchants whose settlement is converted to crypto and what business description is accurate; and whether prepaid credits count as stored value. The brief's "Starter Business" limits (volumes, settlement) also need checking.
- D10 still applies: 18+, no US persons.

## 10. Open points for the user
1. **G$ in the UI: decided (D24).** "Never show G$" covers the top-up flow only: no conversion, batching or treasury details. The top-up modal shows NGN and USD credits. The credits pill keeps G$ beside USD (D13), and the G$ vault deposit stays.
2. **What the batch converts: decided (D24).** Keep about one month of provider bills in USDT (CREDITS.md §6) and convert only the surplus to G$.
3. **Rate source and spread (§4).** Which source, and what starting spread (proposal: 200 bps)?
4. **Fees:** merchant-bears (credit net of fee, as written) or customer-bears (user pays the fee on top)? The brief says minus fees.
5. **Email at top-up** for wallet-only users (§2): collect it on the top-up row, OK?
6. **Admin identity:** a wallet allowlist is the proposal. Anything else (2FA, a second signer for batches)?
7. **Refund/chargeback policy** (§8, CREDITS.md §6, Q22).

## 11. Build plan (after review)
1. Ledger and balances (CREDITS.md §3), reservation and preflight: M6 core.
2. `topups`/`fx_rates`/`treasury_batches` + `POST /api/topups`, webhook, reconciliation, with tests for signature, idempotency, mismatch and replay.
3. Top-up modal, credits pill and low-credit card (USD/NGN only).
4. Admin page and `pnpm treasury:report`.
