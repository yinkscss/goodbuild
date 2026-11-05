# Eval: the agent harness (assets, search, context, memory, design guides)

What P17 adds is in [DECISIONS.md](../DECISIONS.md#p17-agent-harness-assets-code-search-selective-context-rolling-memory-naming-proposed). This page holds the measurements.

Setup:
- Date: 4 Nov 2026. Local dev server from branch `claude/agent-harness-a8a600`, on main's `model.ts` (f6ec153).
- Routing: DeepSeek (`deepseek-flash`) plans and builds, and Claude Sonnet (`claude-sonnet-5-5`) fixes (D19).
- Driver: `scripts/eval-harness.mjs <scenario.json> <out.json>`. It signs in a throwaway wallet, uploads assets, runs each turn over the real SSE endpoint and records status, checks, fix attempts, every read and search, the context picks, and cost per model from the usage events.
- Inputs live in [harness/](harness/): scenarios, a fictional logo, and a design reference made for this eval. Raw results are in [harness/results/](harness/results/) (session cookies removed). Screenshots from the browser pane are in [harness/screens/](harness/screens/).

## Summary

| Eval | Result | First try clean | Fix attempts | Reads + searches | Preview errors | Cost (DeepSeek / Sonnet) | Time |
|---|---|---|---|---|---|---|---|
| E1 logo and brand colours (run 2) | Pass: logo in header and footer, favicon, tokens from the logo palette | yes | 0 | 0 | none (run 1: lucide `Instagram`, now a check) | $0.025 / $0 | 69 s |
| E2 match a screenshot | Pass: structure, colours and type follow the reference | yes | 0 | 1 read | none | $0.026 / $0 | 72 s |
| E3 find the right file, 36-file project, 5 edits | Pass: right file every time, target in context 5 of 5 | 5 of 5 | 0 | 0 reads, 1 search in total (target ≤ 2 per edit) | none | $0.030 / $0 | 8 to 13 s each |
| E3b same project, 5 more edits incl. a new page (after the leftover-budget fix) | Pass: right file every time, target in context 4 of 5 (the other found with 1 read) | 5 of 5 | 0 | 7 reads, 2 searches in total; adding a page took 1 read | none: all 5 routes render, nav active state correct | $0.060 / $0 | 18 to 50 s each |
| E4 long conversation (10 turns plus a probe) | Pass, one slip: rules followed on new pages at turn 10; the probe recalled all four first-message rules but put one in a later message | 9 of 10 | 1 (turn 1, contract) | 11 reads, 4 searches over 10 turns (before the leftover-budget fix) | none: Blessings, Robes Fund and About render | $0.165 / $0.134 | 509 s |
| E5 landing page plus a 3-page dApp | Pass: 4 routes, contract with 6 passing tests | no (test file compile error) | 1 | 0 | none; Home nav link always active (guide fixed, confirmed in E3b) | $0.058 / $0.201 | 176 s |

Total spent on these runs: about $0.73 of turns, including E1 run 1, plus a few tenths of a cent for describing the uploads.

Composer upload: driven once in the workspace UI. The attach menu opened ([screen](harness/screens/composer-attach-menu.jpg)); because a native file dialog can't be scripted, a PNG was put into the hidden file input from JS. It uploaded through the real handler and showed as a `choir-robes.png` chip with its thumbnail. Every other upload went through the same API from the driver script. The Logo and Design reference menu items, which open the file dialog, were not clicked through. Sonnet's share is all auto-fix, which D19 routes to Sonnet; the cost of those fixes is noted under E5.

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

### E3b: five more edits on the same project, after the leftover-budget fix

[Scenario](harness/e3b-find.json). All five were ready and first-try clean, for $0.060 in total.

| Edit | Target | In context | Reads | Searches |
|---|---|---|---|---|
| Relative times in the tip feed | TipFeed.tsx | yes | 1 (`format.ts`, a helper) | 0 |
| Home nav link always active | Layout.tsx | yes | 2 (`utils.ts`, `styles.css`) | 1 (`NavLink`) |
| Medal badges on the leaderboard | Leaderboard.tsx | yes | 1 (a line range of it) | 1 (`Crown`) |
| Friendlier 404 page | NotFound.tsx | **no**: "404" doesn't match the file name | 2 (`NotFound.tsx`, `button.tsx`) | 0 |
| New Events page with a nav link | new `src/pages/Events.tsx`, App.tsx, Layout.tsx | yes | 1 (`App.tsx`) | 0 |

- Adding a page now takes 1 read, against nine starter files in E4 turn 10.
- The leftover-budget fill showed up in turns 3 and 5 (label, utils, skeleton, input, textarea).
- Turns 1 and 4 picked the platform ABI module `src/contracts/TipJar.ts` because the request said "tip", and it used up the room the small helpers needed. Fixed after this run: ABI modules leave selection once a project is over budget. The contract source is already in, and the manifest names the ABI exports.
- The 404 miss suggests a small synonym list (404 ↔ NotFound), which isn't built.
- In the preview, all five routes render with no errors, including Events with its "Sample schedule" notice; only Events is highlighted on the Events page. ([screen](harness/screens/e3b-events.jpg))

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
- Preview after turn 10: the Blessings, Robes Fund and About pages render without errors, and About credits Mrs Funke Adebayo. ([about](harness/screens/e4-about.jpg), [robes](harness/screens/e4-robes.jpg))

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

## Gap checklist

From the review after the first evals. "Live" means driven in a real browser or against the real providers; "unit" means automated tests only.

- [x] Keep contract ABI files out of large projects' context. Live in E3c (5 Nov): over budget (39 files), no `src/contracts/` ABI module was picked in any of the five turns. The ABI's `index.ts` re-export was picked, but that file is small.
- [x] Attach menu items. Live: the Logo item opened the file dialog, the file was supplied from JS, and the upload stored it as a logo. Unit: all three items. The Playwright `setInputFiles` test isn't written.
- [x] Memory keeps when a decision was made (turn tags in `memory.ts`). Live in E4 run 2 (5 Nov): every first-message rule was tagged `[t1]`, and the probe attributed all five to the first message, fixing the earlier slip.
- [x] Request words that don't match file names: synonym list in the context ranking (404 and NotFound, home and index, nav and Layout or Header). Live in E3c: `NotFound.tsx` was in context for the 404 edit, with 0 reads.
- [x] Memory call with thinking on (the empty-reply risk): measured live in E4 run 2. 6 calls returned 763 to 1,431 chars of usable JSON (289 to 508 output tokens), with no fallback. Left as it is; the runner now logs output tokens and any fallback.
- [x] Upload descriptions through `visionClient()` (thinking off): live E1 run 3 (5 Nov). The logo got an accurate two-sentence description; the upload took 14.3 s including a cold compile.
- [x] Test compile errors no longer go to Sonnet first: `fixTier()` in `runner.ts`, no change to `TIER_FOR`. Unit only. D19 second amendment, approved by the user on 5 Nov 2026.
- [x] Em dashes in model replies: a prompt line plus `plainDashes` in the runner. Unit only.
- [x] Assets in production: signed public URLs at `/a/<token>`; data URLs stay for local development. Unit only, because it needs a public https origin. Object storage isn't built; `AssetStore` is the seam.
- [x] SVG sanitising with a real parser (DOMPurify on jsdom). Unit, plus live uploads of a normal logo.
- [x] Visual check (vision self-review). Live, see below.
- [x] Background runner (P18). Live in Chrome on 5 Nov: reload mid-build, Stop with queued follow-ups, two and three prompts on one project, and the server stopped mid-build then restarted (resumed with no repeated tool calls or double billing). Details in P18 and the PR. Also live: `pnpm worker` beside the inline worker on Postgres (both claimed jobs, no project ever ran two at once), and a new project from the home page (its first prompt queued automatically).

### Visual check, measured live (4 Nov 2026)

Driven in headless Chrome with Playwright on the running dev server, real DeepSeek calls, three fresh projects.

- **Why the v12 result never appeared:** the capture and POST worked, and the route answered `422 no_result`, which the client ignored. Calling `deepseek-flash` directly with the same kind of request: with thinking on, 500, 2,500 and 6,000 output tokens all ended at `length` with no text (6,000 took 35 s). With thinking off: `stop`, 2 s, 111 to 160 tokens, valid JSON. Fixed with `visionClient()`; upload descriptions use it too.
- **Second bug, found by the defect build:** a broken `<img>` made html-to-image reject with `[object Event]`, so the check couldn't run on one of the defects it looks for. Fixed with `onImageErrorHandler`.
- **Normal build (Surulere Tailors):** "the preview looks right at 908px" about 2 s after the capture, $0.0003, still there after a reload.
- **Defect build (white text on white, a broken image):** four issues on the card, including the blank hero and the broken image; still there after a reload. "Fix these" sent the prompt, built v2 for under $0.01, and v2 was checked again automatically.
- **Weak spot:** v2's check still listed four issues, and at least one was wrong: it treated the original "white on white" instruction as a requirement and also complained about CSS pattern tiles standing in for photos. The check advises and never edits, so this costs only attention. Its prompt needs tuning against more builds.
- **Not tested live:** the "couldn't run" line (it replaces the failure that used to be silent). Its failure path ran live before the fix, but the line itself wasn't looked at.

## Re-runs on the background runner (P18), 5 Nov 2026

Setup:
- Dev server on 127.0.0.1:3002 from branch `claude/background-runner`, with every turn run as a background job.
- E3c, E4 and E1 ran on the worktree's PGlite, so the E3 project from 4 Nov was still there.
- The runner tests ran on a scratch local Postgres (see P18 in DECISIONS).

### E3c: five new single-file edits on the E3 project (39 files, over budget)
[Scenario](harness/e3c-find.json). Re-running E3b's own prompts was not a fair test: its edits were already in the project, so the first one only answered "already done", and that run was stopped.

| Edit | Target | In context | Reads | Searches | Cost |
|---|---|---|---|---|---|
| Friendlier first FAQ answer | About.tsx | yes | 0 | 0 | $0.0064 |
| "Tippers" to "Supporters" | StatsRow.tsx | yes | 0 | 1 (`Tippers`) | $0.0069 |
| Meetup times in bold | Events.tsx | yes | 0 | 0 | $0.0059 |
| New message placeholder | TipForm.tsx | yes | 0 | 0 | $0.0056 |
| New 404 headline | NotFound.tsx | yes (the synonym fix) | 0 | 0 | $0.0062 |

All five were first-try clean and DeepSeek only, $0.031 in all, 13 to 38 s each. That is 5 of 5 targets in context, 0 reads and 1 search across the run. E3b had 4 of 5, 7 reads and 2 searches.

### E4 run 2: the 10-turn conversation, all prompts queued at once
The same [scenario](harness/e4-long.json), with `queueAll`: all 10 prompts were sent first, and the server ran them one after another in send order.

- 10 of 10 first-try clean with no fix attempts. $0.148 in all, all DeepSeek; run 1 cost $0.30, including a $0.13 Sonnet fix.
- Turn 1 took 160 s and turn 10 took 143 s, both contract builds. Edits took 11 to 21 s.
- **Rules at turn 10:**
  - Mrs Funke Adebayo is credited in the shared `Layout.tsx`, so on every page, and on About.
  - "donation" appears in no file.
  - Both contracts, the choir jar and the Robes Fund, enforce 20 G$.
  - "Bless the choir" is on the home page and About.
- **Memory:** 6 calls, every reply usable (763 to 1,431 chars, 289 to 508 output tokens). After turn 10 the memory held 10 decisions: the five `[t1]` rules first, then `[t2]` to `[t6]` in order.
- **Probe** ("what rules did I give you in my very first message?"), answered without edits: it named the five turn-1 rules, the tip jar itself, the 20 G$ minimum, "Bless the choir", crediting Mrs Funke Adebayo and never saying "donation", all as first-message rules. Run 1 had misplaced one.
  - The probe was queued straight into the database (`turn_jobs` plus a queued message), because the session cookie for that project wasn't kept. The worker ran it like any other job.

### E1 run 3: logo upload, described with thinking off
- **Upload:** 201, 480x160, palette `#e4572e #1a4232 #fff4e6 #f5bca5 #ef9577` as before. Description: "a minimalist cream coffee cup icon within a rounded orange square alongside the wordmark KOLA in dark green and the text COFFEE · LAGOS below... intended for a light background", which is accurate.
- **Build:** ready first try, $0.024, 68 s, guides `landing-page`, `brand-and-assets` and `design-tokens`.
- The preview wasn't opened this run; run 2 above has the screenshots.

## Not covered yet
- L3: a nightly runner that scores this battery automatically. `scripts/eval-harness.mjs` (now on the job flow, with `queueAll`) is most of it.
- The NavLink guide line was confirmed by E3b turn 2 as an edit, but no new multi-page build was run after it.
- The visual check's prompt still needs tuning: after "Fix these" it listed four issues, and at least one was wrong.
