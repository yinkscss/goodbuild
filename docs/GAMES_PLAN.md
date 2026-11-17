# Games plan: right first time (proposal, 11 Nov 2026)

Status: **Phases A and B built (D93), C and D (D94), E and F (D95), all on 11 Nov 2026; G (evals) still a proposal.** The owner chose a wallet-only leaderboard with the hybrid design (browser: one free signature and app data; MiniPay: a small contract), so A2 below is superseded by D93. D94 and D95 list where the build differs from what is written here. Originally:

The owner's must-haves for every game build:
1. Obstacles, challenges and power-ups, with the person asked about each one separately.
2. NPCs: computer-controlled things (traffic, rivals, enemies, chasers) that make up the obstacles and challenges.
3. A leaderboard that works.
4. Wallet connect that works.
5. A strong game idea, made better than what was asked for.

---

## 1. What went wrong in the Neon Drift build, and why

Each retry, traced to a cause in GoodBuild itself (not only to the model):

| Version | What the person saw | Root cause | Confidence |
|---|---|---|---|
| v1, v2, v3 | "No car rendered, large empty pink space", then "large empty dark block" | **A kit bug the guide causes.** `GameCanvas` skips `onFrame` entirely while `paused` (`if (pausedRef.current \|\| document.hidden) return;`), and the game guide says *"pass paused while a screen other than the game is up"*. So the start screen is a canvas that was never drawn: transparent, so the page's pink showed through. In v3 the model gave the canvas a dark CSS background, so it became an empty dark block. The model couldn't have fixed it without dropping `paused`. | High. Checked: the preview screenshot (html-to-image 1.11.13) captures a drawn 2D canvas correctly in headless Chromium, so the blank came from the canvas, not the screenshot. |
| v2, v3 | "Car preview in YOUR CAR card is a tiny indistinct icon" | No way to show a game drawing outside the canvas. The model drew cars in canvas code, then had to redraw them a second way (SVG or CSS) for the garage cards. | Medium |
| v4 | "Wallet connect is not working" | **Unknown until the transcript arrives.** Likely candidates: the Sandpack preview only has browser wallets (no WalletConnect, no MiniPay), and a phone has no browser wallet; or a MiniPay-ready app hid its Connect button (the MiniPay guide says never to show one) with no fallback. | Low |
| v5, v6 | "Error on the high score" | **Two of GoodBuild's own guides contradict each other.** The game guide says to save scores with `useCollection("scores")`, whose default rule is `create: "signed-in"`, which needs a wallet signature. The MiniPay guide (on because the person said MiniPay) forbids that signature. So a MiniPay game with a leaderboard couldn't work first time. Then the board asked for `limit: 200` and the server only accepts 1 to 100 (`app-data/handler.ts:161`). | High |
| v5, v6 | "Add a free play mode" | The guide says the game must be playable without a wallet, but nothing checks it. | High |
| v7 | "Add obstacles, cars in the opposite direction, a scoreboard, a start button" | The planner never asked about obstacles, power-ups or rivals (its game questions are "how it is played, how you win, and scores"), so an *endless racer* shipped with power-ups and a store but no real hazards. When added, oncoming cars only came "after a few hundred metres", so a short play never meets them. | High |
| v7 | "Main game area blank, no start button, no scoreboard, no obstacles visible" | The same blank-start-screen bug as v1 to v3. On top of that, the visual check judges one still picture of the start screen and isn't told it's a game, so it reports things that only exist mid-play ("obstacles not visible") as missing. A "Fix these" on a false report wastes a build. | High |

**What never caught any of this:** the run check plays a game for about one second and only asks whether the canvas has *any* non-transparent pixel. A canvas filled with one dark colour passes. It never looks at the start screen, never checks for obstacles, power-ups, NPCs, a rising score, a game-over screen, the leaderboard or the wallet.

---

## 2. What "a good game build" means (the bar every build is checked against)

A **game checklist**, built the same way as the MiniPay checklist (D88): each item says whether GoodBuild checks it automatically, or only a phone can show it.

