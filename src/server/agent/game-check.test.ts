// @vitest-environment node
import { describe, expect, it } from "vitest";

import { judgeRounds, standInWalletScript, styleOf, type ProbeReport, type ProbeRound } from "./game-check";

const round = (over: Partial<ProbeRound> = {}): ProbeRound => ({ start: 0, end: 12, frames: 400, score0: 0, scoreMax: 50, speed0: 200, speedMax: 260, xMin: 90, xMax: 270, yMin: 520, yMax: 520, firstHazard: 1.2, kinds: { oncoming: 1, nitro: 4, rival: 6 }, ...over });
const report = (rounds: ProbeRound[], over: Partial<ProbeReport> = {}): ProbeReport => ({
  time: 30,
  rounds,
  seen: { oncoming: 1, nitro: 4, rival: 6 },
  declared: { obstacles: ["oncoming"], powerups: ["nitro"], npcs: ["rival"] },
  probes: rounds.reduce((n, r) => n + r.frames, 0),
  ...over,
});
const issues = (r: ProbeReport) => judgeRounds(r).issues.join("\n");

describe("judging a played game (D94)", () => {
  it("passes a game that does everything", () => {
    const r = judgeRounds(report([round({ end: 16 }), round({ start: 16, end: 20 })]));
    expect(r.issues).toEqual([]);
    expect(r.note).toBe("played 2 rounds, 20s of game, saw oncoming, nitro, rival");
  });

  it("reports a Play that started no round, only when Play was pressed on a canvas that reports rounds", () => {
    expect(judgeRounds(report([], { probes: 0 }), { pressedPlay: true }).issues.join()).toMatch(/Pressing Play didn't start the game/);
    expect(judgeRounds(report([], { probes: 0 })).issues).toEqual([]);
  });

  it("asks for the probe when it was never called", () => {
    expect(issues(report([round()], { probes: 0 }))).toMatch(/never called probe/);
  });

  it("reports a score that never rises", () => {
    expect(issues(report([round({ scoreMax: 0 })]))).toMatch(/score never went up/);
    // Too little play to tell: silent.
    expect(issues(report([round({ end: 1, scoreMax: 0 })]))).not.toMatch(/score/);
  });

  it("reports a first obstacle later than 3 seconds, or none at all, only when a round lasted long enough", () => {
    expect(issues(report([round({ firstHazard: 6 })]))).toMatch(/first obstacle came 6\.0 seconds after Play/);
    expect(issues(report([round({ firstHazard: undefined })]))).toMatch(/Nothing got in the player's way/);
    expect(issues(report([round({ end: 2, firstHazard: undefined })]))).not.toMatch(/obstacle|way/);
    // One quick round is enough.
    expect(issues(report([round({ firstHazard: 6 }), round({ start: 12, end: 20, firstHazard: 2 })]))).not.toMatch(/first obstacle/);
  });

  it("names declared kinds that never appeared, but only after a round of 15 seconds", () => {
    const missing = report([round({ end: 16, kinds: { oncoming: 1 } })], { seen: { oncoming: 1 } });
    expect(issues(missing)).toMatch(/never appeared in the first 15: "nitro", "rival"/);
    // Judged within a round: a kind first seen at 19 seconds, or only in another round, doesn't count.
    const late = report([round({ end: 20, kinds: { oncoming: 1, nitro: 19, rival: 6 } }), round({ start: 20, end: 24, kinds: { nitro: 2 } })]);
    expect(issues(late)).toMatch(/never appeared in the first 15: "nitro"/);
    // Split across two long rounds: neither round met everything, so the best one is judged.
    const split = report([round({ end: 16, kinds: { oncoming: 1, nitro: 3 } }), round({ start: 16, end: 33, kinds: { rival: 2 } })]);
    expect(issues(split)).toMatch(/never appeared in the first 15: "rival"/);
    const short = report([round({ end: 12 })], { seen: { oncoming: 1 } });
    expect(issues(short)).not.toMatch(/never appeared/);
    expect(judgeRounds(short).note).toMatch(/not long enough to judge nitro, rival/);
  });

  it("reports controls that never moved the player", () => {
    expect(issues(report([round({ xMax: 90, yMin: 520, yMax: 520 })]))).toMatch(/never moved the player/);
    // A one-tap game moves up and down instead.
    expect(issues(report([round({ xMax: 90, yMin: 100, yMax: 500 })]))).not.toMatch(/moved the player/);
  });

  it("reports a game that doesn't get harder over a long round", () => {
    expect(issues(report([round({ speedMax: 200 })]))).toMatch(/didn't get harder/);
    expect(issues(report([round({ end: 6, speedMax: 200 })]))).not.toMatch(/harder/);
  });

  it("the stand-in wallet is MiniPay only when asked", () => {
    expect(standInWalletScript({ miniPay: true, chainId: 11142220 })).toContain("isMiniPay: true");
    expect(standInWalletScript({ miniPay: false, chainId: 11142220 })).not.toContain("isMiniPay");
    expect(standInWalletScript({ miniPay: false, chainId: 11142220 })).toContain('"0xaa044c"');
  });
});

describe("judging each kind of game by its own rules (D112)", () => {
  const still = { firstHazard: undefined, speed0: 0, speedMax: 0, xMin: 0, xMax: 0, yMin: 0, yMax: 0, kinds: {} };
  const puzzle = (rounds: ProbeRound[], style: "puzzle" | "turns" = "puzzle", over: Partial<ProbeReport> = {}) =>
    report(rounds, { declared: { style, controls: ["swipe"] }, seen: {}, ...over });

  it("doesn't ask a puzzle for obstacles, speed or a moving player, only for moves and a rising score", () => {
    const r = judgeRounds(puzzle([round({ ...still, moves: 12, scoreMax: 40 })]));
    expect(r.issues).toEqual([]);
    expect(r.note).toMatch(/^puzzle game, 12 moves, played 1 round/);
  });

  it("reports a puzzle or turns game that never accepted a move", () => {
    expect(issues(puzzle([round({ ...still, moves: 0, scoreMax: 0 })]))).toMatch(/never accepted a move[\s\S]*moved\(\)/);
    // Too short to tell: silent.
    expect(issues(puzzle([round({ ...still, end: 2, moves: 0, scoreMax: 0 })]))).toEqual("");
  });

  it("reports a score that never rose only after many moves", () => {
    expect(issues(puzzle([round({ ...still, moves: 20, scoreMax: 0 })], "turns"))).toMatch(/score never went up in 20 moves/);
    expect(issues(puzzle([round({ ...still, moves: 6, scoreMax: 0 })], "turns"))).toEqual("");
  });

  it("counts rounds with moves and no frames as played, for a game without a canvas", () => {
    const r = judgeRounds(puzzle([round({ ...still, frames: 0, moves: 5, scoreMax: 20 })], "turns", { probes: 3 }), { canvas: false });
    expect(r.issues).toEqual([]);
    expect(r.note).toMatch(/turns game, 5 moves, played 1 round/);
  });

  it("still names declared kinds that never appeared, for every kind of game", () => {
    const r = puzzle([round({ ...still, end: 16, moves: 10, kinds: {} })], "puzzle", { declared: { style: "puzzle", powerups: ["hint"] } });
    expect(issues(r)).toMatch(/never appeared in the first 15: "hint"/);
  });

  it("tells a game without a canvas to call round() when Play starts nothing", () => {
    expect(judgeRounds(report([], { probes: 0 }), { pressedPlay: true, canvas: false }).issues.join()).toMatch(/round\(true\)/);
  });

  it("reports obstacles made on a timer in an action game whose GameCanvas marks frames, and nowhere else", () => {
    const timed = report([round()], { frames: 300, offFrame: ["oncoming"] });
    expect(issues(timed)).toMatch(/"oncoming" is made on a timer/);
    // An older GameCanvas that doesn't mark frames: can't tell, so silent.
    expect(issues(report([round()], { offFrame: ["oncoming"] }))).not.toMatch(/timer/);
    expect(issues(puzzle([round({ ...still, moves: 12 })], "puzzle", { frames: 300, offFrame: ["bomb"] }))).not.toMatch(/timer/);
  });

  it("judges a game that didn't say its kind as an action game, as before", () => {
    expect(styleOf(report([round()]))).toBe("action");
    expect(styleOf(report([round()], { declared: { style: "turns" } }))).toBe("turns");
    expect(issues(report([round({ speedMax: 200 })]))).toMatch(/didn't get harder/);
  });
});
