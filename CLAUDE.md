# CLAUDE.md

Guidance for Claude Code in this repo.

1. **Read the docs first**: README.md, then docs/DECISIONS.md, ARCHITECTURE.md, AI_AGENT.md, CONTRACTS_AND_DEPLOYMENT.md, RESEARCH.md, ROADMAP.md, OPEN_QUESTIONS.md.
2. **Challenge anything that's not right or could be done better**: every recommendation, design doc, architecture choice and stack pick, with reasons. Record changes in docs/DECISIONS.md (or propose in docs/OPEN_QUESTIONS.md). The only fixed items are the user's D1–D4, D11 and D12, and even those can be flagged for the user to reconsider.
3. **User decisions (D1–D4) are fixed** unless the user changes them: app builder (not an LLM router), Stage 1 = dApps only with user-signed deploys to Celo, backend/DB support deferred, no sports betting.
4. **Ego's recommendations (D5–D10) can be challenged.** Propose changes with reasons in docs/OPEN_QUESTIONS.md or to the user; don't silently diverge.
5. **Record new decisions** in docs/DECISIONS.md with date, rationale and who decided.
6. **Plan before code.** Write a short plan and get agreement before large changes. Keep scope to the current stage.
7. Don't invent facts; mark anything unverified. Respect compliance: 18+, no US persons, no OpenRouter resale, no public Claude API without approval.
8. Never hold user private keys; deploys are signed in the user's wallet.
9. **Follow docs/DESIGN_SYSTEM.md for all UI** (D12, fixed user decision: light bento, Design B). Use its tokens, Tailwind/shadcn mapping and component rules. Don't introduce other styles.
