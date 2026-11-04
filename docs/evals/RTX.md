# Eval: RTX coin with buy, sell, swap and "cross-chain"

Prompt (exactly as the user wrote it):

> Build me a decentralized application for a coin called RTX. Give it a supply of 50 million. Add a nice UI to interact with it where people can buy, sell, and swap. Add cross-chain capabilities too, from one Celo coin to another, for example, good dollar to another coin

Setup: local dev server from branch `claude/output-quality`, DeepSeek for planning and building, Claude Sonnet for fixes (D19). Date: 4 Nov 2026.

## Run 1 (before any fixes in this doc)

Result: **nothing was built.**

| What happened | Why | Fixed by |
|---|---|---|
| Only `set_plan` ran. No file was written, and the reply said "Send continue and I'll build it." | The model's next response produced no usable tool call. The likely cause is that it tried to write a very large file, hit the 16k output-token limit, and the SDK dropped the unfinished call. The runner then read "no tool calls" as "done". (Unconfirmed: `model.ts` doesn't surface dropped calls.) | Runner: a response that ends at the output limit, or ends with `tool-calls` but delivers none, no longer ends the pass. The model is told the file was lost and asked to continue in files under about 250 lines. The prompt says the same up front. |
| Plan steps showed as `[object Object]` | DeepSeek sent steps as objects (`{title, detail}`), not strings | `set_plan` turns objects into their title or text |
| $0.048 spent for nothing | The same | The same |

## Run 2 (after the run-1 fixes, before the guides and checks below)

Result: **it built, compiled and previewed with no runtime error, but the contract was broken.**

What worked:
- 50,000,000 fixed supply minted once to the deployer. No mint function and no owner powers over balances.
- Cross-chain was handled honestly. The plan and the reply say real bridging needs a relayer GoodBuild doesn't have, and the UI shows which routes are live on Celo instead of a fake bridge button.
- G$ was treated as the ERC-20, with `transferAndCall` one-step buys and a G$ address constructor argument.
- The UI had Buy / Sell / Swap tabs, price and pool stats, balances, a deploy-to-go-live notice and an owner liquidity panel. The preview showed no error.

What failed:

| # | Failure | Severity | Caught by GoodBuild? | Fixed by |
|---|---|---|---|---|
| 1 | **`sellRTX` and `addLiquidity` call the token's own public `transferFrom`.** Inside the contract `msg.sender` is still the user, so this spends `allowance[user][user]`. When the UI approves the contract, every sell and every liquidity add reverts, so the pool can never be seeded. | Critical: the app can't work | No. It compiles fine. | New AST guardrail: a contract inheriting ERC20 may not call its own `transfer`/`transferFrom`, and must use `_transfer`. Added to the contract rules too. A test using run 2's actual file is in `checks.test.ts`. Plus the contract tests below (P16). |
| 2 | The plan said two contracts (RTXToken + RTXSwap), but the model built one combined contract | Design | No | `multi-contract`, `tokens` and `swaps-and-markets` guides: one focused contract per file, and how they reference each other |
| 3 | Swaps have no deadline | Minor (stale transactions can execute later) | No | `swaps-and-markets` guide: `deadline` parameter |
| 4 | Liquidity can never be withdrawn. The owner's G$ and RTX are locked forever. | Design (safe for users, bad for the owner) | No | Guide: liquidity shares with add/remove |
| 5 | Hit the 16-round limit in the build pass | Process | Logged | Guide pushes smaller files; round budget unchanged (see cost) |
| 6 | Bad import `./chain` from `src/components/` (should be `../lib/chain`) | Minor | Yes, by the app check; Sonnet fixed it in 1 attempt | Existing check and fix loop |
| 7 | The reply ran to 7 sentences against the 1-3 rule | Minor | No | Unchanged; watch it |
| 8 | 208 s and $0.32 | Cost | n/a | Measured in run 3 below |
| 9 | Only the `design-tokens` and `dashboard-and-data` guides loaded | Guidance gap | n/a | New guides: `tokens`, `swaps-and-markets`, `multi-contract`, `cross-chain` |