| # | Item | How it's checked |
|---|---|---|
| G1 | The start screen shows the game world (not a blank or flat canvas), the game's name, one line on how to play, and a big Play button | Run check: canvas before Play is not flat; Play button found |
| G2 | Play starts with **no wallet** (free play) | Run check: starts with no wallet injected |
| G3 | The score rises while playing and is visible on screen | Run check: the game probe (see C6) reports a rising score |
| G4 | The first obstacle arrives within about 3 seconds | Run check: probe reports an obstacle before 3 s |
| G5 | Every obstacle, power-up and NPC type in the plan appears during play | Run check: probe lists the types seen in about 8 s of bot play |
| G6 | Difficulty rises (speed or spawn rate goes up with score or time) | Probe: `speed` goes up between second 2 and second 8 |
| G7 | You can lose; game over shows score, best and Play again; Play again works | Run check: bot plays until game over (or forces it with the probe), then presses Play again |
| G8 | Thumb controls work (tap or on-screen buttons) and keyboard works on a computer | Run check: taps and keys move the player (probe `player.x` changes) |
| G9 | Feedback on every action: a sound and something seen (burst, shake, popup) | Checks the files for `sfx.` and `juice` use; a phone for the feel |
| G10 | Leaderboard: a finished run can be posted with a name and appears in the top 10, with no wallet and inside MiniPay | Run check against an in-memory app-data stand-in |
| G11 | Wallet: Connect works in a browser; inside MiniPay it connects by itself with no button | Run check with a stand-in wallet (normal and `isMiniPay`) |
| G12 | Things to buy (if asked): the store shows each item drawn the same as in the game, prices in G$, owned items unlock in the game | Files check and contract tests; a phone for the purchase |
| G13 | Runs smoothly on a cheap phone: no new objects per frame, fewer than a few hundred things on screen | Files check (heuristics); a phone |
| G14 | Mute button; pause when the tab is hidden | Files check; already automatic |

The chat shows this list after the build (like the MiniPay card), with a **Fix these** button for unmet checked items. The builder also gets it in the guide and must go through it before finishing.

---

## 3. The plan

Ordered by value for effort. Phase A alone would likely have removed most of the Neon Drift retries.

### Phase A: fix what caused the retries (small, do first)

**A1. Draw the start and game-over screens.** Add an optional `onIdleFrame(frame)` prop to `GameCanvas`, called every frame while `paused` (real `dt`, input let go, `time` frozen). The game draws its world there: the road scrolling slowly and the parked car. `onFrame` keeps today's behaviour, so games already built don't change. Why not just call `onFrame` while paused: a game whose collision code calls `endGame()` and `sfx.hit()` would call them 60 times a second on the game-over screen, and the `superseded` mechanism (D85) would push that change into games already built. The guide changes from "pass paused" to "pass paused **and** onIdleFrame that draws the world". New file check: a `GameCanvas` with `paused` and no `onIdleFrame` is an error, with the fix named. Run check: the canvas on the start screen must not be one flat colour.

**A2. A leaderboard that works everywhere, as kit files, not prose.** New `src/game/leaderboard.ts` and `src/game/Leaderboard.tsx`:
- `useLeaderboard("scores")` returns `{ top, myBest, submit(name, score, extra), loading, error, retry }`.
- It uses the app-data store with a fixed rule: `{"create": "anyone", "read": ["anyone"], "fields": {"name": "string", "score": "number", "extra": "string"}}`. That needs no wallet sign-in, so it works with free play and inside MiniPay. Each device keeps one best record (`put("best", ...)`, which works because an anonymous visitor gets a session cookie on first write), so the board isn't flooded and the 2,000 anonymous-record cap per app lasts.
- The query is `orderBy: "score", dir: "desc", limit: 10`, with the limit clamped to 100 in the hook.
- The name is remembered on the device. A wallet, when connected, is shown as a short label.
- `<Leaderboard />` covers loading, empty ("Be the first on the board"), error with Retry, "You" highlighted, and an optional small drawing per row (A3).
- Files check: a game using `useLeaderboard` must have the rule in `src/lib/dataRules.json`. The builder adds it; the check names the exact JSON.
- The game guide and MiniPay guide are made to agree: the MiniPay rule against sign-in stays, and the game guide says leaderboards never need sign-in.
- Separately, `useCollection` and `collection().list()` clamp `limit` to 100 for every app, not only games. That error should never reach a person.
- The page keeps saying plainly that scores come from players' own devices (unchanged).

