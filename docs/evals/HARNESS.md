# Eval: the agent harness (assets, search, context, memory, design guides)

What P17 adds is in [DECISIONS.md](../DECISIONS.md#p17-agent-harness-assets-code-search-selective-context-rolling-memory-naming-proposed). This page holds the measurements.

Setup:
- Date: 4 Nov 2026. Local dev server from branch `claude/agent-harness-a8a600`, on main's `model.ts` (f6ec153).
- Routing: DeepSeek (`deepseek-flash`) plans and builds, and Claude Sonnet (`claude-sonnet-5-5`) fixes (D19).
- Driver: `scripts/eval-harness.mjs <scenario.json> <out.json>`. It signs in a throwaway wallet, uploads assets, runs each turn over the real SSE endpoint and records status, checks, fix attempts, every read and search, the context picks, and cost per model from the usage events.
- Inputs live in [harness/](harness/): scenarios, a fictional logo, and a design reference made for this eval. Raw results are in [harness/results/](harness/results/) (session cookies removed). Screenshots from the browser pane are in [harness/screens/](harness/screens/).

## Summary

| Eval | Result | First try clean | Fix attempts | Reads + searches | Cost (DeepSeek / Sonnet) | Time |
|---|---|---|---|---|---|---|
| E1 logo and brand colours (run 2) | Pass: logo in header and footer, favicon, tokens from the logo palette | yes | 0 | 0 | $0.025 / $0 | 69 s |
| E2 match a screenshot | Pass: structure, colours and type follow the reference | yes | 0 | 1 read | $0.026 / $0 | 72 s |
| E3 find the right file, 36-file project, 5 edits | Pass: right file every time, target in context 5 of 5 | 5 of 5 | 0 | 0 reads, 1 search in total (target ≤ 2 per edit) | $0.030 / $0 | 8 to 13 s each |
| E4 long conversation (10 turns plus a probe) | Pass, one slip: rules followed on new pages at turn 10; the probe recalled all four first-message rules but put one in a later message | 9 of 10 | 1 (turn 1, contract) | 11 reads, 4 searches over 10 turns (before the leftover-budget fix) | $0.165 / $0.134 | 509 s |
| E5 landing page plus a 3-page dApp | Pass: 4 routes, contract with 6 passing tests, previews without errors | no (test file compile error) | 1 | 0 | $0.058 / $0.201 | 176 s |

Total spent on these runs: about $0.67 of turns, including E1 run 1, plus a few tenths of a cent for describing the uploads. Sonnet's share is all auto-fix, which D19 routes to Sonnet; the cost of those fixes is noted under E5.

## E1: upload a logo, "use my logo and brand colours"

Input: [kola-logo.svg](harness/kola-logo.svg), an orange cup mark with a deep green "KOLA" wordmark, uploaded as a logo. Prompt: "Build a landing page for Kola Coffee, a coffee kiosk in Yaba, Lagos, that opens at 7am and sells cold brew and zobo. Use my logo and brand colours."

- **Upload:** 201, the SVG was sanitised, and the facts came out as 480x160 with palette `#e4572e #1a4232 #fff4e6 #f5bca5 #ef9577`, which are the real brand colours.
- **Run 1:** compiled clean, but **the preview showed "Element type is invalid"**. The footer imported `Instagram` from lucide-react, and lucide 1.68 has no brand icons, so the import was `undefined`. GoodBuild's checks didn't catch it. Fixed: the app check now rejects icon names lucide doesn't export (`lucideIssues` in `checks.ts`), the prompt says lucide has no brand icons, and a test pins the platform's lucide version to the apps' version. ([screen](harness/screens/e1-run1-lucide-error.jpg)) Run 1 also spent one round reading four starter UI files. Fixed: a project that fits the budget is now sent whole, starter pieces included.
- **Run 2:** ready, first try clean, 0 reads, $0.025. The model loaded `landing-page`, `brand-and-assets`, `design-tokens` and `file-structure`. It produced `--color-primary: #1a4232` (logo green), `--color-accent: #e4572e` (logo orange), a cream background and `<link rel="icon" href="/assets/kola-logo.svg" type="image/svg+xml">`. The preview shows the logo in the header, orange CTA buttons and a deep green card. ([screen](harness/screens/e1-logo.jpg))
- **Seen:** the reply contained an em dash, and the user's rule against them isn't in the agent's prompt. It also used placeholder prices and address, and said so in the reply, which the guides ask for.

## E2: upload a screenshot and ask to match it

Input: [reference.png](harness/reference.png), drawn for this eval: a black nav with an italic serif wordmark and a lime pill, a cream split hero with a big serif headline that ends in an italic word, a black pill button plus an underlined link, a tall sage image panel, a dark stats band with lime numbers, three outlined step cards and a lime CTA band. Uploaded as a design reference. Prompt: "Build a landing page for Oyo Seed Fund ... Match the design in my screenshot."

- **Upload:** palette `#f3eee5 #798e59 #a9b98a #c5f629 #141414`, which matches the cream, sage, lime and black.
- **Turn:** ready, first try clean, 1 read, $0.026. The image was attached to that turn's message once (`attached 1 design reference: reference.png`) and the model loaded `match-reference`. Its reply lists what it matched, and the preview confirms it: black nav, italic serif wordmark, lime "Connect wallet" pill, cream background, the serif headline with the italic last word ("Grow the harvest, *together.*"), the black pill plus underlined link, and the sage panel with a circle. Below the fold it built the stats band, the three numbered cards (Pool / Vote / Grow), the CTA band, an about section, an FAQ and a footer. ([screen](harness/screens/e2-reference.jpg))
- **Gaps:** the hero stacks instead of splitting at the preview pane's width (about 500px wide, below `md`). The copy is the user's own, as the guide asks, not the reference's.

## E3: find the right file in a 30-plus-file project

Project: the E5 build, 36 files and 74k chars, of which 52k is the project's own code, which is **over the 40k budget**. Without that, every file would simply be in context. Five edits, each living in one component ([scenario](harness/e3-find.json)):

| Edit | Target | File written | In context | Reads | Searches | Input tokens |
|---|---|---|---|---|---|---|
| Fourth "how it works" step | HowItWorks.tsx | HowItWorks.tsx | yes | 0 | 0 | 50.8k |
| New landing headline | Hero.tsx | Hero.tsx | yes | 0 | 1 (`"Tip the Lagos Coders club"`) | 51.0k |
| 500 G$ quick chip | TipForm.tsx | TipForm.tsx | yes | 0 | 0 | 51.9k |
| New About FAQ | About.tsx | About.tsx | yes | 0 | 0 | 52.0k |
| Accent border on stat cards | StatsRow.tsx | StatsRow.tsx | yes | 0 | 0 | 34.0k |

All 5 are first-try clean, $0.005 to $0.007 each. The context sent 10 to 12 of 36 files in full, plus the manifest. The one search confirmed the headline text before editing.

Offline, on a hand-written 33-file fixture with 10 requests (`codebase.test.ts`) and a 12k budget standing in for a project three times bigger, the target file was in context for at least 8 of 10 requests. Every miss is found by one `search_code` on a request word.

**Vector search: not needed.** Lexical ranking over paths, symbols and text, plus the manifest and one search, found every target. A realistic 30-file project is about 28k chars, and the cap is 80 files of 120 KB, so embeddings would add a provider, cost and staleness for no measured gain.

## E4: a long conversation that remembers an early decision

[Scenario](harness/e4-long.json). Turn 1 sets four rules:
- a minimum tip of 20 G$;
- the button says "Bless the choir";
- every later page credits "Mrs Funke Adebayo";
- never use the word "donation".

Turns 2 to 9 make small edits. Turn 10 adds a Robes Fund page and an About page. From turn 6 on, the first message is outside the 8-message window, so only the rolling memory carries it (`memory: 12 older messages summarised, 10 decisions kept` by the probe).

- **Turn 10 output:**
  - the new `RobesFund.sol` keeps the 20 G$ minimum;
  - `Robes.tsx` and `About.tsx` credit Mrs Funke Adebayo;
  - no file uses "donation";
  - the About page repeats "Bless the choir".

  It compiled and 12 contract tests passed, first try, for $0.057. The new form's button is the robes form's own label, which is a fair reading of the rule.
- **Probe**, answered without edits, $0.006: asked "what rules did I give you in my very first message?", it named the 20 G$ minimum, the button text and blessing instead of donation, and listed Mrs Funke Adebayo among "later" rules. So the rule was kept but its position was lost. The memory keeps decisions, not their order, which is acceptable.
- **Edit turns 2 to 9:** $0.005 to $0.010 each, 11 to 36 s.
- **Turn 10** read nine starter files (hooks, chain, ui) in one round. Fixed after the run: when a project is over budget, the leftover budget now goes to the small starter files, smallest first.
- Turn 1 needed one Sonnet fix ($0.13).

## E5: a landing page plus a 3-page dApp

Prompt: "Build a G$ tip jar dApp for the Lagos Coders club: a landing page, plus three pages: Tip (send G$ with a short message), Leaderboard (top tippers) and About (what the club does, FAQ)."

- **Guides loaded:** pages-and-routing, landing-page, forms-and-signup, design-tokens, content-pages, dashboard-and-data, ui-states, file-structure, contract-tests.
- **Files:** 23 written, every new file named to convention: `src/pages/{Home,Tip,Leaderboard,About,NotFound}.tsx`, `src/components/{Layout,StatsRow,TipFeed,TipForm}.tsx`, `src/components/sections/{Hero,HowItWorks}.tsx`, `src/lib/useTipJar.ts`, `contracts/TipJar.sol` and `contracts/test/TipJar.t.sol`.
- **Checks:** the first compile failed in the test file (an address passed where a contract type was expected). Sonnet fixed it in 1 attempt and the 6 tests passed in the local EVM. $0.26 in all, $0.20 of it Sonnet's two fix calls. That matches the RTX finding that Sonnet fixes dominate cost. D19's `testFix` tier covers failing tests, not test compile errors. This is a routing question for the `model.ts` owner, not changed here.
- **Preview:**
  - the landing page renders, with a hero, a recent-tips card and a stats row;
  - the Leaderboard route works inside the preview;
  - before deploy it shows "Deploy the contract to go live" with skeleton rows (the `ui-states` guide).

  ([home](harness/screens/e5-home.jpg), [leaderboard](harness/screens/e5-leaderboard.jpg))
- **Bug seen:** the Home nav link stays active on every page, because the `/` NavLink needs `end`. Added to the `pages-and-routing` guide; not re-run.

## Not covered yet
- L2: a vision self-review of the preview after each build (not built; offered).
- L3: a nightly runner that scores this battery automatically. `scripts/eval-harness.mjs` is most of it.
- E1 and E5 after the leftover-budget and NavLink fixes: not re-run.
