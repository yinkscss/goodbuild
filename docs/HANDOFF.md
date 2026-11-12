# Handoff: Stage 1 build status

Written 4 Nov 2026 at the end of the first build session (claude.ai), for whoever continues in Claude Code. Read CLAUDE.md and docs/BUILD_PROMPT_STAGE1.md first; this file only covers where things stand.

## GitHub sync (11 Nov 2026, D96, branch `claude/nice-mayer-dlol5t`)
A GitHub logo in the workspace top bar and a Settings → GitHub tab. Connect once (OAuth, `public_repo`), then one tap creates a public repo for the app and pushes it to `main`; every new version (turn, revert, network switch) is pushed after that. One way, never a force push: if `main` has commits GoodBuild didn't write, sync pauses and the person chooses to replace. Design and limits: D96. **Needs the owner:** create a GitHub OAuth App (callback `https://goodbuildit.xyz/api/github/callback`) and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env.production`, then `up -d web worker`; run migration 0017. **UNVERIFIED:** everything against real GitHub (tests use a mocked `fetch`).

## Hackathon page (12 Nov 2026, D98, branch `claude/nifty-einstein-da5v5l`)
A public page at `/hackathon` for the 1,000,000 G$ hackathon. Registration reuses sign-in and GoodDollar verification, then claims 20 credits, plus 30 after a first Celo deploy, one grant per GoodDollar root (D99). Migration 0018 runs with the deploy. Details: [HACKATHON.md](HACKATHON.md).

## Start here (5 Nov 2026)
**Live:** https://goodbuildit.xyz, on one VPS with Cloudflare in front. How it runs, how to reach it and what not to break: [DEPLOY.md](DEPLOY.md). Merging a PR to `main` deploys it, so every merge is a release.

**Working live:** email sign-in (Magic), a real AI build, deploying from an email wallet on Celo Sepolia with a Sourcify match (the fix was Magic's content security policy, see DEPLOY.md; the explicit gas in PR #11 wasn't what solved it), publishing to `<slug>.goodbuildit.xyz`, the firewall, and auto-deploy. Testnet only; mainnet is off.