**A3. One drawing, used everywhere.** New `<Sprite draw={(ctx, w, h) => ...} size={96} />` in `src/game/Sprite.tsx`. It renders a game drawing function into a small canvas for garage cards, the store, the start card and leaderboard rows. The guide says: write each thing's drawing once (`drawCar(ctx, x, y, colour)`), use it in the game and in `<Sprite>`. That fixes "I don't see the cars" and "tiny indistinct icon".

**A4. Free play is the default, and checked.** The guide puts it first: the game, the leaderboard and the starter items work with no wallet. A wallet is only asked for to buy something or to claim a prize. The run check already has no wallet. It now reports an issue when it can't find a Play button, or Play is disabled. Today it silently skips.

**A5. The visual check and the review know it's a game.** For a game, take two pictures: the start screen, and one about 3 seconds into play (the run check already presses Play). Tell the vision model which is which and what belongs on each: obstacles, NPCs and the live score only during play; title, how to play and Play on the start screen. That stops "obstacles not visible" being reported on a start screen and costing a build.

### Phase B: plan questions that cover the game (the owner's ask)

**B1. Ask about obstacles, power-ups and NPCs, each on its own card.** For a game the planner must ask these three as multi-choice cards, with options that fit *this* game, each with one recommended:
- *Racer:* "What gets in your way?" Oncoming traffic / Slower cars to overtake / Oil slicks and potholes / Road works that close a lane. "What power-ups?" Nitro boost / Shield / Coin magnet / Slow motion. "Who else is on the road?" Rival racers who try to block you / Police who chase you / Just traffic.
- *Platformer:* spikes, pits, moving platforms / double jump, shield, magnet / patrolling enemies, a boss every 5 levels.

The server checks the three cards came back. If the model left one out, it adds a generic card with the same wording, the same way it adds the MiniPay card.

**B2. More room for a game's plan.** Today a plan has at most 5 cards (4 from the model, minus 1 for MiniPay, plus colours). A game gets up to 8, all one tap each: how you play, obstacles, power-ups, NPCs, scores and leaderboard (fixed by the server: "Everyone, no wallet needed (recommended)" / "Only people who connect a wallet" / "Just my own best"), money (only if they mentioned buying or prizes), MiniPay, colours. **Trade-off:** more cards mean more taps before the build starts. Claude's view is that for a game the answers decide most of what gets built, so it's worth it. The owner may prefer 6.

**B3. A game pitch the person can see before building.** The planner also returns a short **game brief**: name, one-line pitch, core loop ("dodge, collect, survive"), how you lose, how it gets harder, and two or three "extras that make it fun", picked from Phase F to fit. The plan card shows it ("Neon Drift: weave through night traffic, chain near misses for combo points, grab nitro..."), and the builder gets it as the spec. This is where the game gets better than what was asked for, and the person can edit it before paying for a build.

**B4. The brief and answers become the checklist's targets.** The obstacle, power-up and NPC types picked in the plan are the types the run check expects the probe to report (G5). So "the user asked for oncoming traffic" is checked, not hoped for.

### Phase C: building blocks in the kit, so the model writes the game and not the plumbing

