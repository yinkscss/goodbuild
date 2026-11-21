# Builder reliability and token plan (one PR)

Date: 21 Nov 2026 · Proposed by: Claude · Asked for by: the owner, after the failed savings-goals run · Status: approved by the owner ("go, build the whole plan") and built on 21 Nov 2026 as D162. Measured: [evals/REVIEW_DEEPSEEK.md](evals/REVIEW_DEEPSEEK.md) (the review stays at high detail).

## Goal

Someone who knows nothing about software describes a web3 app and gets a working one. They never see a technical error, never get stuck on a check that was wrong, and never have to know what a setting is. The builder fixes its own mistakes, tries a different way when a fix doesn't work, and spends far fewer tokens doing it: Sonnet plans and writes contracts, DeepSeek does everything else.

How we will know:
- Every build logs and saves its tokens by step and by model (item A1), so savings are measured, not guessed.
- Targets, to be checked with A1 on a live build after deploy (estimates, not measured yet): Sonnet input under about 80K tokens for a milestone build, and each DeepSeek fix call under about 20K input tokens.
- The savings-goals request from the failed run builds all three milestones without a dead end.

## Already on the branch (commit 379e90b)

1. The wallet check accepts the full address or the short form, and test flows never block a build.
2. No v2 settings: the limits are in code, and `ACCEPTANCE` is gone.
3. Fix steps show what is happening inside them ("Working on it: Checking the app").
4. Sonnet plans once per app (3 rounds at most), and DeepSeek fixes the code it wrote.

## What we learned

