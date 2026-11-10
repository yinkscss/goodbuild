import { describe, expect, it } from "vitest";

import { applyQuery, isQuery, matchesClause, parseClause } from "./app-data";

const rec = (value: unknown, n = 0) => ({ value, createdAt: new Date(1_700_000_000_000 + n), updatedAt: new Date(1_700_000_000_000 + n) });

describe("parseClause", () => {
  it("reads field~op~value, with a JSON value or plain text", () => {
    expect(parseClause("points~gte~10")).toEqual({ field: "points", op: "gte", value: 10 });
    expect(parseClause("won~eq~true")).toEqual({ field: "won", op: "eq", value: true });
    expect(parseClause('player~eq~"Ada"')).toEqual({ field: "player", op: "eq", value: "Ada" });
    expect(parseClause("player~eq~Ada Obi")).toEqual({ field: "player", op: "eq", value: "Ada Obi" });
    expect(parseClause("note~eq~a~b")).toEqual({ field: "note", op: "eq", value: "a~b" });
  });
  it("explains what is wrong", () => {
    for (const bad of ["", "x~like~1", "1x~eq~1", "x~eq~", "x~eq~[1]", "x~eq~null", `x~eq~${"a".repeat(201)}`]) expect(typeof parseClause(bad), bad).toBe("string");
  });
});

describe("matchesClause", () => {
  it("never matches a missing field or a field of another type", () => {
    expect(matchesClause({ a: 1 }, { field: "b", op: "eq", value: 1 })).toBe(false);
    expect(matchesClause({ a: 1 }, { field: "b", op: "ne", value: 1 })).toBe(false);
    expect(matchesClause({ a: "1" }, { field: "a", op: "eq", value: 1 })).toBe(false);
    expect(matchesClause({ a: true }, { field: "a", op: "gt", value: false })).toBe(false);
    expect(matchesClause(null, { field: "a", op: "eq", value: 1 })).toBe(false);
    expect(matchesClause([1], { field: "0", op: "eq", value: 1 })).toBe(false);
    expect(matchesClause({ a: 2 }, { field: "a", op: "lte", value: 2 })).toBe(true);
    expect(matchesClause({ a: "b" }, { field: "a", op: "gt", value: "a" })).toBe(true);
  });
  it("can't be tricked into reading inherited properties", () => {
    expect(matchesClause({}, { field: "constructor", op: "ne", value: "x" })).toBe(false);
    expect(matchesClause({}, { field: "toString", op: "eq", value: "x" })).toBe(false);
  });
});

describe("applyQuery", () => {
  const rows = [rec({ p: 3 }, 1), rec({ p: 1 }, 2), rec({ q: 9 }, 3), rec({ p: 2 }, 4), rec({ p: "x" }, 5)];
  it("filters, then orders, putting records without the field last both ways", () => {
    expect(applyQuery(rows, { where: [{ field: "p", op: "gte", value: 2 }], order: { field: "p", dir: "asc" } }).map((r) => (r.value as { p: number }).p)).toEqual([2, 3]);
    const asc = applyQuery(rows, { where: [], order: { field: "p", dir: "asc" } }).map((r) => JSON.stringify(r.value));
    const desc = applyQuery(rows, { where: [], order: { field: "p", dir: "desc" } }).map((r) => JSON.stringify(r.value));
    expect(asc.at(-1)).toBe('{"q":9}');
    expect(desc.at(-1)).toBe('{"q":9}');
    expect(asc.slice(0, 3)).toEqual(['{"p":1}', '{"p":2}', '{"p":3}']);
  });
  it("orders by time, and leaves the order alone without one", () => {
    expect(applyQuery(rows, { where: [], order: { field: "createdAt", dir: "desc" } })[0]).toBe(rows[4]);
    expect(applyQuery(rows, { where: [] })).toEqual(rows);
  });
  it("knows when a list is a query", () => {
    expect(isQuery(undefined)).toBe(false);
    expect(isQuery({ where: [] })).toBe(false);
    expect(isQuery({ where: [], since: 0 })).toBe(true);
    expect(isQuery({ where: [], order: { field: "p", dir: "asc" } })).toBe(true);
  });
});