All small files in `src/game/`, no packages, nothing allocated per frame:
- **C1 `world.ts`:** `Pool<T>` (reuse objects), `Spawner` (a rate that ramps with time or score, a minimum gap so it stays fair, a grace period at the start), `difficulty(t)` curve, and a `lanes(n, width)` helper for runners and racers.
- **C2 `npc.ts`:** ready behaviours as small functions on a shared shape: `traffic` (moves in its lane, sometimes changes lane with a signal first), `oncoming`, `chaser` (follows the player with a speed cap), `patrol` (back and forth), `shooter` (fires on a timer), `rival` (races alongside, tries to block). Each one is fair by default: telegraph first, then act.
- **C3 `powerups.ts`:** a timed-effects manager. `activate("shield", 5)`, `isActive("magnet")`, `remaining("nitro")`, with HUD timer bars. Common effects come ready: shield, magnet, slow motion, double score, boost, extra life.
- **C4 `hud.ts`:** score panel, distance, combo and multiplier, lives, power-up timers, drawn on the canvas in a consistent style. "The scoreboard is missing" stops being a thing the model forgets.
- **C5 `Sprite.tsx`:** see A3.
- **C6 `probe.ts`, the game probe:** one call per frame, `probe({ score, speed, playerX, over, seen: { obstacle: "oncoming", powerup: "nitro", npc: "rival" } })`. It costs nothing in published apps: it only records when the run check sets a flag. This is what lets GoodBuild *test* that obstacles, power-ups, NPCs and a rising score exist, instead of asking a vision model to guess from a picture. A files check makes sure the probe is called.
- **C7 `haptics.ts`:** `buzz("hit")` using `navigator.vibrate` where it exists, behind the same mute setting.

### Phase D: the run check plays the game properly (the owner's "always catch and test")

- **D1. Play longer, with a simple bot.** About 8 seconds instead of 1: press Play, then a bot taps and steers away from the nearest obstacle, using the probe. Then force a game over (the probe exposes `endRound()` in check mode) and press Play again. It reports G1 to G8 from what the probe saw. The check's time limit (25 s) has room.
- **D2. Leaderboard test.** The run check already answers every request from memory. Add a small in-memory stand-in for the app-data endpoints, enough for put, list, orderBy and limit, that follows the project's rules. After the game over, post a run and see it in `<Leaderboard />`. It catches a missing rule, a sign-in requirement, and limits over 100.
- **D3. Wallet test.** Inject a stand-in browser wallet (an EIP-1193 provider answering `eth_requestAccounts` and `eth_chainId`; `scripts/wallet-e2e.ts` already has one). Check that Connect leads to an address on screen. Run it again with `isMiniPay: true` and check it connects with no button and no signature request. Free play (G2) is checked with no wallet at all.
- **D4. Fixes go to the builder's fix loop**, like every run-check issue today, so they're fixed before the person ever sees the build. The checklist card (section 2) shows what passed.

### Phase E: money in games (store, level-ups, cars, season pass)

- **E1. A tested `GameShop.sol` the kit provides**, instead of the model writing a shop contract each time. It covers items with a G$ price (cars, upgrades, power-up packs) bought with `transferAndCall`, so there's one signature and no approve step; level-ups as a counted item; and a **season pass** with an end date and tiers unlocked by owner-set milestones. It has an owner-set price list, an owner withdrawal, a pause switch, and `ownedBy(player)` for the game to read. It comes with Foundry tests, including the exploit tests D76 asks for wherever money goes in, and the guide explains how to point the game at it.
- **E2. Keep it fair:** the guide already says the game must be fair without paying. Add that bought items are cosmetic or convenience, never a guaranteed win on a board with prizes.
- **E3. G$ inside MiniPay: answered.** The owner tested it on a phone on 11 Nov 2026 and it works (D95). What was written before: The MiniPay guide talks about dollar coins only. Paying the network fee in a dollar coin works for any contract call, but whether MiniPay shows a G$ balance and approves a G$ `transferAndCall` cleanly is **UNVERIFIED** and needs a phone test. Until then, a MiniPay game store should show the price in G$ with a clear "you need G$" path, and the owner may want USDm as a second currency.

### Phase F: make the game better than asked ("boost the game")

