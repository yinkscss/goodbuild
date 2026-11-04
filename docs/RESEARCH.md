# Research summary

Condensed from research done 4 Nov 2026. **UNVERIFIED** marks anything not confirmed.

## GoodBuilders Season 5
- About 3 months, kickoff 9 Nov 2026, USD 50K+ in G$ streamed via Flow State, weekly 1:1s, workshops, Demo Days. Theme: "products people and agents come back to." Apply: https://ubi.gd/gbseason5-apply. Announcements: https://tg.me/gooddollarannouncements
- Seasons 3–4 scored 50% mentor votes, 25% community votes, 25% on-chain metrics (verified users, G$ circulated, transactions). **S5 weights UNVERIFIED** (Notion page didn't render). S4 recap: https://medium.com/@GoodDollarHQ/goodbuilders-season-4-building-the-future-of-ubi-one-product-at-a-time-eb0f64929af2
- S4: about 3,900 verified users across 8 teams; Delulu 1,988, Game Arena 879, GoodDrops 550. 500+ is realistic. Several grew via campus ambassadors (UNILAG etc.).

## G$ economics (4 Nov 2026)
- Price about $0.000112 (CoinGecko).
- Daily claim about 126 G$ ≈ $0.014 per person (~10–11K Celo claimers/day; https://dune.com/thalescb/gooddollar-ubi). Buys roughly 25K–54K tokens of a cheap model (DeepSeek V4 Flash, Gemini 3.1 Flash-Lite).
- Thin DEX liquidity (GeckoTerminal): G$/cUSD 1% pool ~$1.4K TVL, USDGLO/G$ ~$6.5K. Convert via the Mento reserve (https://docs.gooddollar.org/for-developers/core-contracts/mentobroker); reserve size ~200K USDm UNVERIFIED.
- Sep 4, 2026 exploit (Superfluid Celo bug) drained ~$125K; G$/UBI paused Sep 4–9, reserves reopened Sep 29 with reduced sell limits (https://discourse.gooddollar.org/t/gooddollar-incident-post-mortem-september-4-attack/9164). Plan for pauses.
- Takeaway: UBI claims can fund small daily usage, not revenue.

## Competitors
| Product | Notes |
|---|---|
| GoodDollar × AntSeed AI Credits | G$ → AI credits; dev-tool focus; "AI request proxying… not yet implemented". https://github.com/GoodDollar/antseed-integration, https://aicredits.gooddollar.org |
| Lovable, bolt.new, v0 | Hosted prompt-to-app, card subscriptions. https://lovable.dev/pricing |
| bolt.diy | MIT, but WebContainers need a commercial licence in production. https://webcontainers.io/enterprise |
| Dyad | Apache-2.0 (except `src/pro/`, FSL); desktop-first. https://github.com/dyad-sh/dyad |
| Open Lovable | MIT; needs Firecrawl key and E2B/Vercel sandbox. https://github.com/firecrawl/open-lovable |
| Celo/MiniPay AI apps | None found. |

Gap: no builder that generates and deploys **contracts plus front end** for face-verified newcomers with no-card onboarding.

## Legal and terms
- GoodDollar ToS (https://www.gooddollar.org/terms-of-use): §6.2 18+; §6.3 no use violating applicable law; §6.9 no laundering/fraud; §7.1 may suspend "to protect our reputation"; §8 "NO U.S. PERSONS MAY USE THE SERVICES OR SUBSCRIBE TO THE SERVICES." No gambling clause by name.
- Nigeria: since the Nov 2024 Supreme Court ruling, betting is state-regulated; Lagos licensing is by LSLGA, including promotional competitions (https://lslga.org/lagos-state-lotteries-and-gaming-authority-clarifies-misconceptions-on-remote-gaming-licenses-in-nigeria/).
- OpenRouter ToS forbids reselling or building a competing service (https://openrouter.ai/terms).
- OpenAI Services Agreement allows apps for end users; forbids reselling accounts or API keys; minors need consent (https://openai.com/policies/services-agreement/).
- Anthropic Commercial Terms: may power products for end users; no reselling "except as expressly approved" (https://www.anthropic.com/legal/commercial-terms).
- Gemini API: 18+ (https://ai.google.dev/gemini-api/terms).
- Nigeria SEC/VASP rules for credits: not researched; get legal advice.

## Payment-pain evidence (Nigeria)
- Naira cards were blocked abroad ~2022–25, resumed July 2025 (Reuters); limits raised Sep 2026 (https://nairametrics.com/2026/09/07/gtco-firstbank-zenith-bank-others-raise-dollar-spending-limits-as-fx-scarcity-eases/).
- Remaining failures: recurring-charge blocks, Verve cards, 3DS timeouts, USD settlement (https://techpeza.com/naira-card-declined-ai-subscriptions-fix/).
- Founder quote: "3 startup credit programs asked for a payment card. None of my Nigerian cards got through." (https://www.linkedin.com/posts/yusuf-suleiman-tahir-895546a9_startups-nigeriatech-ai-activity-7514283120586706944-9TZI)
- Counterpoint: ChatGPT now bills in NGN, so pain is mainly USD-billed dev tools (Lovable, Cursor, APIs) and students without suitable cards.
- Gap: no verified X/Reddit quotes; collect 10–20 campus quotes ourselves.
