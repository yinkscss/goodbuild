# GoodDollar AI credits (AntSeed) — research for GoodBuild

Researched 4 Nov 2026 by Grok Bot. Sources pinned to antseed-integration commit `e8c46a8` (3 Nov 2026). **UNVERIFIED** marks anything not confirmed from a source.

## 1. What it is and status
- Users pay G$ on Celo; a Cloudflare Worker turns vault events into USD-denominated credits and funds an **AntSeed buyer deposit (USDC) on Base** ([README](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/README.md)).
- AntSeed is a P2P AI network. Its local buyer proxy serves an **OpenAI- and Anthropic-compatible API** on `http://localhost:8377`, with no API keys ([AntSeed: Using the API](https://antseed.com/docs/guides/using-the-api)).
- **Live:** Celo vault, Base operator and Worker. `GET /health` returned `{"ok":true,...,"bridgeEnabled":true}` on 4 Nov 2026 at `https://gooddollar-antseed-integration.goodworker.workers.dev` (URL from [GoodSkills](https://github.com/GoodDollar/GoodSkills/blob/main/skills/gooddollar/references/guides/antseed-ai-credits.md)).
- **Not yet implemented** in the GoodDollar Worker: "wallet-signature auth, `gd_live_...` API key issuance, AI request proxying, and request-level reserve/settle lifecycle" ([PAYMENT_FLOW](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/docs/PAYMENT_FLOW.md)). `POST /v1/chat/completions` on the Worker returned 404 (checked 4 Nov 2026).
- So today, credits get spent only through the **AntSeed buyer proxy or gateway**, run with the buyer private key ([buyer setup](https://github.com/GoodDollar/GoodSkills/blob/main/skills/gooddollar/references/guides/antseed-buyer-setup.md)).
- Open issues: [#27](https://github.com/GoodDollar/antseed-integration/issues/27) (stream credit accounting wrong), [#33](https://github.com/GoodDollar/antseed-integration/issues/33) (code audit), [#22](https://github.com/GoodDollar/antseed-integration/issues/22)/[#23](https://github.com/GoodDollar/antseed-integration/issues/23) (operator reset/guard).
- aicredits.gooddollar.org returned a Cloudflare challenge to our fetch, so its content is UNVERIFIED. No docs.gooddollar.org page on AI credits was checked (UNVERIFIED).

## 2. Architecture
```text
G$ on Celo -> CeloGdAntSeedVault -> Worker verifies tx -> credit balance -> AntSeed buyer deposit funded
```
(quoted from [USER_GUIDE](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/docs/USER_GUIDE.md))

| Item | Address | Source |
|---|---|---|
| CeloGdAntSeedVault (Celo proxy) | `0x4Dd0136b9aabD5823cf0F65d89e8fB882C660885` | [deploy-celo-output.json](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/deploy-celo-output.json) |
| AntseedBuyerOperator (Base proxy) | `0x192288D921045aa96903e5286E116960e5fb4607` | [deploy-base-output.json](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/deploy-base-output.json) |
| GoodID (Celo) | `0xC361A6E67822a0EDc17D899227dd9FC50BD62F42` | [wrangler.toml](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/backend/wrangler.toml) |
| G$ SuperToken (Celo) | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` | wrangler.toml |
| AntSeed channels (Base) | `0xba66d3b4fbcf472f6f11d6f9f96aace96516f09d` | wrangler.toml |

- **Deposit:** `transferAndCall(vault, amount, abi.encode(buyer))` (ERC677/667/777), or `approve` plus `deposit(amount, abi.encode(buyer))`. A missing buyer reverts with `MissingBuyerAddress`. Then call `POST /v1/celo/events/record {txHash}` ([USER_GUIDE](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/docs/USER_GUIDE.md)).
- **Stream:** a Superfluid CFA to the vault with `userData = abi.encode(buyer)`. Stream credits are issued **only by the 6-hourly cron**, with a 24-hour cooldown per account (USER_GUIDE; commit [420ad46](https://github.com/GoodDollar/antseed-integration/commit/420ad46)).
- **Bonus (GoodID-verified only, via `getWhitelistedRoot`):** +10% on deposits, +20% on streams. The monthly cap per GoodID root is `MAX_BONUS_CAP_USD` = 100. Unverified wallets can still deposit and get principal only ([credit-bonus.ts](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/backend/src/credit-bonus.ts), wrangler.toml). The face-verification step itself happens in GoodID; the Worker only checks for a whitelisted root.
- **Credit unit:** micro-USD in the backend. The widget shows 10,000 credits per USD ([GoodSkills](https://github.com/GoodDollar/GoodSkills/blob/main/skills/gooddollar/references/guides/antseed-ai-credits.md)). The G$ price comes from the reserve oracle, else `GD_CUSD_PRICE` = 0.00115. Formula: `total = principal + min(bonus, cap - used)`.
- **Funding:** `AntseedBuyerOperator.depositForWithId(buyer, principal, bonus, id)` calls `IAntseedDeposits.deposit(buyer, principal+bonus)`. Buyers can withdraw principal but not bonus with an EIP-712 signature ([PAYMENT_FLOW](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/docs/PAYMENT_FLOW.md)).
- **Consumption:** the AntSeed buyer proxy, holding the buyer key (`ANTSEED_IDENTITY_HEX`), reserves and settles payment channels against the Base deposit per request. A 402 `insufficient_deposits` error means the deposit is exhausted ([AntSeed](https://antseed.com/docs/guides/using-the-api)).

## 3. APIs, SDK and widget
Worker routes (from [worker.ts](https://github.com/GoodDollar/antseed-integration/blob/e8c46a8/backend/src/worker.ts)):
- `GET /health`, `/config/status`, `/config/values`, `/v1/analytics`
- `POST /v1/celo/events/record`
- `GET /v1/accounts/:a/{profile,credit-history,outstanding}`
- `POST /v1/accounts/:a/{operator-consent,operator-revoke,withdraw}`
- `/v1/channels/:id/{close,withdraw}`

There is no published SDK package for the Worker.

Widget ([GoodWidget ai-credits-widget](https://github.com/GoodDollar/GoodWidget/tree/main/packages/ai-credits-widget)):
```tsx
import { AiCreditsWidget } from '@goodwidget/ai-credits-widget'

<AiCreditsWidget provider={provider} backendUrl="https://your-ai-credits-backend.example" />
```
The widget also ships a custom element (`@goodwidget/ai-credits-widget/register` registers `<ai-credits-widget>`). It needs EIP-1193 `personal_sign`, because it derives the **buyer key from a payer signature**, and `eth_sendTransaction`. Its flow is buyer key, then EIP-712 `SetOperator` consent, then pay, then poll ([GoodSkills](https://github.com/GoodDollar/GoodSkills/blob/main/skills/gooddollar/references/guides/antseed-ai-credits.md)).

Spending, quoted from [AntSeed](https://antseed.com/docs/guides/using-the-api):
```bash
npm install -g @antseed/cli
antseed buyer start
curl http://localhost:8377/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model": "<peerId>@deepseek-v4-flash", "messages": [{"role": "user", "content": "Hello"}]}'
```
- **Models** are a dynamic, network-wide catalog (`GET /v1/models`). The docs give examples such as `deepseek-v4-flash`, `kimi-k2.6` and `gpt-oss-120b`, and GoodSkills shows `claude-sonnet-4-6`. Whether any given model is available is UNVERIFIED.
- **Pricing** is set per seller (the `x-antseed-*-usd-per-million` headers). There is no fixed price list.
- **Routing:** an unpinned model name routes to the cheapest seller that meets your trust threshold, with failover.
- The **AntSeed gateway** (`antseed gateway start`) adds API keys, spend limits and logs, and can serve several buyer identities through the `x-antseed-buyer-identity` header ([AntSeed](https://antseed.com/docs/guides/using-the-api)).

## 4. Integration plan for GoodBuild (proposed)
1. The user deposits or streams G$ through the embedded `AiCreditsWidget` (backendUrl = the GoodDollar Worker). We show the balance from `/v1/accounts/:a/profile`.
2. **The buyer key is the problem.** Credits fund the buyer address, and the widget gives the buyer key to the user. For GoodBuild's server-side agent to spend those credits, the server needs that key, or GoodDollar's planned `gd_live_` keys and proxy. Option A (now): the user hands the derived buyer key to GoodBuild, and a server-side AntSeed **gateway** holds it, one identity per user, with a gateway API key and spend limit per user. This is custody-sensitive. Option B (later): wait for GoodDollar's Worker proxy and API keys.
3. **LiteLLM:** add the gateway as an OpenAI-compatible provider (`openai/<model>`, `api_base=https://<gateway>/v1`, api_key = gateway key). Keep direct providers (Anthropic, OpenAI, Gemini, DeepSeek) as LiteLLM fallbacks when the credits run out (402) or a model is missing (502 `model_not_found`). LiteLLM config details are UNVERIFIED until tested.
4. **Metering:** read `x-antseed-estimated-cost-usd` per call. Use `antseed buyer metering` for authoritative totals.

## 5. Gaps and blockers
- No hosted inference API or API keys from GoodDollar yet ("not yet implemented").
- Spending requires running the AntSeed buyer or gateway ourselves, holding user buyer keys, on Base.
- Pins to a peer, seller trust and model quality vary. Licensing of models resold on AntSeed (for example Claude) is unclear; see D9.
- Open accounting bug #27 and an audit (#33) are pending. The minimum deposit and the US-persons restriction (D10) are unclear.

## 6. Questions for the GoodDollar team
1. Timeline and spec for `/v1/auth/*`, `gd_live_` keys and the `/v1/chat/completions` proxy?
2. Can an app (GoodBuild) spend a user's credits without holding the buyer private key, for example through a delegated operator or app-level buyer?
3. Is a hosted gateway or recommended seller list planned? Which models are guaranteed?
4. Is the Worker URL above the production endpoint, and is there a testnet deployment?
5. Status of #27, #33 and buyer minimums (commit e8c46a8)?
6. Can bonus credits be spent by third-party apps? What are the ToS for reselling inference?