The planner's brief (B3) picks two or three of these that fit. The kit makes each one a few lines:
- **Near-miss bonus and combos:** passing close to traffic scores extra and builds a multiplier. It's the single best "one more go" mechanic for runners.
- **Missions:** three small goals per session ("collect 20 coins", "survive 60 s without a hit"), saved on the device. They feed the season pass.
- **Daily challenge:** a fixed seed per day, so everyone races the same course, with its own board.
- **Ghost of your best run** for racers and runners (a stored path drawn faintly).
- **Coins and a starter garage** that unlock by play as well as by G$, so free players progress.
- **First-run tip:** one hint the first time ("Tap left or right to change lane"), then never again.
- **Share score:** `navigator.share` with the score and link, which suits WhatsApp-heavy audiences.
- **Settings:** sound, haptics, and reduced motion (less shake, fewer particles) taken from the device's setting.
- **Pause button** in the HUD, plus "Tap to resume" after a tab switch.

### Phase G: prove it with evals

- **G1.** Add the Neon Drift request word for word to the eval suite (`docs/evals/suite/suite.json`), plus a platformer and a quiz game, each scored on the game checklist.
- **G2.** Measure before and after: how many checklist items pass on the first build, cost per build, and how often the fix loop runs. Success means the Neon Drift prompt passes G1 to G11 on the first build, with no person-sent "fix this".
- **G3.** Keep the owner's transcript as a regression note in `docs/evals/`.

---

## 4. Order and size

| Step | What | Size | Depends on |
|---|---|---|---|
| 1 | A1 to A5 (start screen, leaderboard files, Sprite, free play check, game-aware visual check) | Medium, about one session | Nothing |
| 2 | C1 to C7 (building blocks and the probe) | Medium | Nothing |
| 3 | D1 to D3 (run check plays, leaderboard and wallet tests) | Medium | C6 |
| 4 | B1 to B4 (planner cards and brief) | Small to medium (prompt, parsing, plan card UI) | C6 for B4 |
| 5 | Section 2 checklist card in the chat | Small | D |
| 6 | E1 to E2 (GameShop contract and tests) | Medium | Nothing |
| 7 | F (extras) | Small each | C |
| 8 | G (evals) | Small to write; running needs the owner's API keys (D70) | All |

Each step records its decision in DECISIONS.md, has tests in the repo's usual style (`kits/game-2d.test.ts`, `run-check.test.ts`, `plan-first.test.ts`), and is marked UNVERIFIED where only a real model, a real phone or MiniPay can confirm it.

## 5. Questions for the owner

1. **Go-ahead and order.** Start with Phase A, or A plus B together?
2. **How many plan cards for a game:** up to 8 as proposed, or cap at 6 (merge power-ups and obstacles into one card)?
3. **Leaderboard default:** everyone with no wallet (proposed; easy to spoof, but no game score can be trusted anyway), or wallet-only?
4. **G$ in MiniPay (E3):** can you test a G$ purchase in MiniPay on a phone, or should MiniPay stores also accept USDm?
5. **The transcript:** the wallet failure in v4 is the one retry this plan can't pin down without it. Most useful would be the wallet message shown under the header, and where you tested (MiniPay, the preview on a computer, or a phone browser).

---

# Part 2: game templates and checks that fit every kind of game (proposal, 17 Nov 2026)

Status: **proposal, level L2 chosen by the owner on 17 Nov 2026** ("L2: genres + 3D parity"). Nothing built yet. Waiting for the owner's go-ahead on this plan.

## 7. Ten game requests GoodBuild can't handle yet (found 17 Nov 2026, each checked in the code on `main` at c5a7b7cd1)

