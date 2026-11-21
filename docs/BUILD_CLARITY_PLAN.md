# Build clarity plan: what confuses a non-technical person, and what to borrow from GPT Engineer and Codex

Date: 21 Nov 2026 · Written by: Claude · Asked for by: the owner ("be honest... what part can confuse a non-technical person") · Status: **proposed, not built**. Continues from PR #170 (D162), which made the builder fix its own mistakes; this plan is about what the person *sees* while it does.

Every finding below names the code that produces it, read on branch `claude/elegant-pasteur-j73em3` (PR #170 head, commit 06e75e0). Nothing here was tested with real users; "confusing" is Claude's judgement against the goal in BUILDER_RELIABILITY_PLAN.md: *someone who knows nothing about software never sees a technical error and never has to know what a setting is.*

## Part 1. The honest audit

Ranked by how likely a person is to be lost or worried by it.

### High: they will not understand, and it looks like something broke

1. **File names as progress.** During a build the step list says "Writing App.tsx", "Writing useWallet.ts", "Deleting Hero.tsx", "Renaming utils.ts", "Adding wagmi", "Adding the minipay kit", "Reading the visual-design guide" (`toolLabel`, `src/server/agent/runner.ts:1983`). A person doesn't know what `.tsx` is, and "Deleting" reads like losing work. Only `.sol` files and compile/test steps get plain words (`plainStepLabel`, `turn-view.tsx:19`). The builder already writes a plain plan with 2–6 steps (`set_plan`, `prompt.ts:14`), but in Build mode that plan is never shown; it's only rendered in Plan mode (`turn-view.tsx:384`).
2. **Raw errors in the "This build stopped" card.** Any unexpected error shows `error.message` as is (`runner.ts:1311–1318`), so a person can read "fetch failed", "ECONNRESET", a database error or a provider message. Resume errors are half-plain ("the saved progress no longer matches this build's steps").
3. **The milestone sentence.** At the end of a milestone build the reply says, for example, "Working first interface: implementation saved; live behaviour still needs verification. Live payments remain disabled. Still to finish: Wallet connection, Remaining integrations" (`runner.ts:1261`). "Implementation", "live behaviour", "verification", "browser acceptance passed" and "integrations" are developer words. Under it, a grey line says "Local/demo milestone · Remaining: …" (`turn-view.tsx:398`).
4. **Milestone titles as suggestion buttons.** The next-step chips are the milestone titles (`runner.ts:1262`, `delivery.ts:3–11`): "Remaining integrations", "On-chain features and payments". A person can't tell what tapping them will build or cost.
5. **The preview error card.** It shows the file and line and the raw message in a code font: "The preview hit an error in src/components/Board.tsx:42 · TypeError: Cannot read properties of undefined (reading 'map')" (`preview-error-notice.tsx:10–16`). The "Fix it" button is right, the words above it are not for this person.
6. **"Logs" on the error card.** One click opens the raw build log, with ✓ ✗ ! marks, file paths and tool names (`turn-view.tsx:166–171`). It's folded away, which is right, but it's the most visible thing on a failed build after the button.

### Medium: they'll guess, and may guess wrong

7. **"Auto-fix: failed · Failed after 2 attempts: 3 errors left"** (`runner.ts:1219–1221`). "Errors" sounds like *they* did something wrong, and "failed" twice in one row is alarming next to a card that says the files are saved.
8. **Two checks with two names.** "Visual check: the preview looks right at 390px" (`VisualCheckNote`) and "Looked at the page on a phone and a computer" (`ReviewNote`) are different checks that a person sees as the same thing. "390px" means nothing to them.
9. **Plan / Build toggle beside the prompt** (`chat-panel.tsx:392–400`). The difference is only in a hover title ("Plan mode answers and drafts a plan without changing files"), which phones never show.
10. **Cost line.** The hover title says "AI cost + 25%" (`chat-panel.tsx:417`). Fair and honest, but "+25%" without "that's GoodBuild's fee" reads like a hidden charge. Also hover-only.
11. **Versions.** A small "v4 · auto-saved" pill opens a "Versions" menu whose confirm says "Revert to v3?" (`workspace.tsx:210–235`). It works, but it's hidden in a pill, and "revert" is a developer word. There's no "Undo this change" next to a build that went wrong, which is the moment someone needs it.
12. **Code and Contract tabs** next to Preview (`preview-panel.tsx:26`). Harmless, but a person who opens them sees a wall of code and may think they're meant to edit it.

### Low: web3 words that are hard to avoid, but can be softened

13. **Deploy card and modal:** "1.2 kB", "Celo Sepolia", "faucet", "request CELO", "mainnet", "Upgrade" vs "Deploy again" (`turn-view.tsx:126`, `deploy-modal.tsx:178–186, 861`, `chat-panel.tsx:206`). The faucet guide is good; "kB" and "Upgrade" are not needed.
14. **Long quiet waits.** The quiet note appears after 90s (`turn-view.tsx:371`), which is right, but in that time the only thing on screen is "Thinking 1:12". The plan steps (item 1) would fill that gap.

### What already works well (keep it)
The failure card's "Your files are saved. Tap Try fix…", the first-wait lines ("Lining up your first build", "you can close this tab"), the credits pause card, refunds said in plain words, the plan-first questions with chips, and PR #170's hiding of failed and no-change edits.

## Part 2. What GPT Engineer and Codex have, and whether it helps us

PR #170 already took their context and token techniques (short focused conversations, cut long output, keep good edits, per-step token report). This part is the *other* tools, judged only on "does it help a person who doesn't code get a working app".

Sources: GPT Engineer's repo and docs, Codex's docs and changelog, plus third-party write-ups (marked). Lovable's own code isn't public, so it's not covered.

| Tool | What it does there | Have we got it? | Take it? |
|---|---|---|---|
| **Codex `update_plan`** | A live checklist the model ticks off: each step pending, in progress or done, one at a time. | Half. `set_plan` writes 2–6 steps, but Build mode doesn't show them or tick them. | **Yes (A1).** Fixes audit items 1 and 14. |
| **Codex turn summary** | Ends a task with what changed and what was checked, citing the evidence. | Half. The reply text is free-form; milestone text is jargon. | **Yes (A2)**, in plain words: what works now, what doesn't yet, what's next. |
| **Codex undo / GPT Engineer's "keep or discard" in improve mode** | Revert the last turn in one step. | Versions menu only. | **Yes (A3):** an "Undo this change" button on the latest build, restoring the version before it. |
| **Codex best-of-N (`--attempts`, 1–4)** | Runs the same task several times and lets you pick. (Third-party sources disagree on whether picking is manual.) | No. | **Not now.** It multiplies cost by N, and choosing between code versions is a developer's job. Our "try another way" retry (D162 C2) is the cheap version. Revisit for first-build *designs* only, shown as pictures. |
| **Codex Ask vs Code modes** | Ask answers without changing files. | Yes: Plan / Build. | **Rename and explain (A4)** in visible words, not a hover title. |
| **Codex `/review`** | A second pass that looks for bugs before you merge. | Yes: the visual review (D87, D162) and checks. | Keep. Merge the two check notes into one line (A5). |
| **Codex `view_image`** | The model looks at a screenshot itself. | Yes (visual review, design references). | Keep. |
| **Codex AGENTS.md** | Lasting project instructions the agent reads every time. | Yes: memory decisions list (P17) and the app spec. | **Small add (B1):** show the person the remembered decisions ("Brand colour #0f766e, tips at least 5 G$") so they can see and remove them. Today they're invisible. |
| **GPT Engineer clarify mode** | Asks questions first; Enter means "make your own assumptions". | Yes: plan-first questions and "Skip, just build it". | Keep. |
| **GPT Engineer self-heal** | Runs the code, feeds errors back, up to 10 tries (per a third-party mirror of its code; UNVERIFIED for the current release). | Yes, and more (run check, visual review, retry another way). | Keep. Our cap stays lower on cost grounds. |
| **GPT Engineer file selection in improve mode** | The person ticks which files the AI may touch. | No. | **No.** It asks a non-coder to know their files. Our milestone scope does this for them. |
| **GPT Engineer preprompts** | Editable instructions that set the AI's identity. | Server-side prompts. | **No.** A setting by another name. |
| **GPT Engineer benchmarks / Codex evals** | Fixed task sets scored automatically. | Partly: `docs/evals`, eval suite. | Already planned (Q42); not part of this PR. |

## Part 3. The work (one PR, after the owner says go)

### A. What a person sees during and after a build
- **A1. Show the plan as a live checklist in Build mode.** The `set_plan` steps (already plain, already written) become the top of the step list, each with its own dot: waiting, working, done. File-level steps fold under the current plan step as small "details", in plain words (A6). The builder is told to say which plan step it's on when it starts writing for it (a `step` field on edits, or a light `update_plan`-style call that costs one short tool call). If the builder never calls `set_plan` (a small change), today's list stays.
- **A2. A plain end-of-build summary.** Replace the milestone sentence (`runner.ts:1261`) and the "Local/demo milestone · Remaining" line with three short lines: *Works now*, *Not yet* and *Next*. Example: "Works now: the savings goals screen, adding and removing goals. Not yet: connecting a wallet; payments are switched off until then. Next: Connect a wallet." Milestones get plain titles: "Your app's screens", "Connect a wallet", "Play with others", "Sign-in and saved data", "Payments on Celo".
- **A3. "Undo this change"** on the latest build's reply, restoring the version before it, with a confirm ("Your app goes back to how it was before this message"). Uses the existing `ws.revert` (`workspace.tsx:233`). The Versions confirm says "Go back to v3?" instead of "Revert".
- **A4. Plan / Build in words.** Keep the toggle, add a visible one-line hint under it on phones and computers: "Plan: talk it through, nothing changes" / "Build: changes your app". Rename Plan to "Talk" only if the owner wants (open choice).
- **A5. One check line.** Fold the visual check and the review into one quiet line: "Checked on a phone and a computer: looks right" or "Checked on a phone: fixed 2 things". No pixel widths.
- **A6. Plain step words everywhere.** Extend `plainStepLabel` and `toolLabel` with a small map from file roles to words: page and component files → "Building the {Name} screen/part"; `useWallet`/`chain` → "Wallet connection"; styles → "Colours and layout"; adding a package → "Adding a building block"; reading a guide → hidden. Delete and rename become "Tidying up". Add a test that no step label shown to a person contains a file extension.
- **A7. "Auto-fix" in plain words.** "Fixed 3 problems by itself" when it worked; when it didn't, one row: "3 problems still need a fix" (the card below already says what to do). Drop "failed" and "errors" from what's shown.

### B. Errors a person can act on
- **B1. Plain words for unexpected errors.** Map known causes (network, provider down, timeout, resume mismatch, database) to one sentence each plus "Try again". Anything unknown says "Something went wrong on our side. Your files are saved. Try again." The raw message stays in the log and in server logs.
- **B2. The preview error card in plain words.** "Part of your app crashed when it opened ({screen name if known}). Tap Fix it." The file, line and message move under a "Details" fold, like Logs.
- **B3. Rename "Logs" to "Technical details (for support)".** Same fold.
- **B4. Show remembered decisions** in the project's chat header or settings, with a remove button each (Part 2, AGENTS.md row).

### C. Web3 words
- **C1.** Drop "kB" from the deploy card; say "one signature" instead. "Upgrade" becomes "Update your live contract". Keep the faucet guide, but call it "Get free test money" and explain Sepolia once as "Celo's free test network".

### D. Finish
- Tests for every item, including the no-file-extension test (A6) and the error-mapping table (B1).
- `pnpm test:suite`, `pnpm lint`, `pnpm typecheck`.
- A DECISIONS.md entry, HANDOFF.md update, DESIGN_SYSTEM.md followed for all UI (D12: light bento, existing tokens and components only).

### Not taking (with reasons in Part 2)
Best-of-N, file selection, editable preprompts.

## Open choices for the owner
1. Go ahead with all of A–C in one PR, or A1, A2, A6, B1 first (the four that matter most)?
2. Rename Plan mode to "Talk"? (Claude's pick: keep "Plan", add the visible hint.)
3. Should "Undo this change" (A3) cost nothing and skip the confirm on the very latest build? (Claude's pick: free, with a confirm.)
4. Should this wait until PR #170 is merged? (Claude's pick: yes, build on top of it, because it touches the same step labels and failure card.)
