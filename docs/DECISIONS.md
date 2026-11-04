# Decisions

Format: decision, date, who decided, rationale. **User** decisions are fixed unless the user changes them. **Recommended (Ego)** decisions are adopted unless changed and may be challenged with reasons (see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)). Add new decisions at the bottom.

## User decisions (fixed)

### D1. Build an app builder, not a "pay for LLMs with G$" router
- Date: 4 Nov 2026 · Decided by: user (Olayinka)
- Rationale: GoodDollar already builds G$-to-AI-credits: repo https://github.com/GoodDollar/antseed-integration and https://aicredits.gooddollar.org. A router would overlap with GoodDollar's own work.

### D2. Stage 1 MVP is dApps only
- Date: 4 Nov 2026 · Decided by: user
- AI generates the Solidity contract and a React front end. The user deploys to Celo by signing from their own wallet (GoodBuild never holds deploy keys).
- Rationale: smallest useful scope; app state lives on-chain, so no backend is needed.

### D3. Backend and database support for generated apps is deferred to Season 5
- Date: 4 Nov 2026 · Decided by: user
- Rationale: keeps Stage 1 small; adds hosting and cost complexity.

### D4. Sports betting rejected
- Date: 4 Nov 2026 · Decided by: user
- Rationale: grey or illegal. GoodDollar ToS §6.3 bans use that violates applicable law; Lagos requires an LSLGA licence for betting (LSLGA Law 2021). See [RESEARCH.md](RESEARCH.md#legal-and-terms).

### D11. GoodBuild builds its own credit system
- Date: 4 Nov 2026 · Decided by: user (Olayinka)
- Rationale: GoodDollar AI credits have no usable inference API/API keys yet ("not yet implemented"; see [GOODDOLLAR_AI_CREDITS.md](GOODDOLLAR_AI_CREDITS.md)). Users deposit G$ to a GoodBuild vault on Celo; an off-chain ledger funds LLM spend via LiteLLM. Design: [CREDITS.md](CREDITS.md). GoodDollar/AntSeed may become an optional future provider (P3).

### D12. Design direction: light bento (Design B)
- Date: 4 Nov 2026 · Decided by: user (Olayinka)
- GoodBuild uses the light bento style of [design/landing/index.html](../design/landing/index.html): #F5F5F5 canvas, white cards, violet #592E81 primary, a sparing pink #FF85D9 pop, Unbounded display caps with Inter for body. The dark Design A is archived in `design/landing/explorations/`.
- All UI must follow [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- Rationale: the user chose it over the dark exploration.

## Recommended decisions (Ego; adopted unless changed)

### D5. In-browser preview via Sandpack
- Date: 4 Nov 2026 · Recommended by: Ego
- Use Sandpack (open source, free). No E2B or WebContainers for now.
- Rationale: WebContainers needs a commercial licence for for-profit production use (https://webcontainers.io/enterprise). E2B Hobby has a $100 one-time credit and costs about $0.17/hr per default sandbox; Pro is $150/mo (figures as given, re-check https://e2b.dev/pricing). Stage 1 front ends are static React, which Sandpack handles.

### D6. Build our own small builder; don't fork Open Lovable
- Date: 4 Nov 2026 · Recommended by: Ego
- Rationale: Open Lovable (https://github.com/firecrawl/open-lovable) is MIT but built around E2B/Vercel sandboxes and has no contract or wallet flow. Borrow ideas (prompting, file-edit format), not the codebase.

### D7. Generated apps default to shadcn/ui + React Bits
- Date: 4 Nov 2026 · Recommended by: Ego
- Rationale: Lovable-quality UI out of the box.

### D8. Persistence split
- Date: 4 Nov 2026 · Recommended by: Ego
- Project code and chat history live in our own DB. App data lives on-chain; the deployed contract address (and chain id) is stored per project.

### D9. AI calls via GoodDollar AI credits if allowed, else providers via LiteLLM
- Date: 4 Nov 2026 · Recommended by: Ego
- Not OpenRouter: its ToS bans access "for purposes of reselling API access to Models or otherwise developing a competing service" (https://openrouter.ai/terms).
- No public API exposing Claude without Anthropic approval (Anthropic Commercial Terms forbid reselling "except as expressly approved").

### D10. 18+ only; block US persons
- Date: 4 Nov 2026 · Recommended by: Ego
- Rationale: GoodDollar ToS §6.2 (18+) and §8 "NO U.S. PERSONS MAY USE THE SERVICES". Gemini API also requires 18+. Also exclude sanctioned jurisdictions.

## Proposed decisions (not adopted; Claude and the user may change them)

### P1. Testnet is Celo Sepolia, not Alfajores (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · Alfajores retired 30 Sep 2025 (https://docs.celo.org/operate/notices/archive/celo-sepolia-launch).

### P2. Audited-template-first contracts, non-upgradeable by default (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See CONTRACTS_AND_DEPLOYMENT.md §4. Open: Q1, Q4, Q15.

### P3. Off-chain deployments table is the source of truth; on-chain factory optional later (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See CONTRACTS_AND_DEPLOYMENT.md §3. Open: Q11.

### P4. Agent uses tool-based diff edits, checks + auto-fix (max 3), checkpoint per prompt, plan/build modes (proposed)
- Date: 4 Nov 2026 · Proposed by: Grok Bot · See AI_AGENT.md. Open: Q14.

### P3. GoodDollar AI credits via AntSeed gateway behind LiteLLM (DEFERRED by D11)
- Status: deferred. GoodDollar/AntSeed is an optional future provider only, revisit once GoodDollar ships its proxy/API keys.
- Date: 4 Nov 2026 · Proposed by: Grok Bot · Users fund credits with the GoodWidget AI credits widget; GoodBuild runs an AntSeed gateway registered as an OpenAI-compatible LiteLLM provider, falling back to direct providers. Blocked on buyer-key custody / GoodDollar proxy (see [GOODDOLLAR_AI_CREDITS.md](GOODDOLLAR_AI_CREDITS.md), Q17).