| # | The request or player | Where the gap is | What happens |
|---|---|---|---|
| 1 | A quiz, puzzle, memory, word, card, idle or turn-based game | `game-check.ts:189-217`: "first obstacle within 3.5 s", "speed never rose" and "player never moved" run for every game, even one that declares no obstacles. `plan-intake.ts` GAME_RULES asks every game about obstacles, power-ups and computer characters | False issues. The fix loop bolts things to dodge onto a sudoku, and each one costs a build |
| 2 | Any 3D game | The 3D guide tells the builder to `add_kit("game-2d")` for sound and saving (`three-d.ts:328`), so the blocks, probe file and leaderboard can be there. But `Scene3D` never reports rounds or runs at check speed, and the full play test is keyed on `game-2d` (`run-check.ts:356`, `:560`). The MiniPay board turns on only with `game-2d` (`runner.ts:881`) | A 3D game that skips `game-2d` gets only a blank-screen check. One that adds it is judged by 2D rules against a WebGL canvas, likely a false "start screen is flat" or "no probe calls" (**UNVERIFIED**, needs a test) |
| 3 | Swipe, drag, hold-to-charge, aim and release, draw a path | The bot only taps the left or right side or presses Left, Right, Space (`game-check.ts:103-113`) | "Never moved the player", sent to the fix loop |
| 4 | A game that spawns with `setInterval`, `setTimeout` or `Date.now` | The check runs 4 game steps per frame (`stepsPerFrame`). Timers on the wall clock don't speed up | Obstacles arrive "late", the game fails the 3.5 s rule. Nothing in the guide or the checks mentions it |
| 5 | "Make Tetris", "Flappy Bird with Mario" | The game words list matches flappy, tetris, pong, space invaders (`game-2d.ts:747`). No prompt steers to an original game | A copy of a named game, published on GoodBuild's domain. Legal risk |
| 6 | Slingshot, stacking tower, pool, car handling | matter-js is blocked (`game-2d.ts:776`), "no physics engine" (`three-d.ts:324`) | The model writes its own physics: buggy and not checkable. **Not in this plan** |
| 7 | "Race my friend on two phones" | No live connection; apps poll every 3 s or more | Only turn-based play works. **Not in this plan** |
| 8 | Tilt steering, two players on one phone, a controller, shout to jump, landscape only | No `orientation` code in any kit; input is single pointer, arrows and one action | A sideways-only game has no "turn your phone" handling; whether MiniPay's window can turn sideways is **UNVERIFIED** |
| 9 | Idle or tycoon games, 30-level campaigns, story games | Saved data is the best score only; the bot plays about 7 s | Progress lost when a cheap phone kills the tab; level 2 onwards never tested |
| 10 | Cheap Android phones | No `webglcontextlost` handling in `Scene3D`; the guide recommends emoji as pictures (`game-2d.ts:618`), and newer emoji may show as boxes on older Android (**UNVERIFIED**); smoothness is guessed from the files | A black 3D screen until reload; possibly missing pictures; slow games not caught |

This plan fixes 1 to 5 and the 3D half of 10. 6 and 7 stay out (each would be its own kit). 8 and 9 get a small part each (landscape notice, mid-run save for templates that have levels); the rest is later.

## 8. Goal and the bar

**Goal:** almost any game a person asks for, 2D or 3D, works on the first build and passes the whole game check (section 2) for its own kind of game.

**The bar for every template (the outside judge):** it passes the app check, the type check and the real run check, with the bot playing it in a headless browser, in the same tests as `kits/game-2d.test.ts`. A broken copy of each template (no probe, a score that never rises, controls that do nothing) must fail. Every template is original: named by how it plays, never after an existing game.

## 9. The plan

### Phase H: judge each game by its own kind (fixes 1, 3, 4)

