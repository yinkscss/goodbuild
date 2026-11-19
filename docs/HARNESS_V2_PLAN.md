# Harness v2: stronger planning, a Codex-style loop, real acceptance tests, a wider box

Written 19 Nov 2026 by Claude, at the owner's request ("write the four as a full plan, ship today"). Decision: [D152](DECISIONS.md) (proposed, changes D19). Everything ships **behind one flag, off by default**, so merging is safe and the owner turns it on for admin wallets first.

**Why.** The owner wants the builder to make apps that really work, not apps boxed into templates. Compared with OpenAI's open-source Codex harness (`openai/codex` at 27e16c0, read on 19 Nov 2026), GoodBuild differs in four ways that matter:

| | Codex | GoodBuild today |
|---|---|---|
| Who verifies | The model runs builds and tests itself, as often as it needs, and reads the output | `run_checks` at most 3 times a turn, all checks at once (`runner.ts:121`); after that the server checks |
| Who fixes | The same model, same context; its reasoning is carried between steps (`codex-rs/core/src/client.rs:1336`) | DeepSeek writes, Sonnet fixes by reading DeepSeek's transcript, with no reasoning carried |
| When it stops | When the work is done ("Persist until the task is fully handled end-to-end", `core/gpt_5_2_prompt.md:111`); context is summarised near the limit (`core/src/session/turn.rs:792-833`) | 20 rounds a pass, 50 calls a build (`runner.ts:94-106`); no trimming, every full file stays in the history |
| How "it works" is proven | The model writes and runs tests | Hand-written checks per app type (`delivery-check.ts:4` is tic-tac-toe only) |

And the prompt: Codex gives principles ("bold, a bit surprising", avoid Inter and purple, `core/gpt-5.2-codex_prompt.md:33`). Ours is 27k characters with exact Tailwind classes and layouts (`prompt.ts:122`), a starter in Inter, and 11 allowed npm packages plus three.js.

## The four workstreams

1. **Routing (WS1):** Sonnet plans the app and writes contracts and their tests; DeepSeek writes the front end; whoever wrote a file fixes it first.
2. **Codex-style loop (WS2):** finer tools the builder runs itself, no cap of 3 checks, limits set by spend and time instead of round counts, history trimmed between phases, cheaper Sonnet calls.
3. **Acceptance tests (WS3):** the plan writes browser flows for this app; the checker runs them; the builder runs them itself too.
4. **Wider box (WS4):** about 14 vetted packages, design rules about direction instead of classes, kits as options, `require` allowed again.

## Flag and rollout

- `HARNESS_V2=off|admins|on`. **Default `off`.** `admins` means only builds by a wallet in `ADMIN_WALLETS` (already an env setting) get v2. Read once per job when it is claimed and saved on the turn setup, so a resumed job keeps the mode it started with.
- Sub-flags, read only when v2 is on: `ACCEPTANCE=warn|enforce` (default `warn`), `V2_MAX_CALLS` (default 90), `V2_MAX_ROUNDS` (default 40), `CHECK_BUDGET_MS` (default 240000).
- **No database migration.** The spec lives in a project file (below) and in the turn record, both JSON already.
- `TURN_SETUP_VERSION` goes up by one. A job running on a worker during the deploy can't resume and ends with the existing "interrupted, Retry" message. Deploy when the worker log is quiet.
- **Rollback:** set `HARNESS_V2=off` and `up -d worker`. Nothing to undo in data.

**Today, in order:**

| PR | Contents | Risk | Ships behind |
|---|---|---|---|
| A | WS1 routing, WS2 loop and tools, WS2 caching and cache-write billing, prompt changes from WS4 (design rules, kits, `require`) | Highest: changes the core loop | `HARNESS_V2` |
| B | WS3 acceptance flows, in `warn` | Medium: new checker code | `HARNESS_V2` and `ACCEPTANCE` |
| C | WS4 packages | Medium: grows the publish runtime and its supply chain | The allowed list is global, but only v2 builds are told about the new packages |

Each PR: `pnpm check` green, then merge (which deploys with the flag off), then the owner sets `HARNESS_V2=admins` and runs the canary below. If A slips, B and C wait: they depend on it.

## WS1: routing

### What changes
New tiers in `TIER_FOR` (`src/server/agent/model.ts:15`), used only when v2 is on:

| Work | Tier | Model |
|---|---|---|
| `spec`: the app's plan and acceptance flows | strong | Sonnet 5.5, adaptive thinking (its default) |
| `contracts`: `.sol`, `contracts/test/*.t.sol`, `contracts/deploy.json` | strong | Sonnet 5.5 |
| `build`: everything in `src/` | cheap | DeepSeek Flash |
| `plan` (intake questions, plan mode), memory, naming | cheap | unchanged |
| first fix attempt | the tier that wrote the failing files | see below |
| later fix attempts | strong | unchanged |

### The spec call
- **When:** the first build after the plan-first questions; the start of each delivery milestone (D138); and any build turn whose project has contracts and whose request names contract work (the same word list `deliveryFor` uses for payments). Small follow-ups ("make the button bigger") skip it and work as today.
- **How:** one phase on the strong tier with read tools only (`read_file`, `search_code`, `find_symbol`, `list_files`, `read_guide`) and one new tool, `write_spec`. At most 6 rounds. The phase ends at `write_spec`.
- **`write_spec` schema:**
  - `summary`: what the app is for;
  - `direction`: the visual direction in a sentence;
  - `pages`: route, purpose, key elements;
  - `contracts`: name, purpose, state, functions with who may call them, events, invariants ("total out never exceeds total in");
  - `data`: app-data collections and their rules;
  - `acceptance`: the flows for WS3;
  - `outOfScope`: what this milestone leaves out.
- **Where it lives:** a platform-owned file `src/spec.json`, written by the runner like `src/contracts/`. The builder can read it; `pathProblem` refuses edits to it (the same treatment as `KIT_MARKER`). It is versioned with checkpoints, so Revert restores the spec that went with the code. The app never imports it, so publishing ignores it. `record.plan` shows its summary and steps on the plan card as today.
- **Context:** later turns get the spec in the context block (it is small) under "The app's spec".

### Contracts written by Sonnet, front end by DeepSeek
- When the spec lists contracts and the delivery scope allows them (`milestoneAllows`, `delivery.ts`), the build runs **two phases** before checking:
  1. **Contracts phase**, on the strong tier. Tools may write only `contracts/**`. It writes the contracts, their tests and `deploy.json`, then calls `run_tests` (WS2) until they pass.
  2. **Compile and write the ABI modules** (`writeContractModules`) before the front end is written, so DeepSeek imports a real ABI instead of guessing one.
  3. **UI phase**, on the cheap tier. Writes to `contracts/**` are refused with "Contracts are written in the contract phase. If one is wrong, say so in your reply." It ends with `open_app` and `run_acceptance` (WS2, WS3).
- A build with no contracts runs only the UI phase.
- **Credits:** `fitToCredit` may still move a strong call to the cheap model when credit is low (D138). That is logged as today, and the writer map (below) records `cheap` so fixes route correctly.

### Writer fixes first
- The runner keeps `authors: Map<path, ModelTier>`, set by every successful `create_file`, `edit_file` or `rename_file` with the tier of the phase. It is rebuilt the same way on a resumed run because replayed phases have the same tiers. Files from earlier turns fall back by path: `contracts/` is strong, everything else cheap.
- `fixTier` under v2:
  - attempt 1 goes to the tier that wrote every failing file;
  - a mixed set goes to strong;
  - attempt 2 and later go to strong, as today.

  The v1 `fixTier` and its tests stay for `HARNESS_V2=off`.
- The fix message goes into the same conversation as the phase that wrote the file, so the fixer has its own context. It is no longer a reader of someone else's transcript.