**App data (D31, merged in PR #19 and deployed by the workflow on 5 Nov 2026; not yet exercised on the live site):** published apps can save data for their visitors, and since D34 (PR #28) the builder writes each app's rules, forms work without a wallet, and owners read what visitors send in the Backend window. Design, limits and what isn't verified: [APP_DATA.md](APP_DATA.md).

**Template gallery (8 Nov 2026, D60, PR on branch `claude/templates-gallery-d7e5db`):** 41 landing-page templates with real screenshots, one click builds from a server-side brief. Design, licences and open items: [TEMPLATES.md](TEMPLATES.md). **UNVERIFIED:** a real AI build from a template (no provider keys or Magic key were available in the build session); the brief reaching the model and the click-to-sign-in path are tested.

**Run check (9 Nov 2026, D67, branch `claude/web-builder-harness-review-2a9263`):** every build is opened in a headless browser on the server, and crashes go to auto-fix. Measured on the production server in throwaway containers. **UNVERIFIED:** a real AI build with it on, and the `checker` compose service itself. After the first deploy, run `docker compose --env-file .env.production ps checker` and look for `run check:` lines in the worker's log.

**Audit and design kit (10 Nov 2026, D84 to D86, branch `claude/vigilant-curie-5siryg`):** a sweep of the builder, kits, preview and flow is in [AUDIT_2026-11-10.md](AUDIT_2026-11-10.md), with a ranked list of what to do next. The same branch adds a motion kit for generated apps, a `visual-design` guide, fixes to the 2D and 3D game kits, and a run check that plays 3D scenes. **UNVERIFIED** with a real model. **Needs the owner:** run the eval baseline first (see the Eval suite line below), then again on this branch; and read D84 on React Bits' licence.

**OKX Wallet (11 Nov 2026, D92, branch `claude/gallant-goldberg-ifeweb`):** OKX Wallet is a tile in GoodBuild's sign-in and a choice in every generated app's wallet list (the extension, through `window.okxwallet`; the OKX app's own browser is expected to work the same way, which is inferred from OKX's docs, not documented), plus an iOS row for the OKX app in the phone WalletConnect list. Apps pick it up at their next build or publish. **UNVERIFIED** on a real OKX extension, the OKX app and real phones; the unknowns are listed in D92, including whether OKX shows in sign-in's own WalletConnect modal. **Needs the owner:** the support-page D89, the badge-toggle D90 and the support-mail D91 are missing from DECISIONS.md after a merge, and main has since reused D90 and D91 for other decisions; see D92.

**Open stats (11 Nov 2026, D91):** a public page at `/stats` (users, sign-ups, builds, live apps, contracts and transactions on Celo mainnet, with Celoscan links) and the same data at `/stats.json`. Counts only, no money. **UNVERIFIED** on the live site: after the deploy, open `/stats` signed out and check one contract link against Celoscan.

**Ten more UI pieces (11 Nov 2026, D89):** dialog, sheet, tabs, select, dropdown menu, tooltip, toast, accordion, avatar and switch are in every generated app, with a `ui-components` guide. Dialog and sheet are the browser's own `<dialog>`; select is the browser's own `<select>`. Checked on 11 Nov 2026 in the Sandpack preview, on an emulated phone, against the browser's accessibility tree, and in five real DeepSeek builds that all used the right pieces first try (D89). **UNVERIFIED** on a real phone, in MiniPay and with a real screen reader.

**The review (10 Nov 2026, D87, same branch):** after a build passes its checks, the strong model looks at screenshots of it on a phone and a computer and the build model fixes what it lists, once. **Off by default.** To try it: run Actions → Evals with `visual_review` ticked and compare with a run without; to turn it on, set `VISUAL_REVIEW=1` in `.env.production` and run `up -d worker`, then look for `review:` lines in the worker's log. **UNVERIFIED** with a real model.

**MiniPay for games (11 Nov 2026, D88):** a game's plan now asks whether it should work inside MiniPay, and Yes turns the MiniPay kit on, which now has a checklist of every MiniPay requirement. The chat then shows step cards for deploying, publishing and opening the game in MiniPay's developer mode (owner's pick, option A; see `/dev/preview?minipay=ready`). **UNVERIFIED** with a real model and in the real MiniPay app.

**Game shop and extras (11 Nov 2026, D95):** games that sell things get a tested G$ shop contract (`GameShop.sol`: cars and skins, level ups and packs, a season pass) with `useShop` and a `Store`, and the owner puts the items on sale with one button after deploying. Every game gets extras (near misses and combos, coins, daily missions and season tiers, a daily course, a ghost, sharing) and an on-game game-over panel with the top three. G$ inside MiniPay was tested on a phone by the owner. **UNVERIFIED:** a real model, and the owner's setup on a deployed `GameShop`.

**Games are played and tested (11 Nov 2026, D94):** building blocks in every game (spawning, NPCs, power-ups, a score panel, vibration), and a game probe the run check reads while a bot plays for about 7 seconds at 4x speed. It reports a score that never rises, no obstacle in 3 seconds, a declared kind that never appears, controls that do nothing, a game that never gets harder, and a broken Play again. It then posts a score with a stand-in wallet and opens the game as MiniPay. **UNVERIFIED** with a real model and on the production checker: watch the `run check:` lines for games, which can take up to 50 seconds.

**Games right first time (11 Nov 2026, D93):** start screens are drawn (`onIdleFrame`), the leaderboard is a kit (one free signature in a browser, a small contract inside MiniPay), saved-data reads clamp to 100, the run check looks at the start screen, and a game's plan asks about obstacles, power-ups and characters and shows a game pitch. **UNVERIFIED** with a real model, a published app and real MiniPay. Plan for the rest: [GAMES_PLAN.md](GAMES_PLAN.md).

**Games (10 Nov 2026, D71 and D72):** GoodBuild can build 2D games through the first kit, `game-2d`. **UNVERIFIED** with a real model and on a real phone. **Owner to confirm:** games of chance for money are still refused (D72).

**Blog and search visibility (10 Nov 2026, D83, branch `worktree-blog-seo-50`):** 50 posts at `/blog`, plus sitemap, robots (AI crawlers named), `/llms.txt`, `/llms-full.txt` and RSS. Details and owner steps: [BLOG.md](BLOG.md). **UNVERIFIED:** rankings, and whether Cloudflare's AI-bot blocking overrides `robots.txt`.

**Eval suite (10 Nov 2026, D70):** twenty real builds, scored, on demand in CI ([evals/SUITE.md](evals/SUITE.md)). **Needs the owner:** add `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` as GitHub repository secrets, then run Actions → Evals once with `update_baseline` ticked and commit the baseline. Until then it has never run with real models.

**Own-build preview (10 Nov 2026, D69, branch `claude/own-build-preview`):** the workspace falls back to GoodBuild's own build when Sandpack fails, and uses it for heavy projects once those exist. Checked locally with `scripts/preview-e2e.mjs`. **UNVERIFIED on the live site.** After the deploy, open a project with `?preview=own` on its address: the app should appear in the same frame. `?preview=auto` goes back to normal.

**Type check and run_checks (9 Nov 2026, D68, branch `claude/type-check-run-checks`):** TypeScript over each app, on `warn` (noted in the log, not blocking), and a `run_checks` tool for the builder. **UNVERIFIED:** any real AI build. After a day of real builds, read the `type check:` lines in the worker's log and decide whether to set `TYPE_CHECK=enforce`.

**Seen on the server on 9 Nov 2026:** the `worker` container exited with code 0 and no log line every 41 to 47 minutes (5 starts between 18:34 and 21:30 UTC) and Docker restarted it. PR #60 (merged) keeps the idle poll timer alive so the process no longer ends. **UNVERIFIED** on the server: check `docker inspect goodbuild-worker-1 --format '{{.RestartCount}}'` stays at 0 an hour after a deploy.

**Launch plan (6 Nov 2026, D37 to D43):** M6 and mainnet ship together. [MAINNET_PLAN.md](MAINNET_PLAN.md) replaces the order below, and notes what here is out of date.

**Next: M6**, in this order, with design in [CREDITS.md](CREDITS.md) and [TOPUPS.md](TOPUPS.md):
1. GoodDollar face verification. Read `getWhitelistedRoot` on Celo mainnet (`0xC361…2F42`) with plain viem on the server, even for testnet apps, because the SDK has no Celo Sepolia. Key allowances by root, not wallet. Don't trust the callback: re-read the chain. Verification expires. Use redirect mode on phones. No testnet exists, so a real verified wallet is needed for the live test.
2. Ledger and balances, and the credits pill. The $0.20 cap (D28, `src/server/credits/cap.ts`) currently sums `usage_events`.
3. Paystack in test mode, then the admin treasury page. Exempt the signed webhook from the region block.

**Waiting on the owner before M6 can finish:**
- The verified allowance (Claude suggested $2 once).
- A daily budget for free usage and a per-IP sign-up limit (Claude suggested $5 a day and 3 accounts a day). New wallets are free, so the cap alone doesn't limit total spend.
- Whether M6 is prepaid credits or subscriptions. It's designed as prepaid.
- TOPUPS.md §10 points 3 to 7, including the refund policy. Paystack test keys.
- Whether the owner's wallet is exempt from the cap, and a wallet already verified with GoodDollar for testing.
- Whether GoodDollar requires approval for third-party use of face verification. Its docs don't say.

### Wallets in generated apps (D36, on branch `feat/app-wallet-connect`)
Published apps now show a wallet list (every browser wallet, WalletConnect by QR code or phone link) and MiniPay connects by itself. Design: DECISIONS.md D36.

**Needs the owner:** a real `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in production's `.env.production`. The server reads it when an app is published, so the file matters, not the Docker build argument. Without it, published apps have no WalletConnect and everything else works. Apps already published need republishing to get any of this.

**Checked:** `scripts/wallet-e2e.ts` on a local production build, with a fake project id, stand-in wallets, a mocked Celo RPC and `MOCK_RELAY=1` (the script answers the relay socket). So the pairing link is made by WalletConnect's real code, but no relay or wallet took part.

**UNVERIFIED, try these by hand once the id is set:**
1. Computer: Connect wallet, WalletConnect, scan the QR code with a phone wallet. It should connect, then sign in and send a contract write.
2. Reload: it should reconnect without asking.
3. Phone in Chrome or Safari: try each wallet button (MetaMask, Valora, Trust Wallet, Rainbow, Other wallet, and OKX Wallet on an iPhone, D92). The link formats are from memory of each wallet's universal link, not tested. Check the wallet app comes forward for each signature, and that coming back to the page works.
4. Real MetaMask with a second extension installed: the list shows both, and the one you pick is the one asked.
5. MiniPay: open a published app inside it. It should connect with no list.
6. Reown's dashboard: whether its allowed-domains list accepts every `*.goodbuildit.xyz` host, and what Verify shows wallets for a published app. Unknown until a real id is used.
7. OKX Wallet (D92): with the OKX extension, and inside the OKX app's browser (that it injects `window.okxwallet` there is inferred, not documented), open a published app, pick OKX Wallet, connect, and send a contract write on Celo Sepolia. Celo isn't in OKX's default chain list, so watch the add-network step. Then reload: it should reconnect without asking. On GoodBuild's own sign-in, try OKX the same way, and try WalletConnect from the OKX app (it may not be listed in Reown's modal).

### Plan first (D32)
A project's first message now asks questions before building. The chat no longer shows the build log or file chips. Tried with the demo model only: real model question quality is **UNVERIFIED**, because no real provider was called.

### Live Celo Sepolia test of redeploy warnings, the old-funds card and the proxy trial (6 Nov 2026)
**Setup.** A local production build of `main` at `ac40179f2`, using its own Postgres and the real Celo Sepolia network. Nothing touched goodbuildit.xyz.
- **Wallet:** the throwaway test wallet `0x80fB…07AD`, signed in with SIWE. A MetaMask-style provider was injected into Chromium (Playwright), and it signed in Node. Test G$ came from `faucet()` on `0xefcb…ee4a`.
- **Contracts:** written into `project_files` by SQL, with no AI builds: the plain and upgradeable Vaults from the tests.
- **Cost:** the whole run used about 0.31 test CELO (0.923 down to 0.610).
- **Screenshots:** [docs/testing/sepolia-2026-11-06/](testing/sepolia-2026-11-06/).

**A. Redeploy warnings (PR 16) and old funds (PR 18): all pass**

| Step | Result | Evidence |
|---|---|---|
| Deploy Vault v1 through the modal | Pass. One confirmation, Sourcify exact match | `0x86c18aa068229df68ef5a51b9831d8331e378a63`, tx `0xe49fd448…53bb6` |
| Deposit 200 test G$ | Pass | tx `0xf89ea2f4…5d73b` |
| Change the source: chat notice | Pass. "Vault doesn't have your latest contract changes yet." | `a3-outdated-notice.png` |
| Deploy modal warning | Pass. "The old Vault at 0x86c…8a63 keeps its 200 G$ and its history. Nothing moves across." | `a4-replaces-warning.png` |
| Deploy v2 | Pass. New address `0xe8a957e6c83999522607d66ba0fb77eb5f622b33`, tx `0x236a1758…453a2` | See the Sourcify bug below |
| Old-funds card | Pass. A calm card, "Vault 200 G$ … Move funds out, withdraw()" | `a6-funds-card.png` |
| Move funds out | Pass. +200 G$ back to the wallet, old contract at 0 | tx `0x7849434a…a840c`, `a7-funds-moved.png` |

**B. Proxy trial (PR 21, D33): every step passes except the two bugs below**

| HANDOFF step | Result | Evidence |
|---|---|---|
| 2. Turn on with plain contracts | Pass. "Not ready to be upgradeable" (the builder's conversion was done by SQL, because it needs AI) | `b2-not-ready.png` |
| 3. Deploy behind a proxy | Pass. Two confirmations (code, then proxy). Sourcify: "The code and its proxy both match" | Proxy `0x932FFcb743ba661EaDF863b797919E3a94504e2d`, implementation `0x4C68…E8B5`, ProxyAdmin `0x2CD3…C08D` |
| 4. Deposit 100 test G$ | Pass | tx `0x5024a0eb…78050` |
| 5. Explorer | Pass. Blockscout API: `proxy_type=eip1967`, implementation Vault, verified | |
| 6. Change the contract | Pass. The chat shows **Upgrade**, not "Deploy again", with no new-contract warning: "The address, funds and data stay the same." | `b6-chat-upgrade.png` |
| 7. Upgrade | Modal pass: "Sign & upgrade … keeps its funds and data", no replaces warning. On-chain pass: same address, 100 G$ and the deposit kept, the new `deposits()` works, the record moved to implementation `0xe12d…c636`, Sourcify matched. The modal itself stalled, so the transactions were sent from Node (see open item 3). | `b7-modal-upgrade.png`, code tx `0xee577a57…16302`, switch tx `0xe2f64f2c…817fe` |
| 8. Publish | Pass. "Built with GoodBuild · Unaudited · This contract can be changed" | `b8-published-label.png` |
| 9. Storage-breaking change | Pass, on a fresh proxy `0x8a2f…8e2d`. "We can't upgrade this safely. This change would scramble the data Vault has stored… Nothing was changed." Nothing was sent to the wallet. "Deploy as a new contract" shows the normal replaces notice. | `b9-refused.png`, `b9-as-new-contract.png` |
| 10. Stranger upgrade | Pass. A second funded wallet's `upgradeAndCall` reverted, in simulation and on-chain | Stranger `0x1e6f…503c` |
| 11. Lock | Pass. After `renounceOwnership` (sent from Node, not the "Lock it for good" button), prepare refuses with "Vault was locked, so it can't be changed any more", the modal says the same, and republishing removes the label | renounce tx `0xd1a6498b…1f4ed9`, `b11-locked-modal.png` |

**Bugs found**
1. **Recording a proxy deploy or an upgrade can fail right after it's mined.**
   - The record call returns `422 wrong_upgrade`, "The network says that proxy uses different code". That happened on the first two proxy deploys and on the upgrade.
   - The same transactions record fine 15 seconds to a few minutes later, and a third proxy deploy recorded on its first try.
   - Likely cause: `readProxy` (`src/server/deploy/upgradeable.ts`) reads the EIP-1967 slots at `latest`, and a forno node that hasn't seen the block yet returns zero.
   - Fix: read at the receipt's block, retry a few times, and treat a mismatch caught early as `pending`, not a hard error. Today the modal shows "Failed", even though both transactions succeeded.
2. **Sourcify verification can fail right after a deploy.**
   - Vault v2 got `failed`: "Cannot fetch bytecode for chain #11142220". Retrying through `POST …/deployments/<id>/verify` gave an exact match.
   - Fix: treat "Cannot fetch bytecode" as `pending` and retry, so the chip doesn't say "Not verified yet".

**Open items**
3. **In this harness, the modal's upgrade never got past "Checking on Celo…".**
   - The page's RPC `fetch` for the opcode probe never settled, not even on viem's 10-second timeout.
   - A plain `fetch` to forno from the same page, with the modal open, worked. The first proxy deploy from the modal worked in the same harness.
   - Not resolved. Check an upgrade once in a real browser with MetaMask before trusting the modal path.
4. **Not covered by this run:**
   - MetaMask's own screens
   - Magic email-wallet signing
   - the builder converting contracts to upgradeable (step 2 needs AI)
   - the "Lock it for good" button itself

### Upgradeable contracts trial (D33)
Proved in a local EVM with real compiled contracts (`src/server/deploy/upgradeable.evm.test.ts`), and on Celo Sepolia on 6 Nov 2026 (section above). Modal states: `/dev/preview?deploy=upgradeable|upgrade|upgrading|refused|not-ready|upgraded`.

**Fixed after the Celo Sepolia live test of 6 Nov 2026 (PR #25), in a local EVM and with fakes only:**
- Recording a proxy or an upgrade right after mining no longer gets `wrong_upgrade` from a lagging RPC node. The server reads the proxy at the transaction's own block, fetches the transaction after its receipt, and asks again with backoff for up to 15s. A real mismatch is still refused at once. If the node still hasn't caught up, the modal retries the save twice and then says "Sent, not saved yet" with Try again, which signs nothing new. It never says Failed for transactions that mined.
- Sourcify's "Cannot fetch bytecode" right after a deploy is now `pending`, never `failed`. The background check resubmits up to 3 times, 10s apart.
- The check before signing ("Checking on Celo…") gives up after 30s and offers Try again. In a Playwright repro, viem's own timeout did work: an RPC that never answers fails each call after about 41s (4 tries of 10s), and the opcode probe then moves on to the next call. So the live-test stall was most likely the harness's Node proxy for every RPC request plus those long retries. That isn't proven.
- **Still to check with MetaMask in a real browser:** one upgrade from the modal, the two new states above, and how forno answers a read at a block it doesn't have yet.

**Live test, on Celo Sepolia, with your own wallet and test CELO (about 10 minutes):**
1. Run the migration. Create a project with a small contract that holds G$, for example "a G$ savings jar where people deposit and withdraw". Let it build.
2. Click Deploy. In the modal set "Can be changed later" to Turn on. It should say the contracts aren't ready; click "Ask the builder to convert them" and wait for the build.
3. Deploy again. Expect two wallet confirmations per contract. Note the address. Check the chip: if it stays "Not verified yet", open the deployment's `verifyDetail` and record what Sourcify said.
4. In the app, claim test G$ and deposit some. Note the balance.
5. On Blockscout (or Celoscan), open the address. Record whether it shows as a proxy and what the code tab shows.
6. Ask the builder: "add a function that shows the total number of deposits". Expect the chat to say "Upgrade", not "Deploy again", with no "new contract" warning.
7. Upgrade. Expect two confirmations and the same address. Check your deposit and the G$ balance are still there, and the new feature works.
8. Publish. Expect "This contract can be changed" in the bar at the top of the published app. Use it there.
9. Refusal test: ask the builder "rename the deposits variable and change its type to uint128". If it pushes back, that's the agent's check doing its job. To see the deploy refusal, use Revert to go back to the version before step 6's change, then Deploy. If step 6 added a stored variable, expect "We can't upgrade this safely" with nothing sent to your wallet, and "Deploy as a new contract" should show the normal replaces notice. If it added no stored variable, the revert is a safe upgrade and goes through.
10. Attacker test: from a second wallet on the explorer, try `upgradeAndCall` on the ProxyAdmin. Expect a revert.
11. Lock: on the success screen use "Lock it so it can never change". Change the contract and try to upgrade. Expect a refusal saying it was locked. Publish again and the label should go.

**Worth recording:** whether Magic email wallets handle a transaction with `to` set (the first such thing GoodBuild sends from them besides the faucet), the real fees, and whether Sourcify matches both contracts.

### M5 gaps
**Wrong today:**
- The deploy success screen says addresses are in the Contract tab, but that tab doesn't show them.
- The ABI interaction panel (CONTRACTS_AND_DEPLOYMENT.md §5) isn't built.
- There's no deployment history in the UI (which version is active, older addresses).

**Built, not tested live:** MetaMask on the production site (it worked on a local build), WalletConnect, MiniPay, a multi-contract deploy, the `paris` rebuild, the test G$ faucet button, a transaction through a published app, and more than one build at a time.

**Left for later on purpose:** Celoscan verification (Sourcify works), paying fees in stablecoins, sponsored gas, a fee estimate that's only exact for the first argument-free contract, and mainnet.

**Launch and operations:**
- Auto-deploy runs the checks first and images can be rolled back (D45). There's no staging. The owner still has to turn on the branch rule and test a rollback once (`DEPLOY.md`).
- Backups live on the same server.
- The preview depends on CodeSandbox, which sometimes fails until Try again (Q36).
- New email wallets start with no CELO, so a newcomer has to find the faucet (Q12).
- The landing page shows sample metrics.
- `/terms` and `/privacy` are unreviewed drafts, and `NEXT_PUBLIC_CONTACT_EMAIL` isn't set.

## Done (all on `main`)
| Milestone | Commit | Notes |
|---|---|---|
| M1 Scaffold + landing | 37a5941 … 7e85449 | Tailwind v4 tokens (P6), self-hosted fonts (P7), hero uses `hero-b.jpg` with float/glow/tilt |
| M2 Auth + gating (Privy then; Magic since D22 on `m5-deploy`) | f1122d8 | Own SIWE session (P9), Drizzle + PGlite dev DB (P8), geo-block 451 |
| M3 Logged-in home | 37f17b1, 36307f4 | Contract-type tiles on cards; credits pill says "Testnet beta · free" until M6 |
| M4 Workspace + agent | 1d8d9bc | Vercel AI SDK (D14, D16, D18; LiteLLM removed), runner/checks/auto-fix/checkpoints, Sandpack (P12) |
| Pre-M5 fixes | 6efeeb9 | G$ = ERC-20 guardrails (D15), custom errors only, deduped summary, auto-fix step rows |

The user approved M1–M4 and the pre-M5 fixes.

Agent harness (P17, branch `claude/agent-harness-a8a600`, stacked on the output-quality PR):
- asset uploads with palette and vision descriptions;
- `search_code`, `find_symbol` and ranged `read_file`;
- a file manifest and selective context;
- rolling conversation memory;
- file-naming rules;
- deeper design guides;
- a lucide icon check.

Live results are in [evals/HARNESS.md](evals/HARNESS.md). Run new evals with `scripts/eval-harness.mjs`.

## D18 (replace LiteLLM with the Vercel AI SDK): DONE
Implemented on branch `claude/vercel-ai-sdk-migration-46c76e`: `aiSdkClient()` and `withFallback()` in `src/server/agent/model.ts`, `runner.ts` unchanged, LiteLLM files and `pnpm llm` removed. `deepseek-flash` verified as a model ID in `@ai-sdk/deepseek`. The brief below is kept for reference.

Scope:
1. `pnpm add ai @ai-sdk/anthropic @ai-sdk/deepseek` and `pnpm remove openai`. Versions seen on 4 Nov 2026: ai 7.0.162, @ai-sdk/anthropic 4.0.96, @ai-sdk/deepseek 3.0.79.
2. Rewrite `src/server/agent/model.ts` as `aiSdkClient()`, **keeping the `ModelClient` interface** (`stream(req) -> AsyncIterable<ModelEvent>`, `ModelEvent` = text / tool_call / usage / done, `ModelUnavailableError`) so `runner.ts` doesn't change. Replace the `openai` type imports with local types of the same shape:
   - `ChatMessage`: OpenAI-style `system` / `user` / `assistant {content, tool_calls:[{id, type:"function", function:{name, arguments}}]}` / `tool {tool_call_id, content}` (what the runner already builds).
   - `ToolSpec`: `{type:"function", function:{name, description, parameters}}` (`demo-model.ts` reads `t.function.name`).
3. Inside the client, convert to AI SDK v7 shapes:
   - System message: pass it as `system`, or as a `{role:"system"}` message with `allowSystemInMessages: true` (the default rejects system messages in `messages`).
   - Assistant tool calls become `{type:"tool-call", toolCallId, toolName, input}` parts (parse `arguments` JSON). Tool results become `{role:"tool", content:[{type:"tool-result", toolCallId, toolName, output:{type:"text", value}}]}` (look up `toolName` from the matching call).
   - Tools: `tool({ description, inputSchema: jsonSchema(parameters) })` with **no `execute`**, so the SDK returns the calls and the runner keeps doing the edits. streamText's default stop condition is one step, which is what we want.
   - Call `streamText({ model, system, messages, tools, maxOutputTokens: req.maxTokens, maxRetries: 1, abortSignal: req.signal })` and iterate `fullStream`:
     - `text-delta` (`part.text`) becomes `text`
     - `tool-call` (`toolCallId`, `toolName`, `input`) becomes `tool_call` with `arguments: JSON.stringify(input)`
     - `finish-step` (`usage.inputTokens`, `usage.outputTokens`, `usage.inputTokenDetails.cacheReadTokens`, `response.modelId`, `response.id`) becomes `usage`, with a unique `callId` (response id, or a generated id if missing)
     - `finish` becomes `done`, and `error` is thrown and mapped
   - Models: strong is `anthropic("claude-sonnet-5-5")`, cheap is `deepseek("deepseek-flash")`. **UNVERIFIED:** check that `@ai-sdk/deepseek` accepts `deepseek-flash` as a model ID, and what model name it reports back, so `model-pricing.ts` matches it.
   - Keep Anthropic prompt caching on the system prompt (`providerOptions.anthropic.cacheControl`), so cache-read pricing applies.
4. Fallback wrapper `withFallback(strong, cheap)`: a strong call that throws **before emitting any event** is retried once on cheap. Errors after output has streamed are rethrown, not replayed. Cheap-tier calls don't fall back.
5. Error mapping (`ModelUnavailableError`, plain words): a missing or invalid key (`LoadAPIKeyError`, `APICallError` with status 401 or 403) names `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY` in `.env.local` and says to restart `pnpm dev`. Network and 5xx errors say the provider is unreachable. Drop every `pnpm llm` mention, including `runner.test.ts:227`.
6. Billing: the usage event still goes through `recordUsage` and `costMicro` / `chargedMicro` (cost + 25%, D13). Update the comments in `src/config/model-pricing.ts` that mention LiteLLM.
7. `src/server/agent/index.ts`: `demoModel()` when `GOODBUILD_DEMO_MODEL=1`, otherwise `withFallback(aiSdkClient("strong"), aiSdkClient("cheap"))` or equivalent.
8. Tests: rewrite `model.test.ts` with the mock models from `ai/test` (`MockLanguageModelV2` or the current equivalent, plus `simulateReadableStream`). Cover the text and tool-call mapping, usage and callId, message conversion (tool results round-trip), fallback before output, no fallback after output, and the key-error message.
9. Delete `litellm/`, `scripts/llm-proxy.sh` and the `llm` script in package.json. Remove `LITELLM_*` from `.env.example` (keep `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GOODBUILD_DEMO_MODEL`).
10. Docs: README "AI builds" (no pip or proxy, just keys plus `pnpm dev`), AI_AGENT.md "Implementation (M4)" models line, ARCHITECTURE.md Models row and diagram, CREDITS.md §4 (option B now lives in our code), the Q34 note in OPEN_QUESTIONS.md, and the M4 row in this file.
11. `pnpm check` green, then commit (`D18: Vercel AI SDK replaces the LiteLLM proxy`) and push.

## M5 (compile + wallet-signed deploy): built on branch `m5-deploy`, awaiting review
Not merged. Code lives in its own modules so it doesn't collide with workspace work on `main`: `src/lib/deploy/`, `src/server/deploy/`, `src/components/deploy/`, `src/server/db/deploy-schema.ts`, and `src/app/api/projects/[id]/deploy*`.

What exists:
- **Deploy manifest (D23)**: the agent writes `contracts/deploy.json` (constructor args by parameter name, refs `${Name.address}`, `${GOODDOLLAR}`, `${DEPLOYER}`). `checkContracts` validates it in the normal auto-fix loop; `planManifest` sorts it topologically and fails on a cycle.
- **Compile for deploy** (`src/server/deploy/compile.ts`): cancun by default; `paris` fallback (D17) first with the current OpenZeppelin, then with the pinned **5.1.0** (`@openzeppelin/contracts-paris`, the newest 5.x without MCOPY) if a dependency needs Cancun. Returns bytecode, ABI and a Sourcify-ready standard JSON.
- **Simulation** (`src/lib/deploy/simulate.ts`): scans runtime code for post-Paris opcodes and asks the chain whether each exists (an `eth_call` with a state override), then `eth_estimateGas` on the creation. An opcode failure shows "Rebuild for older Celo", which re-runs prepare with `paris`.
- **Deploy run** (`src/lib/deploy/run.ts`): one wallet signature per contract in order, references filled from real addresses. Partial failure keeps finished contracts and "Try again" resumes: it never re-signs a finished contract, and a transaction already sent is picked up again rather than sent twice. Sent transactions are also kept in the browser (`src/lib/deploy/pending.ts`), so a reload or closed modal picks them up too. On another device they aren't known, and that deploy creates a new contract.
- **Reuse rule:** a contract counts as already deployed only for the same `.sol` sources, `contracts/deploy.json` and EVM target (`sourceKey`). When nothing is left to sign, the modal shows the live addresses.
- **Server record** (`recordDeployment`): reads the receipt and transaction itself (sender must be the session wallet, creation input must start with GoodBuild's compiled bytecode), then writes the `deployments` row (migration `0004_m5_deployments`) and the addresses into `src/contracts/<Name>.ts`. Rebuilds and reverts re-apply those addresses.
- **After a deploy:** the preview remounts when an address lands (`contractAddressKey`), the chat gets a "live at" note, and every later turn tells the agent what is deployed (`deploymentsBlock`). If no page reads any `<Name>Address`, a wiring turn is queued automatically (`contractsToWire`). A rebuild that changes a contract's ABI drops its old address until it is deployed again; a revert doesn't apply that check yet.
- **Verification**: Sourcify v2 (both Celo chains are in its live chain list), polled after the response; Celoscan later.
- **Deploy modal** per DESIGN_SYSTEM §4 (preview states at `/dev/preview?deploy=ready|replace|signing|second|opcode|failed|manifest|done`).
- **Test G$** (`scripts/solidity/goodbuild/TestGoodDollar.sol`, 18 decimals, ERC-677 `transferAndCall`, 1,000 per wallet per day faucet) plus `pnpm deploy:test-gd`.

**Needs you (nothing below could be done from this session):**
1. Open `/dev/test-gd` in development and deploy from your wallet (D24; get testnet CELO from the Celo Sepolia faucet), then set `NEXT_PUBLIC_TEST_GD_ADDRESS`. `pnpm deploy:test-gd` also works. Until then testnet deploys that use `${GOODDOLLAR}` stop with "no test G$ yet".
2. Magic dashboard: create the app, set `NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY` and `MAGIC_SECRET_KEY`, and allow `https://forno.celo.org` and `https://forno.celo-sepolia.celo-testnet.org` in its content security policy.
3. One real end-to-end deploy (email wallet, then MetaMask) on Sepolia. **Not verified live yet:** Magic's Celo Sepolia behaviour and confirmation UI, WalletConnect/MiniPay connection, whether Celo's RPC accepts state overrides (if not, only the creation estimate runs), and a real Sourcify match.

Known gaps: the fee estimate is exact for the first argument-free contract and scaled by size for the rest; mainnet deploys stay behind the runtime mainnet switch (D50, off by default; this line used to name `NEXT_PUBLIC_ENABLE_MAINNET`, which no longer exists).

`main` (through the background runner, P18) is merged into this branch. The M5 migration is now `0004`, after main's `0003`. A local `.data/` database that ran the old M5 `0003` needs resetting: it would try to create `deployments` again.

## Publish (P19), landing sections, /docs and preview pop-out
Publish code lives in `src/server/publish/`, `src/server/db/publish-schema.ts` (migration `0005`), `src/proxy.ts`, `src/lib/published-host.ts`, `src/app/published-app/` and `src/components/workspace/publish-modal.tsx`.

**Verified on a production build (5 Nov 2026), on `<slug>.localhost`, with a demo tip jar and no contract deployed:**
- API: publish (4s), update, unpublish (app returns 404), reserved and taken slugs refused, 451 on a blocked region.
- Isolation: no main API or `/home` on an app host, a session cookie gets nothing there, and the main host can't reach `/published-app`. Published apps are same-site with the main site, so the browser does send the session cookie on their requests to it. What protects the API is `isForeignWrite` in `src/proxy.ts`, which returns 403 for writes from another site or subdomain, plus CORS for reads. Before that check, a text/plain POST from an app host created a project as the signed-in user (reproduced on the server, 201).
- Browser: the app runs under its CSP with the demo notice, the modal publishes and unpublishes, and the pop-out preview loads.
- Sign-in with `__Host-` cookies, using an external wallet.

**To run it locally:** production mode with `PUBLISHED_APPS_DOMAIN=localhost`, `ALLOW_PGLITE=true`, `SESSION_SECRET` and `APP_DOMAIN`.

**Verified with a real deploy (5 Nov 2026):** a throwaway wallet deployed `TipJar` on Celo Sepolia at `0xAC81a96393eF4306E3885aC7868EBd6a0aAa7BEA` through the deploy modal on a production build on Postgres, with an exact Sourcify match. The preview went live with no reload, the chat got its "live at" note, and "Publish app" on the success screen published it with the address baked in and no demo notice. The test signer stood in for a browser wallet, so MetaMask's own UI wasn't part of this.

**Not verified:**
- A contract deploy from a Magic email wallet.
- A real host: `*.goodbuildit.xyz` needs wildcard DNS. Q16 and Q31 stay open.

**Running now (D27):** live at https://goodbuildit.xyz on one VPS, see [DEPLOY.md](DEPLOY.md). Tested live on 5 Nov 2026: a real AI build, a Celo Sepolia deploy with a Sourcify match, publishing, the firewall, and the workspace and preview in a browser. A test signer stood in for the wallet. Email sign-in with Magic works live (the owner signed in on 5 Nov 2026). Not tested live: a deploy from an email wallet (the first attempt had no CELO), and more than one build at a time. The rest of this section describes the Vercel and Railway setup (D26), which is on hold.

**Hosting (D26, amends D25):** Vercel serves pages and forwards `/api/*`, `/a/*` and published apps to Railway, which runs the `Dockerfile`, with Postgres alongside.

| | Vercel (edge) | Railway (backend) |
|---|---|---|
| Required | `BACKEND_ORIGIN`, `EDGE_SECRET`, `DATABASE_URL` (public), `DATABASE_POOL_MAX=2`, `SESSION_SECRET`, `APP_DOMAIN`, `PUBLISHED_APPS_DOMAIN` | `EDGE_SECRET`, `DATABASE_URL`, `SESSION_SECRET`, `APP_DOMAIN`, `PUBLISHED_APPS_DOMAIN`, `MAGIC_SECRET_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `NEXT_PUBLIC_TEST_GD_ADDRESS` |
| Build-time | every `NEXT_PUBLIC_*` value | the same, as Docker build arguments |

- `APP_DOMAIN=goodbuildit.xyz` and `PUBLISHED_APPS_DOMAIN=goodbuildit.xyz` on both, with the same `SESSION_SECRET`.
- Trial: one Railway service, using the inline worker. After upgrading: add a `pnpm worker` service and set `GOODBUILD_INLINE_WORKER=0` on web.
- Migrations: `pnpm db:migrate` before each deploy.
- `*.goodbuildit.xyz` needs Vercel's nameservers.
- Serverless and `output: standalone` can't compile contracts, because solc, OpenZeppelin imports and contract tests run in child processes that read `node_modules` directly. That's why this work is on Railway.
- Rehearsed locally (5 Nov 2026): the backend image capped at 1 GB behind a separate edge server. Sign-in, pages, compiling, publishing, the app host, the 451, the secret check and turn events all worked through the edge. Peak memory was 657 MiB with a first publish and compiles running together, with no out-of-memory kill. A full AI turn with contract tests wasn't part of that, and Vercel's own forwarding is still to be checked on the first deploy.
- Checked locally with Docker (5 Nov 2026): migrations, web and worker as separate containers, compiling with OpenZeppelin, publishing and serving an app, and the worker claiming a job (it then stopped at the AI call, because that test had no keys). Not yet run on Railway or Fly.
- Serverless and `output: standalone` can't compile contracts, because solc, OpenZeppelin imports and contract tests run in child processes that read `node_modules` directly.

**Publish's packages:** file tracing skips `node_modules` and pnpm's symlinks, so `pnpm build` first packs the runtime packages and Tailwind's stylesheets into `publish-runtime.pack.gz` (`scripts/build-publish-runtime.mjs`, about 22 MB), and the first publish unpacks it to the temp folder (`src/server/publish/runtime.ts`). Checked with `NEXT_OUTPUT=standalone pnpm build`, run outside the repo on Postgres. `PGlite` doesn't start in standalone output, and production doesn't use it. Don't set `HOSTNAME` to `127.0.0.1` on a standalone server: the route then sees the wrong Host and refuses to serve apps (`0.0.0.0` is fine).

**Other gaps:** `/terms` and `/privacy` are drafts that no lawyer has reviewed, and legal pages and `/report` need `NEXT_PUBLIC_CONTACT_EMAIL`. `scripts/takedown.mjs` takes a published app down. The Unpublish button uses `window.confirm`, which blocks browser automation. A self-reload of `/home` and the workspace under `next dev` was reported by the session that built this, and didn't reproduce here over 30s on each page without a Magic key.

Then M6 (credits, D13: USD primary, cost + 25%; usage is already recorded in `usage_events`). **Top-ups (D21) are designed in [TOPUPS.md](TOPUPS.md), waiting for your review: no code until then.**

## Credits v2 (D56, 8-9 Nov 2026)
Credits are bought with G$ against server-signed quotes; the contract has a fixed 10,000,000 supply and an admin who can withdraw. Code: `contracts/GoodBuildCredits.sol`, `src/server/credits/quote.ts`, `src/app/api/credits/quote`, `src/components/credits/add-credits.tsx`. **Contract deployed** at `0x800a4cb107f788fece1e7fa73aeeec1bce7e8c2f` (block 82304791); after this PR is live, set the two `CREDITS_*_42220` env vars (see DEPLOY.md). The templates gallery is not built (its session stopped at a usage limit, branch `claude/templates-gallery-d7e5db`).

## Open questions worth reading
Q36 (preview depends on CodeSandbox and the Tailwind CDN), Q37 (chat width), Q38 (read-only code tab), Q40 (top-ups) and Q41 (Magic) in OPEN_QUESTIONS.md. Q39 is resolved (D23).

## Test wallet
Throwaway wallet for live deploy tests, kept on purpose: `0x80fB54faA246dd4E75A000D88eC9BF2aBD7407AD` on Celo Sepolia (about 0.97 test CELO on 5 Nov 2026). Its key is in `.data/throwaway-wallet.key` in the `landing-publish` worktree (gitignored). Never use it on mainnet or for anything of value.

## Working conventions used so far
- Post a short plan before each milestone; commit after each; stop when the user asks for a review.
- `pnpm check` (lint, typecheck, tests, build) must pass before every commit.
- The user's preference: **never use em dashes** in any writing (docs, UI copy, commit messages).
- Commit trailers used so far: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Testing without real accounts
- `GOODBUILD_DEMO_MODEL=1` asks plan-first questions, then replays a scripted G$ tip-jar build, or a one-page site for a website prompt (development only).
- `node scripts/demo-session.mjs [--seed]` signs in a throwaway wallet against a running server and prints the session cookie, so you can test without Magic.
- `pnpm smoke:auth` runs 14 end-to-end sign-in checks against a running server (`BASE_URL`).
- Production-mode local runs need `SESSION_SECRET`, `APP_DOMAIN` and `ALLOW_PGLITE=true` (or a `DATABASE_URL`).

## Gotchas found the hard way
- `pnpm build` failing with "binding to a port: Operation not permitted" in the PostCSS (Tailwind) loader: measured on 5 Nov 2026, the cause was a stale `.next` left by `next dev` in the same folder, not the code or the sandbox. Move `.next` aside and the build passes. Stop the dev server first.
- Background turns (P18): the worker is a `globalThis` singleton started from `src/instrumentation.ts`, and hot reload doesn't replace it. Restart `pnpm dev` after changing `src/server/agent/runner.ts` or `src/server/jobs/`, and after any migration.
- Next 16: GET route handlers are prerendered unless they call `await connection()` (outside `try`). The SIWE nonce route relies on this.
- PGlite and solc must stay in `serverExternalPackages` (next.config.ts); bundling PGlite breaks restarts on an existing `.data/` database.
- Sandpack injects unlayered CSS that beats Tailwind's layered utilities, so its layout overrides live in plain CSS in `globals.css` (`.gb-sp-section`, `.gb-sandpack`).
- The `@tailwindcss/browser` CDN and CodeSandbox's bundler are unreachable from sandboxed environments, so the live preview can only be checked in a normal browser.
