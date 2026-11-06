# App data: a backend for generated apps

Published apps can save data for their visitors, who sign in with their wallet. Decision: D31, which changes D3. Code: `src/server/app-data/`, `src/server/db/app-data-schema.ts`, `src/app/app-data/`, `src/lib/app-data.ts` and, in generated apps, `src/lib/db.ts`, `src/lib/useDb.ts` and `src/lib/dataRules.json`.

## How it works
```
<slug>.goodbuildit.xyz/__gb/data/v1/...
  → proxy.ts: region check (451), then rewrite to /app-data/<slug>/... (404 on the main host)
  → handler: Host must match the slug, the page must be this app, the app must be live
  → host → slug → publication → project_id, and only then the database
```
The app calls its own host, so there's no CORS at all and each app's cookie stays on its own address.

## The three ids
| Id | What it is | What protects it |
|---|---|---|
| `project_id` | The tenant. Every row carries it, and it's the only key that decides whose data a row is. | Never read from a request. It comes from the Host, through the slug. The slug can change, so rows don't use it: a later owner of an old slug starts empty. |
| `client_id` | A public id for the app (`gbc_...`), one per project, in the published page's `<meta name="goodbuild-data">`. Stays the same if the slug changes. | **Nothing, and it protects nothing.** Anyone can read it. A wrong one gets 403, which only catches a build talking to the wrong app. A right one grants nothing. Its uses: telling the helper it's on a published host and not in the preview, and a stable name for support and for any future caller outside the app's host. |
| `wallet_address` | The visitor, in lowercase. | Only ever taken from the session, which only a signature can create. It's part of the record's primary key, so a write can't land on someone else's record. |

Rows don't store `client_id`: it maps one-to-one to the project, so a second copy could only drift. If a project ever has several clients, that's a new table.

## Sign-in
Sign-In with Ethereum (EIP-4361), reusing `verifySignIn` from the main site:
1. `GET session/nonce` returns a random nonce stored in the database for this project, good for 5 minutes, and the domain to sign.
2. The wallet signs. No transaction, no gas.
3. `POST session` checks, in order: the nonce is this app's, unused and unexpired (before any signature work); the message's domain, which comes from configuration and the checked slug, never a header; its chain (Celo or Celo Sepolia); its age; the signature; the URI's origin. Then it marks the nonce used in one atomic update, so one nonce gives at most one session however many requests race.

The session is a random 32-byte token in an httpOnly cookie, `__Host-gbapp_session` in production: SameSite=Strict, no Domain, 7 days. Only its SHA-256 is stored. It's looked up together with the project, so another app's cookie is simply not a session here. It has nothing to do with `gb_session`: a different cookie, a different table and no shared secret.

**Smart accounts:** ERC-1271 and ERC-6492 signatures work through the check `verifySignIn` already has, on Celo and Celo Sepolia. It makes an RPC call, so it runs only after the nonce check and under the sign-in rate limit. Checked with a stand-in for the chain call; UNVERIFIED with a real smart account.

## Who can read and write
Rules come from `src/lib/dataRules.json` in the project. The agent writes them for each app (D34). They're validated by the agent's checks and when publishing, and saved with the publication. Nothing in a request can change them.

A rule is `"private"`, `"public-read"`, or an object:

| Setting | Values | Default |
|---|---|---|
| `create` | `anyone` (no sign-in: forms sent to the owner), `signed-in` (wallet), `owner` | `signed-in` |
| `read` | any of `anyone`, `signed-in`, `writer`, `owner` | `["writer"]` |
| `update` | `["writer"]` or `[]` (can't be edited once sent) | `["writer"]` |
| `delete` | `writer` and/or `owner` | `["writer"]` |
| `public` | fields everyone sees, without who wrote the record | none |
| `fields` | allowed fields and their types (`string`, `number`, `boolean`) | any JSON |
| `unique` | fields no two records may share; must also be public | none |

`private` is `{"read": ["writer"]}` and `public-read` is `{"read": ["anyone"]}`, exactly as before D34.

- **Owner** is the wallet that owns the project on GoodBuild, looked up by the server. The app can't name anyone else. The owner reads what visitors sent in GoodBuild's Backend window (signed in to GoodBuild, so email wallets work), and in the app itself when signed in with that wallet.
- **Visitors who don't sign in** get a random id of their own (`anon:<uuid>`), held through an app-scoped session cookie whose secret is separate from the id. They see what they sent from that browser. Their entries don't merge into an account if they later sign in. They can't satisfy `signed-in`.
- **Saved grants:** each record stores who could read it when it was saved (`access`). A reader must pass both that grant and the rule now, so loosening a rule never exposes older records, and tightening one applies at once. Records saved before D34 have no grant: they follow `is_public`, otherwise only their writer reads them, even where the owner now reads.
- **Public fields never name the writer.** The `owner` filter and lookups by writer only match records the viewer sees in full.
- **Unique values** are checked under the project's write lock, so two bookings of one slot can't both succeed. A refused duplicate shows the value exists, which is why unique fields must be public.
- **Abuse:** writes without sign-in are limited to 10 a minute per IP and 60 a minute per app, and to 2,000 records per app (`maxAnonRowsPerProject`), well below the app's 20,000. The owner can delete any entry from the Backend window, whatever the rules say.
- Two visitors using the same key get two records. There are no shared records, by design. The owner can't edit visitors' records yet.

**What `private` doesn't mean:**
- The app's own code runs on the same origin, so while a visitor is signed in it can read their records and send them anywhere its CSP allows (any https address). Private means private from other wallets, not from the app.
- The app's creator can't read private records through GoodBuild, only collections whose rule lists `owner`, but GoodBuild's operators can, because they run the database.
- It isn't encrypted beyond whatever the server's disk does. UNVERIFIED: whether the VPS disk is encrypted.

## Other apps in the same browser
Published apps are same-site with each other, so the browser sends a visitor's cookie with requests from another app's page, whatever SameSite says. So the data routes refuse any request whose `Sec-Fetch-Site` or `Origin` shows it came from another page, require `application/json` on writes, and never send a CORS header.

**A limit this can't fix:** any page can ask a wallet to sign any text, including a sign-in message for another app. Wallets show the domain and some warn on a mismatch, but a visitor who signs anyway has handed over a session for that app. The main site's own sign-in has the same limit. A separate registrable domain for apps wouldn't change this one.

## Limits
Set in `src/server/app-data/limits.ts`.

| | |
|---|---|
| Value | 16 KB of JSON |
| Per wallet, per app | 1,000 records, 2 MB |
| Per app | 20,000 records, 20 MB |
| Whole site | 1 GB (`APP_DATA_MAX_TOTAL_BYTES`), checked against a total at most a minute old, so it can overshoot slightly |
| Reads | 300 a minute per IP |
| Writes | 120 a minute per IP, 60 per wallet per app |
| Per app, all requests | 1,500 a minute |
| Sign-in | 30 nonces a minute per IP, 300 per app, 20 sign-ins per IP |

Quotas use running totals, updated in the same transaction as the record under a per-project row lock, so parallel writes can't overshoot. Over a quota is 507 with a message a person can read, and over a rate limit is 429 with `Retry-After`.

Rate limits are per process, in memory. Production runs one web process, so they're exact there. They reset on restart. IPs come from `cf-connecting-ip`, which is trustworthy only because the firewall lets only Cloudflare reach the server (DEPLOY.md).

Fresh wallets are free, so the per-wallet limit alone doesn't stop one person filling an app. The per-IP write rate and the per-app total are what bound that.

## The preview
The preview runs on a CodeSandbox origin, and the app has no host before it's published. Calling the real API from there would mean opening CORS and losing per-app cookies, so it doesn't. With no `goodbuild-data` tag on the page, `db.ts` uses a stand-in with the same API and the same rules, in that browser's localStorage. Sign-in asks for no signature, and a small note on the page says the data stays in the browser. **Preview data never reaches the real store, and published data never appears in the preview.**

## Deleting data
| What happens | Effect on saved data |
|---|---|
| A visitor uses `deleteMyData()` | Their records and sessions in that app go at once |
| The owner uses Delete all in the publish modal (`DELETE /api/projects/<id>/app-data`) | All of that app's records and sessions go at once. The owner sees totals only, never the data |
| Unpublish | The API stops. Data stays, and comes back if the app is published again |
| Takedown (`scripts/takedown.mjs <slug>`) | The API stops. Data stays, for review |
| Takedown with `--purge-data` | Data and sessions go at once |
| A project row is deleted | Everything goes with it (foreign keys). There's no delete-project feature in the product yet |

Nightly backups keep deleted data for up to 7 days (DEPLOY.md). Nothing expires by itself: data stays until one of the above happens.

## Known limits
- **Wallets in published apps are injected only** (MetaMask, MiniPay and the like). WalletConnect and Magic email wallets aren't available on an app host, as was already true for contract calls there. So an owner with an email wallet can't sign in to their own app.
- No queries beyond listing a collection newest first, optionally by owner. No shared records, files or images.
- **UNVERIFIED:** the helper in the real Sandpack preview. It was run in Chromium on another origin with no server and no `goodbuild-data` tag, which is the same code path, but CodeSandbox's bundler wasn't part of that, so its handling of the JSON import is unchecked.
- **UNVERIFIED:** Cloudflare passing `/__gb/data/` unchanged and not caching it. Every response says `no-store, private`, and nothing about this path has been tried on the live server.
- Postgres row-level security isn't used. The app has one database role, so isolation rests on every query in `store.ts` taking the project from the handler.

## How it's tested
- `src/server/app-data/attack.test.ts`: the attacker's suite, written first. It goes through the real proxy and handler, on PGlite, with real signatures.
- `scripts/app-data-e2e.ts`: a production build on Postgres, through the real publish API, and with Playwright through the real page and helper in Chromium. Usage is at the top of the file. It's for a throwaway database only.
