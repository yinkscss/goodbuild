import { describe, expect, it } from "vitest";

import { PRIVATE_RULE, describeRule, parseDataRules, ruleFor } from "./app-data";

const parse = (collections: unknown) => parseDataRules(JSON.stringify({ collections }));

describe("per-app rules (D34)", () => {
  it("reads a full rule and fills in safe defaults", () => {
    const { rules, issues } = parse({ bookings: { create: "anyone", read: ["writer", "owner"], public: ["day"], fields: { name: "string", day: "string" }, unique: ["day"] }, plain: {} });
    expect(issues).toEqual([]);
    expect(rules.bookings).toEqual({ create: "anyone", read: ["writer", "owner"], update: ["writer"], delete: ["writer"], public: ["day"], fields: { name: "string", day: "string" }, unique: ["day"] });
    expect(rules.plain).toEqual(PRIVATE_RULE);
  });

  it("reads back what publishing stored", () => {
    const { rules } = parse({ b: { create: "anyone", read: ["owner"], update: [] } });
    expect(ruleFor(rules as Record<string, unknown>, "b")).toEqual(rules.b);
  });

  it("refuses roles, settings and fields it doesn't know, rather than guessing", () => {
    expect(parse({ a: { read: ["everyone"] } }).issues[0]).toContain('"read"');
    expect(parse({ a: { create: "admin" } }).issues[0]).toContain('"create"');
    expect(parse({ a: { update: ["owner"] } }).issues[0]).toContain('"update"');
    expect(parse({ a: { readers: ["anyone"] } }).issues[0]).toContain('unknown setting "readers"');
    expect(parse({ a: { fields: { name: "text" } } }).issues[0]).toContain('"string", "number" or "boolean"');
    expect(parse({ a: { fields: { name: "string" }, public: ["phone"] } }).issues[0]).toContain("phone");
    expect(parse({ a: { read: ["writer"] } }).rules.a).toBeDefined();
    expect(parse({ a: { read: ["writer"], create: "admin" } }).rules.a).toBeUndefined();
  });

  it("won't let a unique field stay private, because a refused duplicate would reveal it", () => {
    expect(parse({ a: { unique: ["phone"] } }).issues[0]).toContain('"unique"');
    expect(parse({ a: { unique: ["day"], public: ["day"] } }).issues).toEqual([]);
    expect(parse({ a: { unique: ["day"], read: ["anyone"] } }).issues).toEqual([]);
  });

  it("anything unreadable at read time is private", () => {
    expect(ruleFor({ a: { read: ["everyone"] } }, "a")).toEqual(PRIVATE_RULE);
    expect(ruleFor({}, "toString")).toEqual(PRIVATE_RULE);
  });

  it("says who can read in plain words", () => {
    expect(describeRule(parse({ a: { read: ["writer", "owner"], public: ["day"] } }).rules.a)).toEqual({ who: "Only you and the person who sent it can read it", publicFields: ["day"] });
    expect(describeRule(parse({ a: "public-read" }).rules.a).who).toBe("Anyone can read it");
  });
});

describe("email sign-in settings (D35)", () => {
  it("is off unless dataRules.json asks for it, and refuses anything else", async () => {
    const { parseSignIn } = await import("./app-data");
    expect(parseSignIn(undefined)).toEqual({ email: false, issues: [] });
    expect(parseSignIn('{"collections":{}}').email).toBe(false);
    expect(parseSignIn('{"signIn":{"email":true},"collections":{}}')).toEqual({ email: true, issues: [] });
    expect(parseSignIn('{"signIn":{"email":"yes"}}').issues).toHaveLength(1);
    expect(parseSignIn('{"signIn":{"email":true,"sms":true}}').issues).toHaveLength(1);
    expect(parseSignIn('{"signIn":true}').issues).toHaveLength(1);
  });

  it("takes exactly one plain address", async () => {
    const { normalizeEmail } = await import("./app-data");
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("a.da+salon@mail.example.ng")).toBe("a.da+salon@mail.example.ng");
    for (const bad of ["a@b", "a@@b.com", "a,b@c.com", "a@b.com\nbcc:x@y.com", "<a@b.com>", ".a@b.com", "a..b@c.com", "a@-b.com", "", 7]) expect(normalizeEmail(bad)).toBeNull();
  });
});
