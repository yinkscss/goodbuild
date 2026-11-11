# Games plan: right first time (proposal, 11 Nov 2026)

Status: **Phases A and B built (D93) and C and D built (D94), 11 Nov 2026; E to G still proposals.** The owner chose a wallet-only leaderboard with the hybrid design (browser: one free signature and app data; MiniPay: a small contract), so A2 below is superseded by D93. D94 lists where C and D differ from what is written here. Originally:

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
- **E3. G$ inside MiniPay: open question.** The MiniPay guide talks about dollar coins only. Paying the network fee in a dollar coin works for any contract call, but whether MiniPay shows a G$ balance and approves a G$ `transferAndCall` cleanly is **UNVERIFIED** and needs a phone test. Until then, a MiniPay game store should show the price in G$ with a clear "you need G$" path, and the owner may want USDm as a second currency.

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