- **H1. A game says what kind it is.** `declareGame({ style, controls, obstacles, powerups, npcs })`. `style` is `"action"` (today's rules), `"puzzle"` (moves on a board, no clock pressure) or `"turns"` (questions, cards, turn-based). `controls` lists `"tap" | "sides" | "keys" | "swipe" | "drag" | "hold" | "buttons"`. Old games that declare neither are judged as `"action"`, so nothing already built changes.
- **H2. Rules by kind.** Action keeps every rule. Puzzle and turns drop "obstacle in 3.5 s", "got harder" and "player moved", and instead need: a move changes something (`moved()` in the probe), the score or progress rises, and a round can end (win or lose) and Play again works. Declared obstacles, power-ups and characters are still checked for every kind.
- **H2b. Games with no canvas.** Rounds come from `GameCanvas` pausing today (D94), and the start-screen check looks for a game canvas. A quiz or a grid of buttons has neither. The probe gets `roundStart()` and `roundEnd()` for games without a canvas (the kit's `useRound()` hook calls them from the screen state), and the run check takes a no-canvas path: no flat-canvas rule, Play found, rounds and score from the probe.
- **H3. The bot plays the declared controls.** Swipe (a quick drag across the canvas), drag (press, move, release), hold (press for 0.6 s), and buttons (click the answer or tile buttons the game shows outside the canvas, by role). Today's tap-and-keys stays for `"sides"`, `"tap"` and `"keys"`.
- **H4. Wall-clock timers, caught at run time, not by reading files.** A file check can't tell a spawn timer from `setTimeout(() => setToast(null))`, so it would cause the false fix-loops this plan removes. Instead the check compares when things spawn on the game clock against wall time at 4x: spawns that keep wall-clock pace get one issue naming the fix (count in `dt`). The guide gains one line on it.
- **New rules never become errors for games already built:** a game that doesn't call the new parts of the probe is judged as today.
- **H5. The planner asks the right questions per kind.** GAME_RULES keeps the three cards for action games. For puzzle and turns games they become "What makes it hard?", "What helps the player?" (hints, undo, extra time) and "Who do you play against?" (the clock, a computer player, other people's scores). The server's fallback cards follow the same split.
- **H6. Original games only.** The planner and builder are told: a named existing game becomes an original game with the same kind of play, a new name, new look and no characters, art, music or levels from it. The plan card shows the new name. The game words keep catching "tetris" and so on, so the kit still turns on.

### Phase I: 3D games get everything 2D games have (fixes 2 and the 3D half of 10)

- **I1. `Scene3D` joins the probe.** It calls `checkTick`, `checkRound` and runs `stepsPerFrame()` steps while checked, marks its canvas `data-game-canvas`, and takes `onIdleFrame` so the start screen shows the world. Old file hash goes into `superseded`.
- **I2. Building blocks for 3D.** `world.ts`, `npc.ts`, `powerups.ts`, `probe.ts`, `sound.ts`, `storage.ts`, `haptics.ts`, `juice` already work on plain numbers. Decision to make in the build: keep "a 3D game also turns on `game-2d`" (today's guide line, least change) and make the run check pick 2D or 3D judging by which canvas the game uses, not by which kits are on. Claude's lean: keep it, because splitting the files into a shared kit means moving files in projects already built. New `Hud3D.tsx`: the score panel, lives and power-up timers as a React overlay, since the 2D HUD draws on a 2D canvas.
- **I3. Leaderboard, `GameBoard` (MiniPay), shop and extras for 3D.** The runner's rule becomes "a game kit" instead of `game-2d`. `Sprite` gets a 3D version that renders one mesh-building function to a small picture for store cards and the board.
- **I4. The run check plays 3D games like 2D ones:** start screen not flat, Play found, bot play with the probe, Play again, post a score, wallet, MiniPay. Pictures for the review and visual check: the preview capture uses html-to-image, and `Scene3D` doesn't set `preserveDrawingBuffer`, so a WebGL canvas likely captures blank that way. Use Playwright's own screenshot, or a read taken inside the frame (as D85's flat check does). **UNVERIFIED** until a test shows a 3D picture comes out drawn.
- **I5. Losing the 3D context on a cheap phone:** `Scene3D` listens for `webglcontextlost` and `webglcontextrestored`, pauses and rebuilds, or shows "Tap to reload the game" instead of a black box.

### Phase J: templates, a working game the builder changes (L1 core)

- **J1. How a template reaches a project.** A new catalogue, `src/server/agent/game-templates/`, one module per template: id, plain name, 2D or 3D, style, controls, its files, and default answers for the plan. On the **first build only**, when the plan picked a template, the runner adds its files (the game screen, its drawing functions, `App.tsx` wiring) the way a kit adds starter files, and writes `"template": "<id>"` into `src/goodbuild.json`. Unlike kit files they are the person's from then on: never in `superseded`, never put back. The builder is told "this is your starting point: rename, restyle and change the rules to fit the plan", not "write a game".
- **J2. Why not one kit per template:** kits never come off and their files come back when deleted, which is wrong for a game the person reshapes. Why not prose only (like page templates): a working, checked game is what removes the retries.
- **J3. Six 2D templates** (original, named by how they play):
  1. **Lane racer:** three lanes, traffic, oncoming cars, nitro, near-miss combos (action, sides/swipe)
  2. **Catch and dodge:** things fall, catch the good, dodge the bad (action, drag). Today's "Mini game" chip
  3. **Cave flyer:** one tap to rise, gaps to pass, gets narrower (action, tap)
  4. **Brick breaker:** paddle, ball, bricks, power-up drops, levels saved mid-run (action, drag)
  5. **Match grid:** swap tiles, match three, moves limit, goals per level (puzzle, swipe)
  6. **Quick quiz:** timed questions, streaks, hint power-up, daily set (turns, buttons)
- **J4. Four 3D templates:**
  1. **Endless runner 3D:** run down a track, jump and slide, lanes (action, swipe)
  2. **Kart track:** laps against computer rivals, boost pads, no physics engine (action, sides/keys)
  3. **Maze escape:** collect keys, a chaser, minimap (action, swipe/keys)
  4. **Sky rings:** fly through rings, drag to steer, wind and towers (action, drag)
- **J5. Each template ships with:** start screen drawn, free play, leaderboard, wallet, MiniPay ready, mute, the probe declared, `<Sprite>` drawings reused in the store, and nothing allocated per frame. Shapes and colours only, no emoji as pictures (fix 10). Landscape templates (kart track) say "Turn your phone" in an upright window.

### Phase K: the planner picks the template

- **K1.** `game_brief` gains `template` (one of the ids, or none for something no template fits) and `style`. The planner gets the catalogue in one line each. The server ignores an unknown id.
- **K2.** The plan card shows "Starts from: Lane racer" in plain words, with the pitch. Nobody is asked to choose a template; a later message can change it.
- **K3.** No template fits (a tycoon game, physics): the build runs as today, judged by its declared style.
- **K4.** Home: the "Mini game" chip stays; the game gallery is a later, separate change.

### Phase P: prove it

- **P1.** Tests: each template passes the run check with the bot (2D in `kits/game-2d.test.ts` style, 3D in `three-d.test.ts`), and a broken copy of each fails. H2 rules have their own tests in `game-check.test.ts`, including today's games still judged the same.
- **P2.** Eval suite: one request per template plus a puzzle and a quiz with no template, scored on the checklist. Running it needs the owner's provider keys (D70). **UNVERIFIED** until then.

## 10. Order and size

| Step | What | Size | Depends on |
|---|---|---|---|
| 1 | H1 to H4 (kinds, rules, games with no canvas, bot controls, timer check) | Medium | Nothing |
| 2 | I1 to I5 (3D parity) | Medium to large | H1 for the probe shape |
| 3 | One full slice: J1 plus **Lane racer** and **Quick quiz** (the quiz tests H2, H2b and H3 for real) | Medium | H |
| 4 | The other four 2D templates, then the four 3D templates | Large | Step 3 passing, I |
| 5 | H5, H6, K (planner, original games, plan card) | Small to medium | J1 |
| 6 | P (tests run with each step; evals at the end) | Small | All |

Steps 1 and 2 both change `game-check.ts` and `run-check.ts`, so they run one after the other, not in parallel. Each step gets its own decision in DECISIONS.md and its own PR.

## 11. Questions for the owner

1. **Go-ahead** on this plan and order, one PR per step?
2. **The six 2D and four 3D templates:** keep this list, or swap any (for example a platformer with levels instead of the cave flyer)?
3. **Sideways games:** allow sideways-only games (kart track) with a "Turn your phone" notice, or keep every template upright? Upright is the safe default until someone checks on a phone whether MiniPay turns sideways.
