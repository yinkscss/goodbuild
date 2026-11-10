# GoodBuild

An AI app builder for the GoodDollar (G$) community on Celo. Describe an app in chat; GoodBuild writes the Solidity contract and the React front end, previews it in the browser, and deploys it to Celo when you sign from your own wallet. Then it publishes the app at its own address.

**Live:** https://goodbuildit.xyz · Published apps run at `<slug>.goodbuildit.xyz`.

GoodBuild never holds your keys. Deploys and admin calls are signed in your wallet.

## What works today
- **Sign in** with email (Magic wallet) or an external wallet (MetaMask, WalletConnect, MiniPay). See [AUTH.md](docs/AUTH.md).
- **Build with AI.** A plan-first chat, then generated contracts and front end with a live Sandpack preview. Claude Sonnet 5.5 does the planning and code; DeepSeek Flash handles cheap tasks and fallback.
- **Template gallery.** 41 landing-page and app templates with screenshots; one click starts a build from a brief. See [TEMPLATES.md](docs/TEMPLATES.md).
- **Deploy to Celo** (mainnet and Celo Sepolia), with Sourcify verification, redeploy warnings, and optional upgradeable (proxy) contracts. See [CONTRACTS_AND_DEPLOYMENT.md](docs/CONTRACTS_AND_DEPLOYMENT.md).
- **Publish** an app to its own subdomain, with wallet connection built in.
- **App data.** Published apps can save visitor data (forms, records) under rules the builder writes. Owners read it in the Backend window. See [APP_DATA.md](docs/APP_DATA.md).
- **Settings.** An owner-scoped admin panel for your apps, deployed contracts, contract admin functions and app data (D62).
- **Buy G$ or CELO.** From Add credits, a dialog shows the price and fees, then GoodCash's panel takes the ID and bank-transfer details. Off until GoodCash keys are set.
- **Credits.** AI builds are paid with GoodBuild credits, bought with G$ against signed quotes. GoodDollar-verified wallets get a bonus. Every account starts with a small free allowance. See [CREDITS.md](docs/CREDITS.md) and D56 in [DECISIONS.md](docs/DECISIONS.md).

## Not done yet
- **Buy G$ or CELO with naira** through GoodCash is built (D63) but needs GoodCash keys and top-ups switched on before it shows. Not yet tried with real keys.
- **Audit.** The credits contract and the generated-contract flow are unaudited.
- **Backend and database for generated apps** beyond the app-data feature above.

## Develop
```bash
pnpm install
cp .env.example .env.local
pnpm dev          # http://localhost:3000
pnpm check        # lint, typecheck, tests, production build
pnpm smoke:auth   # end-to-end sign-in checks against a running server (BASE_URL)
node scripts/demo-session.mjs --seed   # throwaway signed-in session with sample projects
```
- Email sign-in needs `NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY` and (server) `MAGIC_SECRET_KEY`. WalletConnect needs `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
- Without `DATABASE_URL`, development uses an embedded database in `.data/`.
- AI builds run from the Next.js server through the Vercel AI SDK: set `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` in `.env.local`. To try the workspace without keys, set `GOODBUILD_DEMO_MODEL=1` (development only).
- A separate worker runs builds: `pnpm worker`.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 + shadcn/ui, Drizzle + Postgres, viem, Vitest. Design tokens are in `src/app/globals.css`.

## Production
One VPS behind Cloudflare, deployed by GitHub Actions on every merge to `main` (checks run first). Details and what not to break: [DEPLOY.md](docs/DEPLOY.md).

## Docs
- [HANDOFF](docs/HANDOFF.md): current build status and what is unverified
- [Decisions](docs/DECISIONS.md): what was decided, by whom, and why
- [Architecture](docs/ARCHITECTURE.md) · [AI agent](docs/AI_AGENT.md) · [Contracts and deployment](docs/CONTRACTS_AND_DEPLOYMENT.md)
- [Auth and wallets](docs/AUTH.md) · [App data](docs/APP_DATA.md) · [Credits](docs/CREDITS.md) · [Top-ups](docs/TOPUPS.md)
- [Mainnet plan](docs/MAINNET_PLAN.md) · [Deploying GoodBuild](docs/DEPLOY.md)
- [Design system](docs/DESIGN_SYSTEM.md): light bento UI (fixed)
- [Roadmap](docs/ROADMAP.md) · [Open questions](docs/OPEN_QUESTIONS.md) · [Research](docs/RESEARCH.md)
- [CLAUDE.md](CLAUDE.md): guidance for Claude Code in this repo

## Rules of the road
18+ only, no US persons. Generated contracts are unaudited.
