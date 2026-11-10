// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { needsOwnBuild } from "@/lib/preview-engine";
import { buildPublishedApp, type PublishedFile } from "@/server/publish/build";

import { checkApp } from "../checks";
import { closeRunCheckBrowser, runCheck } from "../run-check";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { detectKits, kitIdsOf, withKit } from "./index";
import { motion } from "./motion";

const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch(() => false));

/** A landing page written the way the guide asks, with every piece of the kit on it. */
const PAGE = `import { Aurora, GridPattern } from "./fx/Backgrounds";
import { Reveal, Stagger } from "./fx/Reveal";
import { Magnetic, Marquee, SpotlightCard, TiltCard } from "./fx/Surfaces";
import { CountUp, GradientText, RotatingText, SplitText } from "./fx/Text";
import { Button } from "./components/ui/button";

const FEATURES = ["Save in G$", "Pay out in turns", "No bank needed"];

export default function App() {
  return (
    <main className="bg-background text-foreground">
      <section id="hero" className="relative overflow-hidden px-4 py-20 sm:py-28">
        <Aurora strength={0.25} />
        <GridPattern />
        <div className="relative mx-auto max-w-3xl text-center">
          <SplitText as="h1" text="Save together, reach it sooner" className="text-4xl font-semibold tracking-tight sm:text-6xl" />
          <Reveal delay={0.3}>
            <p className="mt-5 text-lg text-muted-foreground">
              A savings circle for <RotatingText words={["friends", "family", "your team"]} /> with <GradientText>no bank</GradientText>.
            </p>
          </Reveal>
          <Reveal delay={0.45}>
            <div className="mt-8 flex justify-center">
              <Magnetic>
                <Button>Start a circle</Button>
              </Magnetic>
            </div>
          </Reveal>
        </div>
      </section>
      <Marquee seconds={20} className="border-y border-border py-4 text-sm text-muted-foreground">
        {FEATURES.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </Marquee>
      <div style={{ height: 1400 }} />
      <section id="features" className="mx-auto max-w-5xl px-4 py-16">
        <Stagger className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <SpotlightCard key={f} className="rounded-2xl border border-border bg-card p-6">
              <h3 className="font-medium">{f}</h3>
            </SpotlightCard>
          ))}
        </Stagger>
        <p id="stat" className="mt-10 text-3xl font-semibold">
          <CountUp to={1280} prefix="G$ " seconds={0.4} />
        </p>
        <TiltCard className="mt-10 rounded-2xl border border-border bg-card p-6">A member card</TiltCard>
      </section>
    </main>
  );
}
`;

const project = (app = PAGE): Record<string, string> => ({ ...withKit(starterFiles(), motion), "src/App.tsx": app });

/** The built app, served to a page from memory the way the run check does. */
async function open(browser: Browser, built: PublishedFile[], options: { reducedMotion?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 }, reducedMotion: options.reducedMotion ? "reduce" : "no-preference" });
  const byPath = new Map(built.map((f) => [f.path, f]));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const file = byPath.get(url.pathname.replace(/^\//, "") || "index.html");
    return file && url.host === "app.test" ? route.fulfill({ status: 200, contentType: file.mime, body: Buffer.from(file.bytes) }) : route.abort();
  });
  const page = await context.newPage();
  await page.goto("http://app.test/");
  await page.waitForSelector("#hero h1");
  return page;
}

const opacityOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => Number(getComputedStyle(el).opacity));

