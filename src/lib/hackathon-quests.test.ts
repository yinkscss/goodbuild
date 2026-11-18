import { expect, it } from "vitest";
import { buildQuests, type QuestInput } from "./hackathon-quests";

const base: QuestInput = {
  registered: false, deployClaimed: false, published: false,
  approvalsGiven: 0, maxApprovals: 3, approvalsReceived: 0, rank: null, prizeSlots: 20,
};
const ids = (q: { id: string; done?: boolean; earned?: boolean }[]) => q.filter((x) => x.done ?? x.earned).map((x) => x.id);

it("starts with nothing done and no league", () => {
  const r = buildQuests(base);
  expect(r.done).toBe(0);
  expect(r.league).toBeNull();
  expect(ids(r.badges)).toEqual([]);
});

it("marks quests as the person gets through them", () => {
  const r = buildQuests({ ...base, registered: true, deployClaimed: true, published: true, approvalsGiven: 3 });
  expect(ids(r.quests)).toEqual(["register", "deploy", "publish", "vote"]);
  expect(ids(r.badges)).toEqual(["first-approval", "full-ballot", "published"]);
});

it("awards leagues by approvals received and the prize zone by rank", () => {
  expect(buildQuests({ ...base, approvalsReceived: 9 }).league).toBeNull();
  expect(buildQuests({ ...base, approvalsReceived: 10 }).league).toBe("Bronze");
  const gold = buildQuests({ ...base, approvalsReceived: 100, rank: 20 });
  expect(gold.league).toBe("Gold");
  expect(ids(gold.quests)).toEqual(["ten", "zone"]);
  expect(ids(gold.badges)).toEqual(["bronze", "silver", "gold", "prize-zone"]);
  expect(ids(buildQuests({ ...base, rank: 21 }).quests)).toEqual([]);
});

it("never offers G$ as a quest reward", () => {
  const rewards = buildQuests(base).quests.map((q) => q.reward);
  expect(rewards.some((r) => /G\$/.test(r))).toBe(false);
});
