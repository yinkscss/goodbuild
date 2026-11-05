# Build prompt: GoodBuild Stage 1

You are building **GoodBuild**, a Lovable-style AI dApp builder for GoodDollar (G$) users on Celo. A user describes an app, the agent writes a Solidity contract and a React front end, and the user deploys it by signing from their own wallet.

## Read first (in this order)
1. `CLAUDE.md`
2. `docs/DECISIONS.md` (D1–D4, D11 and D12 are fixed; P-items are proposals)
3. `docs/DESIGN_SYSTEM.md`
4. `docs/AUTH.md`
5. `docs/CREDITS.md`
6. `docs/AI_AGENT.md`
7. `docs/CONTRACTS_AND_DEPLOYMENT.md`
8. Mockups:
   - `design/landing/index.html` (landing)
   - `design/app/a-connect-modal.html`, `b-home.html`, `c-workspace.html` (with PNGs)

## Ground rules
- **Testnet first:** Celo Sepolia (11142220). Mainnet stays behind a flag.
- **Never hold user keys.** Every deploy and credit purchase is signed in the user's wallet.
- **Follow DESIGN_SYSTEM.md exactly**: its tokens, Tailwind/shadcn mapping and component rules. No new styles.
- **Challenge anything** that's wrong or could be better. Propose changes in `docs/OPEN_QUESTIONS.md` and don't silently diverge.
- **Before each milestone,** post a short plan. After each one:
  - make sure it builds, lints and type-checks;
  - add tests for the logic;
  - commit;
  - summarise what's done, what's left and any risks.
- Keep scope to Stage 1: dApps only, with no backend for generated apps (D3).
- Secrets go in `.env.local` only. Commit a `.env.example`.

## Milestones
**M1. Scaffold and landing.**
- Next.js (App Router, TypeScript), Tailwind and shadcn/ui.
- Design tokens wired into `tailwind.config` and the shadcn CSS variables from DESIGN_SYSTEM §6.
- Fonts: Unbounded, Inter and JetBrains Mono.
- A pixel-faithful landing page matching `design/landing/index.html`, including the known fixes in DESIGN_SYSTEM §8 (a "building" hero image, no gap in the right card, a richer prompt box).
- React Bits only for the hero.
- **STOP for user review.**

**M2. Auth and prompt gating.**
- Magic (email embedded wallet, D22) plus external wallets, configured for Celo and Celo Sepolia, with one viem wallet client for signing. Keep the provider behind a `useAuth`/`useWallet` adapter.
- Logged-out Send saves the prompt and opens the connect modal (mockup a).
- SIWE nonce, verify and an httpOnly session.
- After sign-in, restore the prompt and auto-send it.
- Wrong-network pill, account menu, and the 18+/non-US attestation.

**M3. Logged-in home** (mockup b).
- Sidebar with recent builds, a top bar with the credits pill (G$ and USD), the network badge and the account pill.
- Greeting, prompt box, template chips and project bento cards.
- Empty, loading and error states.
- **STOP for user review.**

**M4. Workspace** (mockup c).
- Split view. The chat on the left shows the user message, plan steps, a streaming build log, collapsed file diffs and a deploy card.
- Sandpack on the right with Preview / Code / Contract tabs, a device toggle and refresh.
- Chat wired to the agent via LiteLLM with streaming, per AI_AGENT.md: tool-based diff edits, checks with auto-fix (max 3) and a checkpoint per prompt.
- Persist projects, versions and chat (D8).

**M5. Compile and deploy.** *(built on branch `m5-deploy`, awaiting review; see HANDOFF.md)*
- Compile for deploy on the server (solc in a child process), a deploy manifest (`contracts/deploy.json`) sorted topologically, then simulate, then a human-readable summary.
- Deploy modal with the Sign → Broadcast → Verified stepper, one signature per contract. The user signs on Celo Sepolia.
- Save the address (server-verified from the receipt), verify on Sourcify (Celoscan later, D17), and add the success state.

**M6. Credits** (CREDITS.md).
- G$ vault contract plus an off-chain ledger. Top up by signing a G$ transfer.
- Debit per build or deploy, server-side and idempotent.
- Low-credit and zero-credit states.
- Admin view of the ledger.

## Done means
Someone can type a prompt on the landing page, sign in with email or a wallet, watch the app get built, preview it, deploy the contract to Celo Sepolia from their own wallet, and see credits debited. Everything matches the design system.
