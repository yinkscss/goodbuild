# CLAUDE.md

Guidance for Claude Code in this repo.

1. **Read the docs first**: README.md, then docs/DECISIONS.md, ARCHITECTURE.md, RESEARCH.md, ROADMAP.md, OPEN_QUESTIONS.md.
2. **User decisions (D1–D4) are fixed** unless the user changes them: app builder (not an LLM router), Stage 1 = dApps only with user-signed deploys to Celo, backend/DB support deferred, no sports betting.
3. **Ego's recommendations (D5–D10) can be challenged.** Propose changes with reasons in docs/OPEN_QUESTIONS.md or to the user; don't silently diverge.
4. **Record new decisions** in docs/DECISIONS.md with date, rationale and who decided.
5. **Plan before code.** Write a short plan and get agreement before large changes. Keep scope to the current stage.
6. Don't invent facts; mark anything unverified. Respect compliance: 18+, no US persons, no OpenRouter resale, no public Claude API without approval.
7. Never hold user private keys; deploys are signed in the user's wallet.
