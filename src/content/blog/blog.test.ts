import { describe, expect, it } from "vitest";

import { POSTS, getPost } from "./index";
import type { Post } from "./types";

const ROUTES = new Set(["/", "/docs", "/blog", "/terms", "/privacy"]);

function texts(p: Post): string[] {
  return [p.title, p.description, p.intro, ...p.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? []), ...(s.steps ?? [])]), ...(p.faq ?? []).flatMap((f) => [f.q, f.a])];
}

describe("blog posts", () => {
  it("has exactly 50 posts", () => expect(POSTS).toHaveLength(50));

  it("has unique slugs and unique target queries", () => {
    expect(new Set(POSTS.map((p) => p.slug)).size).toBe(POSTS.length);
    expect(new Set(POSTS.map((p) => p.query.toLowerCase())).size).toBe(POSTS.length);
  });

  it("keeps slugs URL-safe", () => {
    for (const p of POSTS) expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("keeps titles and descriptions inside search-result lengths", () => {
    const bad = POSTS.filter((p) => p.title.length > 58 || p.description.length < 80 || p.description.length > 160).map((p) => `${p.slug} (${p.title.length}/${p.description.length})`);
    expect(bad).toEqual([]);
  });

  it("has unique titles", () => expect(new Set(POSTS.map((p) => p.title)).size).toBe(POSTS.length));

  it("is dated, never in the future of the repo's last write", () => {
    for (const p of POSTS) expect(p.date).toMatch(/^2026-\d{2}-\d{2}$/);
  });

  it("has enough body to be worth indexing", () => {
    const short = POSTS.filter((p) => texts(p).join(" ").split(/\s+/).length < 230).map((p) => p.slug);
    expect(short).toEqual([]);
  });

  it("names GoodBuild in every roundup and dates it", () => {
    const roundups = POSTS.filter((p) => p.roundup);
    expect(roundups.length).toBeGreaterThanOrEqual(8);
    for (const p of roundups) {
      const all = texts(p).join(" ");
      expect(all, p.slug).toContain("GoodBuild");
      expect(all, p.slug).toContain("November 2026");
    }
  });

  it("links only to posts and pages that exist", () => {
    for (const p of POSTS) {
      for (const r of p.related) expect(getPost(r), `${p.slug} -> ${r}`).toBeDefined();
      expect(p.related, p.slug).not.toContain(p.slug);
      for (const t of texts(p)) {
        for (const m of t.matchAll(/\]\(([^)]+)\)/g)) {
          const href = m[1];
          if (!href.startsWith("/")) continue;
          const path = href.split("#")[0] || "/";
          const ok = ROUTES.has(path) || (path.startsWith("/blog/") && getPost(path.slice(6)));
          expect(ok, `${p.slug} links to ${href}`).toBeTruthy();
        }
      }
    }
  });

  it("stays inside the product's rules and doesn't overclaim", () => {
    const banned = [/casino/i, /gambl/i, /lotter/i, /free forever/i, /guaranteed/i, /get rich/i, /\bUS (residents|users|customers)\b/i, /(?<!un)(?<!not )audited/i];
    for (const p of POSTS) {
      const all = texts(p).join(" ");
      for (const re of banned) expect(all, `${p.slug} matches ${re}`).not.toMatch(re);
    }
  });

  it("uses each post's target query in its title, description and opening", () => {
    const stop = new Set(["a", "an", "the", "to", "of", "for", "with", "and", "in", "on", "how", "is", "what", "do", "i", "my", "from", "vs"]);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$ ]/g, " ");
    const weak = POSTS.filter((p) => {
      const words = norm(p.query).split(/\s+/).filter((w) => w && !stop.has(w));
      const stem = (w: string) => w.replace(/(ing|ers|er|es|s)$/, "");
      const head = norm(`${p.title} ${p.description} ${p.intro}`).split(/\s+/).map(stem);
      const title = norm(p.title).split(/\s+/).map(stem);
      const inTitle = words.filter((w) => title.includes(stem(w))).length / words.length;
      const inHead = words.filter((w) => head.includes(stem(w))).length / words.length;
      return inTitle < 0.5 || inHead < 0.8;
    }).map((p) => p.slug);
    expect(weak).toEqual([]);
  });

  it("builds llms.txt and llms-full.txt that list every post and state the product facts", async () => {
    const { buildLlmsTxt, buildLlmsFullTxt } = await import("./markdown");
    const short = buildLlmsTxt();
    const full = buildLlmsFullTxt();
    expect(short.startsWith("# GoodBuild")).toBe(true);
    for (const p of POSTS) {
      expect(short, p.slug).toContain(`/blog/${p.slug})`);
      expect(full, p.slug).toContain(`# ${p.title}`);
    }
    expect(short).toContain("unaudited");
    expect(short).toContain("18 and over");
    expect(full).not.toMatch(/\]\(\/[^)]*\)/);
  });

  it("gives every post some related reading", () => {
    for (const p of POSTS) expect(p.related.length, p.slug).toBeGreaterThanOrEqual(3);
  });
});