## Run 3 (with the new guides, contract tests and checks)

Result: **the turn died after two model calls** with "The AI provider rejected the request: Failed to process successful response". The AI SDK couldn't parse a streamed DeepSeek chunk. It did load the right guides (tokens, swaps-and-markets, multi-contract, contract-tests, design-tokens) and planned two contracts plus a test file.

Fixed by: the runner retries a model call once when the provider fails mid-response, and drops that attempt's partial text and tool calls. A unit test covers this; there is a note for the `model.ts` owner in the shared notes folder.

## Run 4 (everything above)

Result: **it works end to end in the preview, with tested contracts.** 207 s, $0.50.

| | Run 2 | Run 4 |
|---|---|---|
| Guides loaded | design-tokens, dashboard-and-data | tokens, swaps-and-markets, multi-contract, cross-chain, contract-tests, design-tokens, dashboard-and-data |
| Contracts | 1 (token with the pool inside, broken sell and liquidity) | 2: `RTXToken` (17 lines, fixed 50M supply, burnable) and `RTXPool` (194 lines: constant product, 0.3% fee, liquidity shares, add/remove, slippage and deadline on swaps, one-step G$ buy via `transferAndCall`) |
| Contract tests | none | `RTXPool.t.sol`, 6 tests: buy, sell, one-step buy, remove liquidity, slippage/deadline guards, fixed supply. All pass in the local EVM. |
| What the checks caught | an import path | a test compile error, then 2 failing tests (a hand-typed expected amount; a deadline test that couldn't work at timestamp 0) |
| Fix attempts | 1 | 2 |
| Deploy order in the reply | no | yes: "Deploy RTXToken first, then RTXPool with the G$ address and the RTXToken address" |
| Cross-chain | honest, UI shows unavailable routes | honest, says bridging isn't supported yet |
| Preview | no error | no error; Buy / Sell / Swap card, pool stats, liquidity panel, recent trades, a deploy notice naming both contracts |
| Cost | $0.32 | $0.50: DeepSeek 14 calls $0.06 (258k input tokens, 238k cached); Sonnet 5 fix calls **$0.44** (208k input tokens, only 43k cached) |

Found in run 4 and fixed after it:
- **The fixer weakened a test to make it pass.** At block.timestamp 0 an "expired deadline" can't be expressed, so Sonnet deleted that assertion. The test EVM now runs at a realistic timestamp (1,750,000,000). The contract-tests guide says how to test an expired deadline, and to compute expected amounts with the contract's own formula. The fix prompt now says to fix the contract when it misbehaves, and never to delete or weaken a check just to pass.

Still open (not fixed here):
- **Cost is dominated by the Sonnet fix passes** (88% of run 4). Each fix call resends about 40k tokens of context with little cache reuse. Routing and caching belong to `model.ts` (the other session). Options: let DeepSeek take the first fix attempt for test failures, or cache the context better for Anthropic.
- The reply is still 4 sentences against the 1-3 sentence rule.
- The pool's `removeLiquidity` and the test suite were not reviewed by a human. The tests are the model's own, so they show the contract does what the model intended, not that it is safe. The "Unaudited" badge stays.

## Gaps that belong to M5 (not changed here)

- **Deploy order for several contracts.** Run 4 needs RTXToken deployed first, then RTXPool with the G$ address and the RTXToken address. The deploy flow has to read constructor arguments that name other project contracts and fill them in after each deploy.
- **The deploy card shows only the first contract** (`contracts[0]`, RTXPool in run 4). M5's deploy UI should list each contract in order.
- **A test G$ on Celo Sepolia** (Q39). Until it exists, nothing that uses G$ can be tried on testnet. Locally, `@goodbuild/MockGoodDollar.sol` stands in for G$ in contract tests.
- **The `<Name>Address` maps are filled only after deploy.** Until then every app shows its "deploy to go live" state.
