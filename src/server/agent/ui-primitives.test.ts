// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPublishedApp, type PublishedFile } from "@/server/publish/build";

import { MAX_FILES, checkApp, pathProblem } from "./checks";
import { selectContext } from "./codebase";
import { GUIDES, loadGuides } from "./guides";
import { systemPrompt } from "./prompt";
import { closeRunCheckBrowser, runCheck } from "./run-check";
import { starterFiles, withStarterHelpers } from "./template";
import { typeCheck } from "./type-check";
import { UI_GUIDE, UI_PRIMITIVE_NAMES, UI_PRIMITIVES } from "./ui-primitives";

const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch(() => false));

/** A page that uses every piece the way the guide shows. */
const PAGE = `import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion";
import { Avatar } from "./components/ui/avatar";
import { Button } from "./components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select } from "./components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./components/ui/sheet";
import { Switch } from "./components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { toast } from "./components/ui/toast";
import { Tooltip } from "./components/ui/tooltip";

export default function App() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("gd");
  const [closed, setClosed] = useState(false);
  const [picked, setPicked] = useState("none");
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" id="menu">Menu</Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Lagos Circle</SheetTitle>
            </SheetHeader>
            <a href="#/about" id="sheet-link">About</a>
          </SheetContent>
        </Sheet>
        <Avatar address="0x80fB000000000000000000000000000000007AD" />
        <Avatar name="Ada Obi" src="/assets/missing.png" size={48} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" aria-label="More" id="more"><MoreHorizontal className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Circle</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setPicked("share")}>Share</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPicked("leave")} className="text-danger">Leave</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <p id="picked">{picked}</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button id="tip">Send a tip</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a tip</DialogTitle>
            <DialogDescription>Goes straight to the club.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" inputMode="decimal" />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" id="cancel">Cancel</Button>
            </DialogClose>
            <Button id="send" onClick={() => { setOpen(false); toast.success("Tip sent", { description: "Thank you." }); }}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p id="open">{open ? "open" : "closed"}</p>

      <Tabs defaultValue="buy" id-prefix="x">
        <TabsList aria-label="Trade">
          <TabsTrigger value="buy">Buy</TabsTrigger>
          <TabsTrigger value="sell">Sell</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
        </TabsList>
        <TabsContent value="buy">Buy panel</TabsContent>
        <TabsContent value="sell">Sell panel</TabsContent>
        <TabsContent value="swap">Swap panel</TabsContent>
      </Tabs>

      <div>
        <Label htmlFor="token">Token</Label>
        <Select id="token" value={token} onChange={(e) => setToken(e.target.value)}>
          <option value="gd">G$</option>
          <option value="cusd">cUSD</option>
        </Select>
        <p id="token-value">{token}</p>
      </div>

      <div className="flex items-center gap-3">
        <Switch id="closed" checked={closed} onCheckedChange={setClosed} />
        <Label htmlFor="closed">Show closed votes</Label>
        <span id="closed-value">{closed ? "on" : "off"}</span>
      </div>

      <Tooltip content="Copy address">
        <button id="copy" aria-label="Copy address" onClick={() => toast("Copied")}>Copy</button>
      </Tooltip>

      <Accordion type="single" defaultValue="a">
        <AccordionItem value="a">
          <AccordionTrigger>How do I join?</AccordionTrigger>
          <AccordionContent>Connect a wallet. <a href="#/join" id="join-link">Join</a></AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>What does it cost?</AccordionTrigger>
          <AccordionContent>Nothing. <a href="#/fees" id="fees-link">Fees</a></AccordionContent>
        </AccordionItem>
      </Accordion>
    </main>
  );
}
`.replace(' id-prefix="x"', "");

const project = (): Record<string, string> => ({ ...starterFiles(), "src/App.tsx": PAGE });

async function open(browser: Browser, built: PublishedFile[], viewport = { width: 390, height: 780 }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const byPath = new Map(built.map((f) => [f.path, f]));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const file = byPath.get(url.pathname.replace(/^\//, "") || "index.html");
    return file && url.host === "app.test" ? route.fulfill({ status: 200, contentType: file.mime, body: Buffer.from(file.bytes) }) : route.abort();
  });
  const page = await context.newPage();
  await page.goto("http://app.test/");
  await page.waitForSelector("#tip");
  return page;
}

const focused = (page: Page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim() || document.activeElement?.tagName);

