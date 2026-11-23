# Build clarity plan: what a person sees while GoodBuild builds

Date: 21 Nov 2026 · Written by: Claude · Asked for by: the owner ("be honest... what part can confuse a non-technical person"; "we are supposed to hold them like babies and guide them all step of the way") · Status: **approved by the owner ("build the plan in one PR") and built on 21 Nov 2026 as D164** (see DECISIONS.md for what shipped).

Mock the owner approved: [GoodBuild Build Clarity](https://claude.ai/artifact/Qp4xxF5J7o4oiEXPpkLHsC) (version 3). It plays the same build twice, side by side: today, and the proposal below.

PR #170 (D162, merged) made the builder fix its own mistakes. This plan is about what the person *sees* while it does. Every finding names the code that produces it, read on `main` at 00fb046. Nothing here was tested with real users; "confusing" is Claude's judgement against the goal in BUILDER_RELIABILITY_PLAN.md: *someone who knows nothing about software never sees a technical error and never has to know what a setting is.*

## Part 1. What confuses people today

Ranked by how likely a person is to be lost or worried by it.

### High: they won't understand it, and it looks like something broke
1. **File names as progress.** The step list says "Writing App.tsx", "Writing useWallet.ts", "Deleting Hero.tsx", "Adding wagmi", "Reading the visual-design guide" (`toolLabel`, `src/server/agent/runner.ts:1983`). "Deleting" reads like lost work. Only contract files and compile and test steps get plain words (`plainStepLabel`, `turn-view.tsx:19`). The builder already writes a plain plan of 2 to 6 steps (`set_plan`, or the spec's plan in harness v2), but in Build mode it's never shown: it renders only in Plan mode (`turn-view.tsx:381`).
2. **Two buttons for one problem, and they do different things.** When a build fails and the preview also crashed, the person sees two cards:
   - **Try fix / Try again** on the failed build: a server retry of the same request. It starts from the saved draft and gives the builder the last attempt's errors (`retry/route.ts`, `jobs.ts:127`, `runner.ts:1554`).
   - **Fix it** on the preview error: a brand new build message with the error text (`previewFixPrompt`, `preview-errors.ts:18`).
   - Neither one knows about the other's problem, and the person has to guess which to press.
3. **A dead end on the second try.** The first retry of a failed build is paid by GoodBuild (the repair allowance). A retry of that retry isn't, and is refused with "The included repair allowance is unavailable or used up. … You can request a smaller change using credits in the composer" (`jobs.ts:186–189`). A second button then appears: "Continue using credits (estimated …)" (`chat-panel.tsx:193`).
4. **Raw errors in "This build stopped".** An unexpected error shows `error.message` as it is (`runner.ts:1311–1318`), so a person can read "fetch failed", "ECONNRESET" or a database error.
5. **The milestone sentence.** "Working first interface: implementation saved; live behaviour still needs verification. Live payments remain disabled. Still to finish: …" (`runner.ts:1261`), with "Local/demo milestone · Remaining: …" under it (`turn-view.tsx:398`).
6. **Milestone names as buttons.** The next-step chips are "Remaining integrations" and "On-chain features and payments" (`runner.ts:1262`, `delivery.ts:3–11`). A person can't tell what tapping one will build.
7. **The preview error card** shows the file, the line and the raw message in a code font: "The preview hit an error in src/components/Board.tsx:42 · TypeError: Cannot read properties of undefined (reading 'map')" (`preview-error-notice.tsx`).

### Medium: they'll guess, and may guess wrong
8. **"Auto-fix: failed · Failed after 2 attempts: 3 errors left"** (`runner.ts:1219–1221`). "Errors" sounds like *they* did something wrong.
9. **Two checks with two names.** "Visual check: the preview looks right at 390px" and "Looked at the page on a phone and a computer" are different checks that look like the same thing to a person.
10. **"Logs"** on the error card opens the raw build log (`turn-view.tsx:184`).
11. **Plan / Build** is explained only in a hover title (`chat-panel.tsx:400`). Phones never show hover titles.
12. **Undo is hidden.** A small "v4 · auto-saved" pill opens a menu whose confirm says "Revert to v3?" (`workspace.tsx:210–235`).

### Low: web3 words that can be softened
13. "1.2 kB" on the deploy card, "Upgrade" vs "Deploy again", "faucet" and "request CELO" (`turn-view.tsx:126`, `chat-panel.tsx:206`, `deploy-modal.tsx:178–186`).
14. A long quiet wait shows only "Thinking 1:12" for up to 90 seconds before the calm note (`turn-view.tsx:371`).

### What already works well (keep it)
"Your files are saved", the first-wait lines, the credits pause card, refunds said in plain words, the plan-first questions, and D162's hiding of failed and no-change edits.

## Part 2. What GPT Engineer and Codex have that helps

PR #170 already took their token techniques. This part covers their other tools, judged only on one question: does it help a person who doesn't code get a working app? Sources are each project's docs and repo, plus third-party write-ups (marked).

| Tool | Have we got it? | Decision |
|---|---|---|
| **Codex `update_plan`**: a live checklist, one step in progress at a time | Half: `set_plan` and the spec write the steps, but Build mode doesn't show them | **Take (A1)** |
| **Codex turn summary**: what changed and what was checked | Half: milestone text is jargon | **Take (A2)**, as "Works now / Not yet / Next" |
| **Codex undo** | Only through the Versions menu | **Take (A3)** |
| **Codex best-of-N** (`--attempts` 1–4; third-party sources disagree on how one is picked) | No | **Skip:** costs N times as much, and picking between code versions is a developer's job |
| **Codex Ask vs Code** | Yes: Plan / Build | **Explain it on screen (A4)** |
| **Codex `/review`, `view_image`** | Yes: the visual review (D87, D162) | Keep; one check line (A5) |
| **Codex AGENTS.md**: lasting project notes | Yes, but hidden (P17 memory decisions) | **Show them (B4)** |
| **GPT Engineer clarify** | Yes: plan-first questions | Keep |
| **GPT Engineer self-heal** (10 tries, per a third-party mirror; UNVERIFIED for the current release) | Yes, and more | Keep |
| **GPT Engineer file selection, preprompts** | No | **Skip:** they ask a non-coder to know their files or edit settings |

## Part 3. The work (one PR, D164)

### A. While it builds, and when it's done
- **A1. The plan as a live checklist, with one trail line.** As in the mock:
  - The plan's steps become the checklist. GoodBuild adds its own last step, "Checking it works on a phone and a computer". One step spins at a time; finished steps get a tick; a "Step 2 of 5" counter sits on top.
  - Under the current step, **one line** says what's happening in plain words ("Building the add-goal form"), with the file name faint at its end. When that part is done, the line fades out upward and the next one slides in. Nothing piles up.
  - Before the plan exists, the same single line runs under "Planning your app".
  - **How the server knows the step:** each step row records which plan step it belongs to (a new `plan` field on `Step`). A file whose name matches a later plan step moves the checklist there; the step's route or contract name before its colon counts ("GoalList.tsx" matches "Goals: add and list goals"). It only moves forward. The checks after the build move it to "Checking it works". There's no new tool and no extra model call. **UNVERIFIED:** how often names match on real builds. When nothing matches, the checklist stays on the step it's on until the checks.
  - Spec plan steps lose their route or contract-name prefix on screen ("/goals: Add and list goals" shows as "Add and list goals").
  - When the build is done, the checklist folds into "All 5 steps done", and every plain step row is inside it for anyone curious.
  - Turns saved before this have no `plan` field on their steps, and keep today's step rows.
- **A2. A clean finished build** (the owner, after the mock's version 4: "I'd like to see the response in a much cleaner way"). It has a "Ready to try" pill, one headline, and a short list: what works (ticks) and what comes later (an empty circle). Under that, one "Next: …" button and one quiet footer line with the check, the steps (folded), the cost and Undo. The builder gives the list through `suggest_next` (`works`, `later`); a milestone build writes the headline and "later" itself. Milestones get plain names: "Your app's screens", "Connect a wallet", "Play with others", "Sign-in and saved data", "Payments on Celo".
- **A3. "Undo this change"** on the latest build, with an in-page confirm ("Your app goes back to how it was before this message. The chat stays."). It costs nothing and uses the existing `ws.revert`. The Versions confirm says "Go back to v3?" instead of "Revert".
- **A4. Plan / Build in words:** a visible one-line hint under the toggle ("Plan: talk it through, nothing changes" / "Build: changes your app"). The name "Plan" stays.
- **A5. One check line:** "Checked on a phone and a computer: looks right", or "…: fixed 2 things". No pixel widths.
- **A6. Plain words for every step**, mapped from file roles: screens and components become "Building the goal card"; the wallet layer becomes "Connecting the wallet"; styles become "Choosing colours and layout"; a package becomes "Adding a building block"; delete and rename become "Tidying up"; guide reads are hidden. A test checks that no step label shown to a person contains a file extension. Done on screen from the saved labels, so old turns read plainly too.
- **A7. Fixes in plain words:** "Fixing a small thing it found" in the trail line; "Fixed 3 problems by itself" at the end, or "3 problems still need a fix". "Failed" and "errors" are no longer shown.

### B. One problem card, one button
- **B1. One card per turn, one button: "Fix it for me".** Whatever went wrong (the build stopped, it still needs a fix, the preview crashed, or all three), the latest turn shows one card:
  - A plain headline ("Your app isn't finished yet"), one or two sentences saying what happened and that it wasn't their fault when it wasn't, and that their files are saved.
  - The button always means "continue from my saved files and fix everything that's wrong". It's a retry of the failed build, and it carries the preview error, if there is one, into the builder's notes, so one press fixes both. The retry endpoint gets an optional `note` (up to 3,000 characters), added to the draft's diagnostics.
  - With no failed build (only a preview crash), the same card and button send today's fix message.
  - The preview's own error notice is hidden while this card shows. The automatic fix of a preview error right after a build (`shouldAutoFix`) still runs first, so the card only appears when that didn't work.
  - A build paused for credits keeps its own words and its "Continue · ≈ cost" button. That's a different situation, and the person has to top up first.
- **B2. No dead end on the second try, and no talk of free fixes.** The button is always just "Fix it for me". The estimated credit cost shows where costs already show, in the line beside the prompt box (`chat-panel.tsx:413–417`). Nothing on screen mentions a free repair or an allowance. When GoodBuild's repair allowance covers the fix, nothing is charged. When it doesn't, the fix runs on credits, as the cost line said. The refusal sentence and the separate "Continue using credits" button go. If the person can't afford it, the existing out-of-credits card shows, as for any build.
- **B3. Plain words for unexpected errors.** Known causes (lost connection, the AI provider down, a timeout, saved progress that no longer fits) each get one sentence. Anything unknown becomes "Something went wrong on our side." The raw message stays in the log and the server logs.
- **B4. Technical text behind one fold,** "Technical details (for support)". It replaces "Logs" and holds the preview error's file, line and message too.
- **B5. What GoodBuild remembers about this app**, shown as a short list ("Brand colour #0f766e", "Tips at least 5 G$"), each with a remove button. These are the P17 memory decisions, invisible today. If removing needs more than a small route, it ships read-only and removal goes in OPEN_QUESTIONS.md.

### C. Web3 words
- **C1.** The deploy card drops "kB" and says "one signature". "Upgrade" becomes "Update your live contract". The faucet guide is renamed "Get free test money", and Sepolia is explained once as "Celo's free test network".

### D. Finish
- Tests for each item:
  - the plan-step matching;
  - the trail line;
  - the no-file-extension rule;
  - one card with one button, carrying the preview error;
  - the retry `note`;
  - the second try running on credits instead of being refused;
  - the error mapping;
  - undo.
- `pnpm test:suite`, `pnpm lint`, `pnpm typecheck`.
- D164 in DECISIONS.md, a HANDOFF.md entry, and this file marked built.
- All UI follows DESIGN_SYSTEM.md (D12): existing tokens and components, and motion only on the trail line (200 ms in and out), off when the person prefers reduced motion.

### Not taking
Best-of-N, file selection, editable preprompts (reasons in Part 2).

## Decisions taken
- **One PR for all of it:** the owner.
- **One problem card with one button:** the owner ("two buttons would confuse the users").
- **File names stay, faint, at the end of the trail line:** the owner approved the mock with them.
- **"Plan" keeps its name and gets a visible hint:** Claude's pick, not objected to.
- **Undo is free, with a confirm:** Claude's pick, not objected to.
- **Built on top of PR #170:** it is merged, so this branch starts from main.
- **The second repair runs on credits from the same button; the cost shows only in the line beside the prompt box, and free repairs aren't mentioned:** the owner ("no need to show free fix, just show the credit cost in the text area").
