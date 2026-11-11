# The eval suite

Twenty-one real builds, run with real model keys and scored, so a change to the builder's prompt, guides, checks or model routing shows up as numbers before it reaches users. Decision: D70. The older, hand-run scenarios are in [HARNESS.md](HARNESS.md).

## What it runs
[suite/suite.json](suite/suite.json): each scenario is a fresh project and a throwaway wallet.

| Kind | Count | Passes when |
|---|---|---|
| `build` | 15 (10 dApps, 4 websites and pages, 1 game) | the turn ends ready and the built app opens in the run check |
| `edit` | 4 | a build, then a change to it, both ready |
| `refuse` | 2 | the builder answers and writes no files |

The plan-first questions (D32) are skipped with the product's own "Skip, just build it", because the suite measures building.

## What it reports
- Scenarios passed.
- Builds that were clean on the first try, and fix attempts.
- How often the builder ran the checks itself (`run_checks`, D68).
- Cost, and the share of it spent on the fix model.
- Per scenario: result, fixes, cost, time and why it failed.

With a baseline, the run **fails** when the pass rate falls by more than 10 points or the cost per scenario rises by more than 30%.

## Running it
**On GitHub** (`.github/workflows/evals.yml`), never by itself, because it spends a few dollars a run:
- Actions tab → Evals → Run workflow. `only` takes scenario ids; `update_baseline` saves the run as the new baseline (download `baseline.json` from the run's files and commit it).
- `visual_review` turns on the review (D87) for that run. Run the suite once with it and once without, and compare the pass rate and the cost per scenario.
- Or add the `evals` label to a pull request.
- It needs `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` as repository secrets. Without them it says so and runs nothing.
- The server it starts caps its own spend at $15 a run (`FREE_AI_BUDGET_MICRO`).

**Locally**, against a server you started with keys, `RUN_CHECK=1` and raised caps:
```bash
BASE_URL=http://localhost:3000 node scripts/eval-suite.mjs --only tip-jar,coffee-site
```

## What has and hasn't been checked
- The scoring is unit-tested (`src/server/agent/eval-suite.test.ts`).
- The runner was driven end to end on 10 Nov 2026 against a local server with the demo model, the run check and the type check on: three scenarios, five turns, with results, costs and the summary written. The demo model always builds the same tip jar, so that run proves the plumbing, not the builder.
- **UNVERIFIED:** a run with real models, the workflow on GitHub, and what a full run costs. There is **no baseline yet**: the first real run should be saved as one.
