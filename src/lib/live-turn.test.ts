import { describe, expect, it } from "vitest";

import { applyTurnEvent, emptyTurn } from "./live-turn";
import { createSseParser } from "./sse";
import type { TurnEvent } from "./turn-types";

describe("createSseParser", () => {
  it("parses frames split across chunks and skips junk", () => {
    const push = createSseParser<{ n: number }>();
    expect(push('data: {"n":1}\n\ndata: {"n"')).toEqual([{ n: 1 }]);
    expect(push(':2}\n\ndata: not json\n\n')).toEqual([{ n: 2 }]);
    expect(push('\r\ndata: {"n":3}\r\n\r\n')).toEqual([{ n: 3 }]);
  });
});

describe("applyTurnEvent", () => {
  it("builds up a turn from streamed events", () => {
    const events: TurnEvent[] = [
      { type: "start", messageId: "m1", mode: "build" },
      { type: "text", delta: "On it. " },
      { type: "plan", summary: "1 contract", steps: ["a", "b"] },
      { type: "step", step: { id: "s1", label: "Writing TipJar.sol", status: "running" } },
      { type: "step", step: { id: "s1", label: "Writing TipJar.sol", status: "done", detail: "+40" } },
      { type: "log", line: "→ wrote contracts/TipJar.sol" },
      { type: "file", change: { path: "a.ts", op: "create", added: 3, removed: 0, diff: "" } },
      { type: "file", change: { path: "a.ts", op: "edit", added: 4, removed: 1, diff: "" } },
      { type: "usage", chargedMicro: 10, totalChargedMicro: 30 },
      { type: "version", number: 2 },
      { type: "done", status: "ready", summary: "Built" },
    ];
    const t = events.reduce(applyTurnEvent, emptyTurn("build"));
    expect(t).toMatchObject({ messageId: "m1", text: "On it. ", phase: "done" });
    expect(t.record.steps).toEqual([{ id: "s1", label: "Writing TipJar.sol", status: "done", detail: "+40" }]);
    expect(t.record.changes).toEqual([{ path: "a.ts", op: "edit", added: 4, removed: 1, diff: "" }]);
    expect(t.record).toMatchObject({ chargedMicro: 30, version: 2, status: "ready" });
  });

  it("records errors and busy", () => {
    expect(applyTurnEvent(emptyTurn("build"), { type: "error", message: "down" })).toMatchObject({ phase: "error", record: { error: "down" } });
    expect(applyTurnEvent(emptyTurn("plan"), { type: "busy" }).phase).toBe("busy");
  });
});
