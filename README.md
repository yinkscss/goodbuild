# GoodBuild

A Lovable/Replit-style AI app builder for GoodDollar (G$, on Celo) users. Describe a dApp in chat; GoodBuild generates the Solidity contract and a React front end, previews it in the browser, and you deploy it to Celo by signing from your own wallet.

**Target:** GoodDollar GoodBuilders Season 5 (about 3 months, kickoff 9 Nov 2026, USD 50K+ in G$, streamed). Apply: https://ubi.gd/gbseason5-apply · Program: https://ubi.gd/gbuilders5

**Audience:** university students, Web3 newcomers and OG Web3 users. Goal: onboard people into Web3, 500+ returning users.

## Status
Stage 1 in progress. M1 (landing), M2 (auth and prompt gating), M3 (home) and M4 (workspace and agent) done; see [the build prompt](docs/BUILD_PROMPT_STAGE1.md).

## Develop
```bash
pnpm install
cp .env.example .env.local
pnpm dev          # http://localhost:3000
pnpm check        # lint, typecheck, tests, production build
pnpm smoke:auth   # end-to-end sign-in checks against a running server (BASE_URL)
node scripts/demo-session.mjs --seed   # throwaway signed-in session with sample projects
```
Set `NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY` (and `MAGIC_SECRET_KEY` on the server) to turn email sign-in on; wallet sign-in also needs `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for WalletConnect. Without `DATABASE_URL`, development uses an embedded database in `.data/`.

**AI builds** use the Vercel AI SDK from the Next.js server (D18). No proxy and no Python: put `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` in `.env.local`, then run `pnpm dev`. Plan and code use Claude Sonnet 5.5; cheap tasks and fallback use DeepSeek Flash.
To try the workspace without keys, set `GOODBUILD_DEMO_MODEL=1` (development only).
Stack: Next.js 16 (App Router), TypeScript, Tailwind v4 + shadcn/ui, Vitest. Design tokens live in `src/app/globals.css` (DESIGN_SYSTEM §6).

## Docs
- [Decisions](docs/DECISIONS.md): what is fixed and what is recommended
- [Architecture](docs/ARCHITECTURE.md): components, data flow, suggested stack
- [AI agent](docs/AI_AGENT.md): models, agent loop, context, steering, UI quality, evals
- [Contracts and deployment](docs/CONTRACTS_AND_DEPLOYMENT.md): wallet, deploy flow, ownership mapping, templates, interaction panel
- [Research](docs/RESEARCH.md): G$ economics, competitors, terms, payment pain
- [Roadmap](docs/ROADMAP.md): Stage 1, S5 weeks 1–12, growth plan, metrics
- [Open questions](docs/OPEN_QUESTIONS.md): not final; input invited
- [CLAUDE.md](CLAUDE.md): guidance for Claude Code in this repo
- [Auth and wallets](docs/AUTH.md): Magic email wallet + external wallets, SIWE, prompt gating (D22)
- [Stage 1 build prompt](docs/BUILD_PROMPT_STAGE1.md): the prompt to hand Claude
- [Design system](docs/DESIGN_SYSTEM.md): light bento UI (D12, fixed); landing reference in design/landing/index.html
- **Brand / logo:** official glass 2x2 tile mark (5 Nov 2026, D25) — assets in `design/brand/` and `public/brand/`; UI via `src/components/brand/logo.tsx`
- [Credits system](docs/CREDITS.md): GoodBuild's own G$ credits (D11)
- [GoodDollar AI credits (AntSeed)](docs/GOODDOLLAR_AI_CREDITS.md): researched, deferred