describe("the ten further UI pieces (D88)", { timeout: 180_000 }, () => {
  let browser: Browser | undefined;
  let built: PublishedFile[] = [];
  beforeAll(async () => {
    built = await buildPublishedApp({ files: project(), assets: [], title: "Pieces", hasUndeployedContracts: false, forCheck: true });
    if (hasBrowser) browser = await chromium.launch({ headless: true });
    if (process.env.GB_SHOT_DIR) mkdirSync(process.env.GB_SHOT_DIR, { recursive: true });
  });
  afterAll(async () => {
    await browser?.close();
    await closeRunCheckBrowser();
  });

  it("are in every new project, where the builder may read them, and reach a project made before them", () => {
    const starter = starterFiles();
    for (const name of UI_PRIMITIVE_NAMES) {
      const file = `src/components/ui/${name}.tsx`;
      expect(starter[file], file).toBe(UI_PRIMITIVES[file]);
      expect(pathProblem(file)).toBeNull();
    }
    expect(Object.keys(UI_PRIMITIVES)).toHaveLength(UI_PRIMITIVE_NAMES.length + 1);
    const old = { ...starter };
    for (const p of Object.keys(UI_PRIMITIVES)) delete old[p];
    old["src/components/ui/dialog.tsx"] = "// the project's own dialog\n";
    const now = withStarterHelpers(old);
    expect(now["src/components/ui/tabs.tsx"]).toBe(UI_PRIMITIVES["src/components/ui/tabs.tsx"]);
    // Never over a file the project already has under that name.
    expect(now["src/components/ui/dialog.tsx"]).toBe("// the project's own dialog\n");
    // The file limit went up with them, so an app has as much room for its own files as before (80 less the old starter's 27).
    expect(MAX_FILES - Object.keys(starter).length).toBeGreaterThanOrEqual(80 - 27);
  });

  it("are written as plain strings: no template syntax leaked into the app's source", () => {
    for (const [file, source] of Object.entries(UI_PRIMITIVES)) {
      expect(source, file).not.toContain("${");
      expect(source, file).not.toContain("`");
    }
  });

  it("pass the app check and the type check on a page that uses every one", async () => {
    expect(checkApp(project()).errors).toEqual([]);
    const types = await typeCheck(project());
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("are named in the builder's prompt and documented in a guide, one line each", () => {
    const prompt = systemPrompt("build");
    for (const name of UI_PRIMITIVE_NAMES) expect(prompt).toContain(name);
    expect(prompt).toContain("- ui-components:");
    expect(GUIDES.find((g) => g.name === "ui-components")?.body).toBe(UI_GUIDE);
    for (const name of UI_PRIMITIVE_NAMES) expect(UI_GUIDE).toContain(`- ${name}.tsx:`);
    expect(loadGuides(["ui-components"]).loaded).toEqual(["ui-components"]);
    expect(UI_GUIDE).not.toContain("—");
  });

  it("don't ride along in the context of every turn: the manifest and the guide are enough", () => {
    const picked = selectContext(project(), "Change the headline").map((p) => p.path);
    for (const file of Object.keys(UI_PRIMITIVES)) expect(picked, file).not.toContain(file);
    // The first eight still do, as before.
    expect(picked).toContain("src/components/ui/button.tsx");
  });

  it.skipIf(!hasBrowser)("open in the run check with no errors", async () => {
    const r = await runCheck(project(), { browser });
    expect(r.ran).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it.skipIf(!hasBrowser)("dialog: opens in the middle with focus inside, is named by its title, and closes on Escape, Cancel and a tap outside, giving focus back", async () => {
    const page = await open(browser!, built);
    await page.click("#tip");
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    expect(await page.locator("#open").innerText()).toBe("open");
    // Named and described for a screen reader.
    expect(await page.getByRole("dialog", { name: "Send a tip" }).count()).toBe(1);
    expect(await dialog.evaluate((el) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent)).toBe("Goes straight to the club.");
    // Focus moved inside, and the page behind can't scroll.
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    // In the middle of the screen, inside its edges (once it has finished arriving).
    await page.waitForTimeout(300);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 8);
    expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - 390)).toBeLessThan(2);
    if (process.env.GB_SHOT_DIR) writeFileSync(path.join(process.env.GB_SHOT_DIR, "ui-dialog.png"), await page.screenshot());
    // Tab never reaches the page behind it. (Past the last control the browser takes focus to its own
    // toolbar, which reads as the body here, and then back into the dialog.)
    const reached = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
      reached.add(String(await focused(page)));
    }
    expect([...reached]).toEqual(expect.arrayContaining(["amount", "cancel", "send"]));
    expect(reached.has("menu") || reached.has("tip") || reached.has("copy")).toBe(false);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("open")?.textContent === "closed");
    expect(await page.locator("dialog[open]").count()).toBe(0);
    expect(await focused(page)).toBe("tip");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    await page.click("#tip");
    await page.click("#cancel");
    await page.waitForFunction(() => document.getElementById("open")?.textContent === "closed");

    await page.click("#tip");
    await page.locator("dialog[open]").waitFor();
    // A tap on the dimmed page, well away from the dialog.
    await page.mouse.click(195, 20);
    await page.waitForFunction(() => document.getElementById("open")?.textContent === "closed");
    // A tap inside it doesn't close it.
    await page.click("#tip");
    await page.click("#amount");
    expect(await page.locator("#open").innerText()).toBe("open");
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("sheet: slides in from its edge at full height, and closes on Escape", async () => {
    const page = await open(browser!, built);
    await page.click("#menu");
    const sheet = page.locator("dialog[open]");
    await sheet.waitFor();
    await page.waitForTimeout(350);
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.height).toBe(780);
    expect(box.width).toBeLessThan(390);
    expect(await page.getByRole("dialog", { name: "Lagos Circle" }).count()).toBe(1);
    if (process.env.GB_SHOT_DIR) writeFileSync(path.join(process.env.GB_SHOT_DIR, "ui-sheet.png"), await page.screenshot());
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    expect(await focused(page)).toBe("menu");
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("tabs: one panel at a time, arrows move and choose, and only the chosen tab takes Tab", async () => {
    const page = await open(browser!, built);
    expect(await page.getByRole("tabpanel").innerText()).toBe("Buy panel");
    await page.getByRole("tab", { name: "Buy" }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.getByRole("tabpanel").innerText()).toBe("Sell panel");
    expect(await page.getByRole("tab", { name: "Sell" }).getAttribute("aria-selected")).toBe("true");
    expect(await page.getByRole("tab", { name: "Buy" }).getAttribute("tabindex")).toBe("-1");
    await page.keyboard.press("End");
    expect(await page.getByRole("tabpanel").innerText()).toBe("Swap panel");
    await page.keyboard.press("ArrowRight");
    expect(await page.getByRole("tabpanel").innerText()).toBe("Buy panel");
    // The panel is tied to its tab.
    const panel = page.getByRole("tabpanel");
    expect(await panel.evaluate((el) => document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent)).toBe("Buy");
    await page.getByRole("tab", { name: "Sell" }).click();
    expect(await page.getByRole("tabpanel").innerText()).toBe("Sell panel");
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("dropdown menu: opens under its button, arrows move through it, an item runs and closes it, Escape returns to the button", async () => {
    const page = await open(browser!, built);
    await page.click("#more");
    const menu = page.getByRole("menu");
    await menu.waitFor();
    expect(await focused(page)).toBe("Share");
    await page.keyboard.press("ArrowDown");
    expect(await focused(page)).toBe("Leave");
    await page.keyboard.press("ArrowDown");
    expect(await focused(page)).toBe("Share");
    // Inside the screen, not off its right edge.
    const box = (await menu.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Enter");
    expect(await page.locator("#picked").innerText()).toBe("share");
    expect(await page.getByRole("menu").count()).toBe(0);
    expect(await focused(page)).toBe("more");

    await page.keyboard.press("ArrowDown");
    await page.getByRole("menu").waitFor();
    await page.keyboard.press("Escape");
    expect(await page.getByRole("menu").count()).toBe(0);
    expect(await focused(page)).toBe("more");
    expect(await page.locator("#more").getAttribute("aria-expanded")).toBe("false");

    // A tap elsewhere closes it.
    await page.click("#more");
    await page.getByRole("menu").waitFor();
    await page.click("#picked");
    expect(await page.getByRole("menu").count()).toBe(0);
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("select, switch and tooltip: the browser's own select with its label, a switch that says its state, a tooltip on focus", async () => {
    const page = await open(browser!, built);
    await page.getByLabel("Token").selectOption("cusd");
    expect(await page.locator("#token-value").innerText()).toBe("cusd");
    expect(await page.locator("#token").evaluate((el) => el.tagName)).toBe("SELECT");

    const toggle = page.getByRole("switch", { name: "Show closed votes" });
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await toggle.focus();
    await page.keyboard.press("Space");
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    expect(await page.locator("#closed-value").innerText()).toBe("on");
    // Its label toggles it too.
    await page.getByText("Show closed votes").click();
    expect(await page.locator("#closed-value").innerText()).toBe("off");

    expect(await page.getByRole("tooltip").count()).toBe(0);
    await page.locator("#copy").focus();
    expect(await page.getByRole("tooltip").innerText()).toBe("Copy address");
    expect(await page.locator("#copy").getAttribute("aria-describedby")).toBe(await page.getByRole("tooltip").getAttribute("id"));
    await page.keyboard.press("Escape");
    expect(await page.getByRole("tooltip").count()).toBe(0);
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("toast: appears with no setup, is announced, can be dismissed, and goes by itself", async () => {
    const page = await open(browser!, built);
    await page.click("#copy");
    const note = page.getByRole("status").filter({ hasText: "Copied" });
    await note.waitFor();
    // One place for them, and it is a live region.
    expect(await page.getByRole("region", { name: "Notifications" }).getAttribute("aria-live")).toBe("polite");
    await page.waitForTimeout(250);
    const box = (await note.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // On a phone it is clear of GoodBuild's badge, which sits at the bottom left of a published app.
    const badge = (await page.locator("[data-goodbuild-bar]").boundingBox())!;
    expect(box.y + box.height).toBeLessThan(badge.y);
    if (process.env.GB_SHOT_DIR) writeFileSync(path.join(process.env.GB_SHOT_DIR, "ui-toast.png"), await page.screenshot());
    await note.getByRole("button", { name: "Dismiss" }).click();
    expect(await page.getByRole("status").filter({ hasText: "Copied" }).count()).toBe(0);

    // From inside a dialog's action, with a description, and gone after its time.
    await page.click("#tip");
    await page.click("#send");
    await page.getByText("Thank you.").waitFor();
    await page.waitForFunction(() => !document.body.textContent?.includes("Thank you."), undefined, { timeout: 6_000 });
    await page.context().close();

    // On a wide screen: bottom right, away from the badge at the bottom left.
    const wide = await open(browser!, built, { width: 1280, height: 800 });
    await wide.click("#copy");
    const wideNote = wide.getByRole("status").filter({ hasText: "Copied" });
    await wideNote.waitFor();
    await wide.waitForTimeout(250);
    const wideBox = (await wideNote.boundingBox())!;
    expect(wideBox.x + wideBox.width).toBeGreaterThan(1280 - 40);
    expect(wideBox.y + wideBox.height).toBeGreaterThan(800 - 40);
    await wide.context().close();
  });

  it.skipIf(!hasBrowser)("accordion: one open at a time, the button says so, and a link in a closed section can't be reached", async () => {
    const page = await open(browser!, built);
    const first = page.getByRole("button", { name: "How do I join?" });
    const second = page.getByRole("button", { name: "What does it cost?" });
    expect(await first.getAttribute("aria-expanded")).toBe("true");
    expect(await second.getAttribute("aria-expanded")).toBe("false");
    expect(await page.locator("#fees-link").isVisible()).toBe(false);
    await second.click();
    await page.waitForTimeout(300);
    expect(await first.getAttribute("aria-expanded")).toBe("false");
    expect(await page.locator("#fees-link").isVisible()).toBe(true);
    expect(await page.locator("#join-link").isVisible()).toBe(false);
    // Tab from the open section's link doesn't land in the closed one.
    await second.focus();
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("fees-link");
    // Closing the open one works too.
    await second.click();
    expect(await second.getAttribute("aria-expanded")).toBe("false");
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("avatar: the same colour for the same wallet, and initials when the picture fails to load", async () => {
    const page = await open(browser!, built);
    const wallet = page.getByRole("img", { name: "0x80fB…07AD" });
    expect(await wallet.innerText()).toBe("80");
    const colour = await wallet.evaluate((el) => (el as HTMLElement).style.background);
    expect(colour).toMatch(/linear-gradient/);
    const person = page.getByRole("img", { name: "Ada Obi" });
    await page.waitForFunction(() => document.querySelector('[aria-label="Ada Obi"]')?.textContent === "AO");
    expect((await person.boundingBox())!.width).toBe(48);
    await page.reload();
    await page.waitForSelector("#tip");
    expect(await page.getByRole("img", { name: "0x80fB…07AD" }).evaluate((el) => (el as HTMLElement).style.background)).toBe(colour);
    await page.context().close();
  });

  it.skipIf(!hasBrowser)("fit a phone: nothing scrolls sideways with every piece on the page", async () => {
    const page = await open(browser!, built);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.context().close();
  });
});