### Cost (estimates, not measured)
Sonnet 5.5 is $2 per million input tokens, $0.10 cached, $10 output (checked against Anthropic's current table today).
- **Spec call:** about 25k input plus 6k thinking and output, so about **$0.11**.
- **Contracts phase:** about 6 rounds with cached history and 10k output, so about **$0.20 to $0.30**.
- A contract build therefore adds about $0.30 to $0.40 and a UI-only first build about $0.11. Today's measured builds were $0.25 to $0.50, so v2 roughly doubles the cost of contract builds.

  Some of that comes back: fewer Sonnet fixes of DeepSeek's contracts ($0.44 of RTX run 4 was exactly that), and caching (WS2).
- Every call is still checked against the hold (D49), the free ceiling (D82) and sponsorship (D138); those bound the spend, not this estimate. **To measure in the canary.**

## WS2: Codex-style loop

### Tools the builder runs itself (build mode, v2 only)
| Tool | Does | Returns |
|---|---|---|
| `run_tests` `{ filter? }` | Compiles the contracts and runs the tests (all, or names containing `filter`) in the local EVM (`contract-tests.ts`, `scripts/evm-test.mjs`) | Compile errors, or each test with pass/fail and its revert reason |
| `open_app` `{ route? }` | Builds and opens the app in the run check's browser (`run-check.ts`) at phone width, on `route` | Uncaught errors and console errors with their source file, the visible headings, buttons, links and inputs (a text outline, capped at 4k chars), and the run check's own issues (blank page, game probe) |
| `run_acceptance` `{ flow? }` | WS3 | Each flow and step, pass/fail, and the page outline at the failing step |
| `run_checks` | As today: everything | As today |

- **No count cap.** Each tool reports its milliseconds; together they share `CHECK_BUDGET_MS` per turn (default 4 minutes). When it is used up, the tool answers "The check time for this turn is used up. Finish and reply; GoodBuild checks everything again at the end."
- `open_app` returns text only today. Returning its screenshot as an image to the builder needs image parts in tool results (`ChatMessage` tool content is a string). **Later**, not in PR A.

### Limits by spend and time, not rounds
- Under v2, `MAX_TOOL_ROUNDS_PER_PHASE` becomes `V2_MAX_ROUNDS` (40) and `MAX_CALLS` becomes `V2_MAX_CALLS` (90).
- Spend stays bounded per call by holds, the free ceiling and sponsorship. These already exist and are unchanged.
- The no-progress stops stay: 4 idle rounds, 4 failures on one file, the same errors twice, two stalled fix attempts. Codex lacks them; they are a good net for a cheaper model.
- **Owner call:** [PROGRESSIVE_DELIVERY.md](PROGRESSIVE_DELIVERY.md), approved today, says it "does not raise the 50-call ceiling". This does raise it, under v2 only.

### Prompt: carry the work through
In `systemPrompt` (`prompt.ts`), build mode under v2:

> Work until the app does what was asked: after contracts, run_tests until they pass; after the front end, open_app and fix what it reports; at the end, run_acceptance and fix what fails. Then reply.

This replaces "call run_checks once". The fix message keeps its rule against weakening tests.

### History trimmed between phases (Codex compacts; we trim)
- **What:** `requestView(convo, boundary)`, a pure function used when building each request. For messages before the current phase's start, it replaces:
  - the `content` of `create_file` calls, and the `edits` of `edit_file` calls on files changed since, with `[N lines written to path; read_file for the current text]`;
  - tool results over 12k characters, which are cut to head and tail.
- **Why only at phase boundaries:** the view must stay byte-stable within a phase so the prompt cache keeps hitting.
- **Why it is safe to resume:** `convo` itself is never changed, so the saved calls' `convoLen` check in `callModel` still holds and a resumed run sends the same requests.
- This removes the stale file copies the fixer used to read, and most of the cost of a long fix pass.

### Cheaper Sonnet calls
- **Cache the tail:** for strong calls, `toSdkMessages` also marks the last message with `cacheControl` (3 of the 4 allowed breakpoints: system, context, tail). RTX run 4 had 208k Sonnet input tokens with only 43k cached; the tail mark is what fixes that.

  **To check while building:** whether `@ai-sdk/anthropic` takes `providerOptions` on a tool-result message; if not, mark the last tool-result part.
- **Bill cache writes:** Anthropic charges about 1.25x input for tokens written to the cache. `costMicro` (`src/lib/pricing.ts:18`) and the usage mapping (`model.ts:150-160`) ignore them today.
  - Add `cacheWriteTokens` to the usage event and `cacheWritePerMTok` to `model-pricing.ts` (Sonnet: $2.50).
  - It lands in the existing cost columns, so there's no migration.
  - This touches D13 billing; it charges what the provider charges, plus the same markup.
- **Thinking:** Sonnet 5.5 thinks adaptively at effort `high` by default, which is what spec and contracts want. No setting needed today.
- **Later (not today):** carrying Sonnet's reasoning between tool rounds. That needs reasoning parts in `ChatMessage` and in saved calls. Codex does it; worth measuring after the canary.

## WS3: acceptance flows the plan writes

### Format
A small JSON language, not free code. The checker then runs nothing the model wrote except the app itself, and a broken flow is a validation error, not a crash.

```json
{
  "name": "Send a tip",
  "needs": "local",
  "steps": [
    { "goto": "/" },
    { "fill": { "label": "Amount" }, "value": "50" },
    { "click": { "role": "button", "name": "Send tip" } },
    { "expect": { "text": "Deploy the contract to go live" } }
  ]
}
```

- **Locators:** `text`, `role` plus `name`, `label`, `testid` (`data-testid`).
- **Steps:**
  - `goto`, `click`, `fill`, `press`;
  - `expect` with `text`, `hidden`, `count` and `route`;
  - `wait` (at most 2 s);
  - `connectWallet`, using the run check's stand-in wallet (D138 wallet acceptance).
- **`needs`:**
  - `local`: runs in the checker;
  - `wallet`: runs with the stand-in wallet;
  - `deployed`: needs a live contract, so it is listed as unverified and never run. A local chain in the checker is a later step; `src/server/deploy/local-chain.ts` may be a start.
- **Limits:** 8 flows, 20 steps each, 2 s a step, 20 s a flow, 60 s in all.

### Who writes and who runs
- **Written by** the spec call (Sonnet), before the UI exists, from the request and plan answers. The UI builder can't edit `src/spec.json`, so it can't make the test easier to pass. Flows name visible text and roles, which also holds the builder to the copy the spec chose.
- **Run by** a new `runFlows(page, flows)` in `src/server/agent/acceptance.ts`, called from `run-check.ts` when the project has a spec. It is also behind the `run_acceptance` tool.
- **Results:**
  - `ACCEPTANCE=warn`: failures are logged (`acceptance: 3 of 4 flows pass; "Send a tip" failed at step 3: no button named "Send tip"`) and shown to the builder by its tool, but don't block the build.
  - `enforce`: they go to the fix loop as `[acceptance]` issues, a new `CheckIssue` source.
- **Delivery:** a milestone counts as verified (`deliveryVerified`) when its flows pass. The tic-tac-toe checker stays for projects without a spec.

### Validation
`parseFlows` in `acceptance.ts` rejects unknown steps, too many steps, and empty locators. An invalid flow is returned to the spec call to fix while that call is still running.

## WS4: a wider box

### Packages (PR C)
Each one must meet all of these:
- browser-only, with no network calls of its own;
- MIT, ISC or Apache-2.0;
- React 18 compatible;
- types included (or added to `PLATFORM_DEPENDENCIES` for the type check);
- its publish-bundle size measured;
- loads in the Sandpack preview.

Versions are pinned exactly, the same in `publish-runtime/package.json` and `ALLOWED_DEPENDENCIES` (`template.ts:26-39`; a test already compares them). Exact versions, licences and sizes are **to check at pin time**.

| Package | For |
|---|---|
| `zustand`, `immer` | App state beyond a page |
| `zod`, `react-hook-form` | Real forms and validation |
| `recharts` | Charts (the dashboard kit stays for simple ones; its `replaces` entry for `recharts` goes) |
| `@dnd-kit/core`, `@dnd-kit/sortable` | Drag and drop: boards, builders, ranking |
| `matter-js` (+ `@types/matter-js`) | 2D physics in games |
| `howler` (+ `@types/howler`) | Game sound beyond `sound.ts` |
| `react-markdown` | Rich text people write (safe by default: no raw HTML) |
| `fuse.js` | Search in lists |
| `papaparse` | CSV import and export |
| `nanoid` | IDs |

- **Pinned (PR 3):** the versions, licences, sizes and the companion packages are in D152's PR 3 notes in [DECISIONS.md](DECISIONS.md). `@dnd-kit/utilities` was added as a companion; the dashboard and game-2d kits keep their `replaces` entries for v1, and v2 is told to add the package instead.
- Not added: `framer-motion` and `motion` (D84 chose the 3.5 kB motion kit for size), `phaser` and `@react-three/fiber` (kits cover them), map libraries (tile servers mean third-party requests from every visitor; a separate decision).
- The builder learns them through the `add_dependency` description and a short `packages` guide (what each is for, one example), only under v2.

### Design rules (PR A, v2 only)
- **Rewrite `DESIGN_RULES`** (`prompt.ts:122`) as direction, Codex-style:
  - choose a visual direction in the spec and commit to it;
  - expressive type, not Inter by default;
  - no purple or dark bias;
  - a few meaningful animations;
  - backgrounds with some atmosphere;
  - vary from app to app.
- **Keep:** theme tokens over raw palette classes, mobile-first at 375px, the main action above the fold, real copy, loading, empty and error states for every contract call, accessible labels.
- **Drop:** exact sizes and spacing classes, and the fixed layout recipes.
- **Starter theme:** the first build sets `--font-sans` and `--font-display` from the spec's direction (the `visual-design` guide lists the fonts). The starter's Inter (`template.ts:90-91`) stays only until that first build.

### Kits as options (PR A, v2 only)
- **No longer turned on by request words:** the capability kits, `motion` and `dashboard`. The builder calls `add_kit` when it wants them, and the prompt says kits are optional libraries, not required scaffolds.
- **Still turned on by the platform:** game kits (the run check's game probe needs them), MiniPay from the plan answer, the board and shop for MiniPay games, game templates picked in the plan, and gallery templates.

### Contracts (PR A, v2 only)
- **Allow `require(condition, "message")` again.** The custom-errors-only rule is house style. `checks.ts` already separates it from the security checks (`securityOnly`, `checks.ts:195-256`), and it sends the builder round the fix loop for nothing.
- **Keep every security guardrail:** no assembly, `delegatecall`, `selfdestruct` or `tx.origin`; OpenZeppelin imports only; the exploit tests and the mainnet gate (D107, D110).

### Not changed: no backend (D3)
The owner's fixed decision D3 is the largest limit on how ambitious apps can get. It stays; worth a separate conversation.

## Tests

**PR A** (scripted model, `fake-model.ts` and `runner.test.ts` patterns):
- v2 off: today's behaviour, and every existing runner test passes unchanged.
- First build with a contract runs spec, contracts (strong), compile, UI (cheap), checks, in that order; the ABI modules exist before the UI phase starts.
- The UI phase can't write `contracts/**`; the contracts phase can't write `src/**`.
- `fixTier` v2: a UI-only failure goes to cheap first, a contract or test failure goes to strong, a mixed set goes to strong, attempt 2 goes to strong.
- `requestView` is stable within a phase. A run that crashes mid-UI-phase and resumes sends byte-identical requests (`convoLen` holds) and bills nothing twice.
- The check budget refuses tools after `CHECK_BUDGET_MS`. Raised limits apply only under v2.
- `toSdkMessages` marks at most 3 breakpoints, with the tail marked only for strong calls. `costMicro` prices cache writes.
- Admins mode: an admin wallet gets v2 and another wallet gets v1, saved on the setup.
- `require` with a message passes under v2 and still fails under v1.

**PR B:**
- `parseFlows` accepts and rejects the right shapes.
- `runFlows` against small fixture apps in headless Chromium: a passing flow, a missing button, a wrong text, a flow that needs a wallet, a `deployed` flow that is skipped.
- `warn` doesn't block; `enforce` sends `[acceptance]` issues to the fix loop.

**PR C:**
- The pin test (publish runtime equals the allowed list).
- Each package bundled by the publish bundler and opened in the run check.
- The size of the runtime pack before and after.

**Live in this session:** DeepSeek is reachable here, Anthropic isn't. So the cheap paths can be run live here; the Sonnet paths are first run live by the owner's canary.

## Canary (owner, after each PR, with `HARNESS_V2=admins`)

1. **New dApp:** "A G$ savings circle for 5 friends, weekly 50 G$". Expect `spec:` in the worker log, the plan card from the spec, and an interface milestone that passes its flows.
2. **Continue to the payments milestone:** expect `phase: contracts (strong)`, tests passing before `phase: ui (cheap)`, and any fix routed by writer (`fix tier: cheap (writer)`).
3. **Small edit:** "make the main button bigger". Expect no spec call, DeepSeek only, and about today's cost.
4. **A game:** "catch falling mangoes, faster over time". Expect the game probe and the acceptance flows both run.
5. **A dashboard that uses `recharts`** (after PR C).

Record for each: the cost in the chat, the time, fix attempts, flows passed, and whether it looks and works right. Then decide `HARNESS_V2=on`.

## What the owner decides (D152)
1. The routing change to D19 (Sonnet for spec and contracts, writer fixes first).
2. Raising the call and round limits under v2, against PROGRESSIVE_DELIVERY's 50-call line.
3. The package list.
4. Allowing `require` again.
5. Acceptance in `warn` first, then `enforce` after the canary.