describe("the motion kit", { timeout: 180_000 }, () => {
  let browser: Browser | undefined;
  let built: PublishedFile[] = [];
  beforeAll(async () => {
    built = await buildPublishedApp({ files: project(), assets: [], title: "Circle", hasUndeployedContracts: false, forCheck: true });
    if (hasBrowser) browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await closeRunCheckBrowser();
  });

  it("is picked for pages that have to look good, and not for a plain dApp or a game", () => {
    const wants = (r: string) => detectKits(r, starterFiles()).includes(motion);
    for (const yes of ["A landing page for my coffee kiosk", "A portfolio for my photography", "Make it feel premium, with animations", "a sleek homepage for our DAO", "Add a scroll reveal to the sections"]) expect(wants(yes), yes).toBe(true);
    for (const no of ["A tip jar for our football club", "A flappy bird game", "Class voting for verified students", "An ajo savings circle for 5 friends"]) expect(wants(no), no).toBe(false);
  });

  it("adds no packages and stays on the in-browser preview", () => {
    expect(motion.packages).toEqual({});
    expect(kitIdsOf(project())).toEqual(["motion"]);
    expect(needsOwnBuild(project())).toBe(false);
  });

  it("passes the app check and the type check with a page written the way the guide asks", async () => {
    expect(checkApp(project()).errors).toEqual([]);
    const types = await typeCheck(project());
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("points at the kit when an animation package is imported, with or without the kit on", () => {
    const withImport = (files: Record<string, string>) => checkApp({ ...files, "src/App.tsx": 'import { motion } from "framer-motion";\nexport default function App() { return <motion.div>Hi</motion.div>; }\n' }).errors.map((e) => e.message).join("\n");
    expect(withImport(starterFiles())).toMatch(/motion kit does this with no package: call add_kit\("motion"\)/);
    expect(withImport(project())).toMatch(/read_guide "kit-motion"/);
  });

  it("ships its styles in the published app", () => {
    const css = new TextDecoder().decode(built.find((f) => f.path.endsWith(".css"))!.bytes);
    expect(css).toContain(".fx-reveal");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toMatch(/html\[data-fx="?off"?\] \.fx-reveal/);
  });

  it.skipIf(!hasBrowser)("opens in the run check with no errors", async () => {
    const r = await runCheck(project(), { browser });
    expect(r.ran).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it.skipIf(!hasBrowser)("reveals the hero at once, holds what is below the fold until it is scrolled to, and counts up to the real number", async () => {
    const page = await open(browser!, built);
    await page.waitForTimeout(1500);
    // The headline's words have arrived, and it is still one sentence to a screen reader.
    expect(await opacityOf(page, "#hero h1 .fx-reveal")).toBe(1);
    expect(await page.locator("#hero h1").getAttribute("aria-label")).toBe("Save together, reach it sooner");
    expect((await page.locator("#hero h1").innerText()).replace(/\s+/g, " ")).toBe("Save together, reach it sooner");
    // Below the fold: still waiting.
    expect(await opacityOf(page, "#features .fx-reveal")).toBe(0);
    expect(await page.locator("#stat").innerText()).toBe("G$ 0");
    if (process.env.GB_SHOT_DIR) {
      mkdirSync(process.env.GB_SHOT_DIR, { recursive: true });
      writeFileSync(path.join(process.env.GB_SHOT_DIR, "motion-hero.png"), await page.screenshot());
    }
    await page.locator("#stat").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1600);
    expect(await opacityOf(page, "#features .fx-reveal")).toBe(1);
    expect(await page.locator("#stat").innerText()).toBe("G$ 1,280");
    expect(await page.locator("#stat span").first().getAttribute("aria-label")).toBe("G$ 1,280");
    if (process.env.GB_SHOT_DIR) writeFileSync(path.join(process.env.GB_SHOT_DIR, "motion-features.png"), await page.screenshot());
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("shows everything in its final state for a screenshot (data-fx off) and for people who asked for less motion", async () => {
    const shot = await open(browser!, built);
    await shot.evaluate(() => document.documentElement.setAttribute("data-fx", "off"));
    expect(await opacityOf(shot, "#features .fx-reveal")).toBe(1);
    expect(await shot.locator(".fx-marquee-track").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await shot.context().close();

    const calm = await open(browser!, built, { reducedMotion: true });
    expect(await opacityOf(calm, "#features .fx-reveal")).toBe(1);
    expect(await calm.locator(".fx-aurora span").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await calm.locator("#stat").scrollIntoViewIfNeeded();
    await calm.waitForTimeout(200);
    expect(await calm.locator("#stat").innerText()).toBe("G$ 1,280");
    await calm.context().close();
  });

  it.skipIf(!hasBrowser)("keeps the page no wider than a phone, so the marquee and aurora never cause sideways scrolling", async () => {
    const page = await open(browser!, built);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.context().close();
  });
});

describe("the motion kit in the builder's context", () => {
  it("doesn't spend the context budget on its own files: the guide documents them", async () => {
    const { selectContext } = await import("../codebase");
    const files = project();
    // A mid-size project: the kit's pieces must not push the project's own pages out.
    for (let i = 0; i < 12; i++) files[`src/pages/Page${i}.tsx`] = `export default function Page${i}() { return <main>${"x".repeat(2600)}</main>; }\n`;
    const picked = selectContext(files, "Make the pricing section clearer").map((p) => p.path);
    expect(picked).not.toContain("src/fx/fx.css");
    expect(picked.filter((p) => p.startsWith("src/fx/"))).toEqual([]);
    expect(picked.filter((p) => p.startsWith("src/pages/")).length).toBe(12);
    // A small project still gets them with the budget left over, and never the stylesheet.
    const small = selectContext(project(), "Add a pricing section").map((p) => p.path);
    expect(small).toContain("src/fx/Reveal.tsx");
    expect(small).not.toContain("src/fx/fx.css");
  });
});