**GPT Engineer** (open source; Lovable grew out of it. Lovable's own code is not public, so it was not studied):
- Every step is a new, short conversation: instructions, only the files the step needs, the task.
- A fix gets the error output and the files with line numbers, not the history.
- When some edits fail, the good ones are kept and only the failed ones are asked for again.
- Tokens and cost are logged per step.
- Pictures go in once, at OpenAI's "low" detail (a flat 85 tokens).

**Codex**:
- Long tool output is cut to its start and end as soon as it arrives.
- Near the context limit, the model writes a handoff summary and the conversation restarts from it.
- When over the limit, the oldest items go first, so the cached start stays the same.
- Pictures are shrunk to 2048px at most, replaced by a note when too big, and dropped at compaction.

**Our builder**:
- We already trim earlier phases like Codex (D152).
- But every phase shares one conversation. Each call resends about 6K tokens of instructions (measured: 23,427 characters) and up to about 10K tokens of files (a 40,000-character budget), plus history. A build of 90 calls can pass 1.5M input tokens (estimate).
- Pictures: a design reference is described in text once, on upload. In the build, up to 2 full pictures are then resent on every call of that build.

**Picture settings** (checked 21 Nov 2026):
- DeepSeek's API takes `detail` per picture (`low`, `high`, `original`, `auto`), per [its vision guide](https://api-docs.deepseek.com/guides/vision). The installed `@ai-sdk/deepseek` 3.0.79 passes it as `providerOptions.deepseek.imageDetail`.
- Third-party posts say `low` is 512x512; UNVERIFIED, to be measured with the proxy's DeepSeek access.
- Anthropic's [vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) show no detail setting. Pictures are counted in 28px patches and capped (1568px edge on the standard tier), so the lever for Sonnet is how often a picture is sent, not its detail.

**From the failed run, still open after 379e90b**:
- "1 type error noted": type errors are only noted (`TYPE_CHECK=warn`), never fixed.
- Many "Writing X" steps changed nothing (an edit that matched but made no change), and each cost a round.
- Raw errors were shown to the person ("Edit 3: "search" text was not found").
- The wallet milestone refused an edit to `useWallet.ts` and told the builder to ask for the on-chain milestone. That is the wrong advice: that file is GoodBuild's wallet layer, which already works.
- The auto-fix gave up after 1 attempt because the same error came back.
- The planner offered "Sign in with a username and password". GoodBuild apps sign in with the wallet (D31).
- An empty code box showed in the reply.
- The visual check is off in production (`VISUAL_REVIEW` defaults to off).

## The work, all in one PR

### A. Fewer tokens

- **A1. Token report per build.** One log line and a saved summary on the build: input, cached and output tokens by step (spec, contracts, build, fix, review, visual fix) and by model. Done first, so the rest is measured.
- **A2. Short conversations for focused jobs** (GPT Engineer):
  - The contracts phase (Sonnet) gets only the contract instructions, the spec and the contract files.
  - Each fix attempt gets the error list, the files the errors name with line numbers, and a short summary of the spec.
  - The fix after the visual check works the same way.
  - Resuming a stopped build still replays saved calls: each focused conversation is saved and checked on its own.
- **A3. Cut long tool output when it arrives** (Codex). Check reports, test output and big file reads over about 6,000 characters keep their start and end. After a repeated failed edit, the builder gets the lines around where its edit should go, not the whole file.
- **A4. Trim inside long phases.** Every 10 rounds, file text written earlier in the same phase becomes a short note ("read the file for its current text"). The project's files are the record, so no model call is needed for a summary. The trim point moves in steps, so the cache keeps working.
- **A5. Pictures only where they help, at the right detail.**
  - A design reference goes to the spec step and the first front-end call only. After that, its text description (already written on upload) stands in, and the description is saved into the app's spec.
  - DeepSeek calls use `low` detail where the job is only "is the page blank or broken" (the check in the person's browser), and `high` where text size and colours matter (the visual review, describing a design reference).
  - Sonnet has no detail setting, so it sees each picture once.
- **A6. Keep the good edits** (GPT Engineer). When some edits in a batch fail, the ones that match are applied and the builder is asked only for the failed ones, with the nearest real text. An edit that changes nothing is told "the file already says this" and is not shown as a step.

### B. Visual check on DeepSeek, on for every build

- **B1.** The review runs on DeepSeek (thinking off, `high` detail) instead of Sonnet.
- **B2.** Guards against false reports, the reason Sonnet was used before:
  - at most 3 problems, each naming the screen and where on the page;
  - the prompt lists the false reports seen before (HARNESS.md "Weak spot");
  - one fix pass on DeepSeek;
  - if that pass breaks a check, the page goes back to how it was (this already happens).
- **B3.** It runs on every build where the run check runs. The `VISUAL_REVIEW` setting is deleted.

### C. No dead ends for people who don't code

- **C1. Type errors get fixed, never block.** Type errors in files the builder wrote get one DeepSeek fix attempt. If any remain, the build still finishes, like test flows. The `TYPE_CHECK` setting is deleted (always this mode).
- **C2. Try a different way before giving up.** When the same error comes back, the next attempt gets a fresh, short conversation: the full files the error names, what the last fix changed, and "that didn't work, take a different approach". The fix loop stops only when that fails too, or when two attempts in a row make no progress (the existing rule).
- **C3. Plain words on screen.**
  - A failed edit shows as "Trying that change again", not the raw error.
  - Refusals and stops are explained in everyday words.
  - The final message says what works, what doesn't yet, and offers one "Try again" button.
- **C4. The right advice in the wallet milestone.** An edit to GoodBuild's wallet layer (`useWallet.ts`, `chain.ts`) is refused with "this already works; use it like this", plus what it gives (account, connect, disconnect, network). It no longer says to ask for the on-chain milestone.
- **C5. The planner never offers username and password sign-in.** Sign-in is with the wallet, and saved data uses the app data store (D31).
- **C6. No empty code boxes.** Empty code fences are removed from replies before they are shown or saved.

### D. Finish

- **D1.** Delete `VISUAL_REVIEW` and `TYPE_CHECK` from `deploy/docker-compose.yml`, `.env.example` and the docs. Settings that connect servers (the checker's address, how many checks run at once) stay, because they are wiring, not choices.
- **D2.** Tests for every item:
  - a scripted replay of the savings-goals run through all three milestones;
  - a live DeepSeek check of the visual review and of `low` against `high` detail, through the session's DeepSeek access.
  - Then the full suite, lint and the type check.
- **D3.** A DECISIONS.md entry and a HANDOFF.md update.
- **D4.** Anything else found while building that would stop a person's build gets fixed in this PR and listed in it.

## Not taking

- **Codex's model-written summary:** an extra paid call each time. Our files are the record, so a free note does the same job.
- **GPT Engineer's diff format:** our find-and-replace edits are more reliable with these models.
- **Lovable:** its code is not public.

## Order inside the PR

A1, then C5, C6, C4 and C3 (small), then B, then A2, A3, A4, A5 and A6, then C1 and C2, then D. Merging deploys to production, so nothing merges until the owner says so.
