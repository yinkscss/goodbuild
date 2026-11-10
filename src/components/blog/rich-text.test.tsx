import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { POSTS } from "@/content/blog";

import { RichText } from "./rich-text";

describe("RichText", () => {
  it("renders bold and links", () => {
    const html = renderToStaticMarkup(<RichText text="**Bold.** See [the guide](/blog/what-is-vibe-coding) and [GoodDollar](https://www.gooddollar.org)." />);
    expect(html).toContain("<strong");
    expect(html).toContain('href="/blog/what-is-vibe-coding"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("**");
  });

  it("leaves no markdown markers in any post's rendered text", () => {
    const leaks: string[] = [];
    for (const p of POSTS) {
      const parts = [p.intro, ...p.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? []), ...(s.steps ?? [])]), ...(p.faq ?? []).map((f) => f.a)];
      for (const t of parts) {
        const html = renderToStaticMarkup(<RichText text={t} />);
        if (/\*\*|\]\(/.test(html)) leaks.push(`${p.slug}: ${t.slice(0, 40)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("escapes markup in text", () => {
    expect(renderToStaticMarkup(<RichText text="<script>x</script>" />)).not.toContain("<script>");
  });
});
