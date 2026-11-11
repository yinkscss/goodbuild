// @vitest-environment node
import { describe, expect, it } from "vitest";

import { judgeRounds, standInWalletScript, type ProbeReport, type ProbeRound } from "./game-check";

const round = (over: Partial<ProbeRound> = {}): ProbeRound => ({ start: 0, end: 12, frames: 400, score0: 0, scoreMax: 50, speed0: 200, speedMax: 260, xMin: 90, xMax: 270, yMin: 520, yMax: 520, firstHazard: 1.2, ...over });
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
    const missing = report([round({ end: 16 })], { seen: { oncoming: 1 } });
    expect(issues(missing)).toMatch(/never appeared: "nitro", "rival"/);
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
