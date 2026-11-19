import type { Page } from "playwright-core";

import type { CheckIssue } from "./checks";

/**
 * Acceptance flows (D152, harness v2, docs/HARNESS_V2_PLAN.md WS3): short browser scripts the spec call writes
 * before the interface exists, run against the built app by the run check. A small JSON language, not code:
 * the checker runs nothing the model wrote except the app itself, and a bad flow is a validation error.
 */

export type Locator = { text: string } | { role: string; name?: string } | { label: string } | { placeholder: string } | { testid: string };

export type Step =
  | { goto: string }
  | { click: Locator }
  | { fill: Locator; value: string }
  | { press: string }
  | { expect: Locator | { hidden: string } | { route: string } }
  | { wait: number }
  | { connectWallet: true };

export type Needs = "local" | "wallet" | "deployed";

export interface Flow {
  name: string;
  needs: Needs;
  steps: Step[];
}

export interface FlowResult {
  name: string;
  needs: Needs;
  status: "pass" | "fail" | "skipped";
  /** 1-based number of the step that failed. */
  step?: number;
  /** Why it failed or was skipped. */
  reason?: string;
  /** The page as text where it failed (headings, buttons, links, inputs, text). */
  outline?: string;
}

export const MAX_FLOWS = 8;
export const MAX_STEPS = 20;
export const STEP_MS = 2_000;
export const FLOW_MS = 20_000;
export const ALL_FLOWS_MS = 60_000;

/** ARIA roles a flow may name. Playwright accepts more; these are the ones an app's controls and regions have. */
const ROLES = new Set(["button", "link", "heading", "textbox", "checkbox", "radio", "combobox", "listbox", "option", "tab", "tabpanel", "dialog", "alert", "status", "switch", "slider", "spinbutton", "menu", "menuitem", "list", "listitem", "img", "table", "row", "cell", "navigation", "banner", "main", "region", "article", "form", "progressbar"]);
const KEYS = /^(?:Enter|Escape|Tab|Space|Backspace|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|[A-Za-z0-9])$/;

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function parseLocator(raw: unknown): Locator | string {
  if (!isObject(raw)) return "a locator is an object such as {\"role\": \"button\", \"name\": \"Send\"} or {\"text\": \"...\"}";
  if (raw.role !== undefined) {
    const role = str(raw.role, 40)?.toLowerCase();
    if (!role || !ROLES.has(role)) return `role "${String(raw.role)}" isn't one a flow can use (button, link, heading, textbox, checkbox, tab, dialog, ...)`;
    const name = raw.name === undefined ? undefined : str(raw.name);
    if (raw.name !== undefined && !name) return "a role's name must be text";
    return name ? { role, name } : { role };
  }
  for (const key of ["text", "label", "placeholder", "testid"] as const) {
    if (raw[key] !== undefined) {
      const value = str(raw[key]);
      return value ? ({ [key]: value } as Locator) : `${key} must be text`;
    }
  }
  return "a locator needs text, role (with name), label, placeholder or testid";
}

function parseStep(raw: unknown): Step | string {
  if (!isObject(raw)) return "each step is an object";
  if ("goto" in raw) {
    const route = str(raw.goto, 120);
    return route ? { goto: route.startsWith("/") ? route : `/${route}` } : "goto needs a route such as \"/\" or \"/about\"";
  }
  if ("click" in raw) {
    const loc = parseLocator(raw.click);
    return typeof loc === "string" ? `click: ${loc}` : { click: loc };
  }
  if ("fill" in raw) {
    const loc = parseLocator(raw.fill);
    if (typeof loc === "string") return `fill: ${loc}`;
    if (typeof raw.value !== "string" && typeof raw.value !== "number") return "fill needs a value";
    return { fill: loc, value: String(raw.value).slice(0, 200) };
  }
  if ("press" in raw) {
    const key = str(raw.press, 20);
    return key && KEYS.test(key) ? { press: key } : "press takes one key such as Enter, Escape or Tab";
  }
  if ("expect" in raw) {
    const e = raw.expect;
    if (isObject(e) && e.hidden !== undefined) return str(e.hidden) ? { expect: { hidden: str(e.hidden)! } } : "expect hidden needs the text that must not show";
    if (isObject(e) && e.route !== undefined) {
      const route = str(e.route, 120);
      return route ? { expect: { route: route.startsWith("/") ? route : `/${route}` } } : "expect route needs a route";
    }
    const loc = parseLocator(e);
    return typeof loc === "string" ? `expect: ${loc}` : { expect: loc };
  }
  if ("wait" in raw) {
    const ms = Number(raw.wait);
    return Number.isFinite(ms) && ms > 0 ? { wait: Math.min(Math.round(ms), STEP_MS) } : "wait takes milliseconds, at most 2000";
  }
  if ("connectWallet" in raw) return { connectWallet: true };
  return `unknown step ${JSON.stringify(Object.keys(raw)).slice(0, 80)}: use goto, click, fill, press, expect, wait or connectWallet`;
}

/** Valid flows, and a line for each problem (flow name and step number), for the spec call to fix. */
export function parseFlows(raw: unknown): { flows: Flow[]; problems: string[] } {
  const flows: Flow[] = [];
  const problems: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_FLOWS) problems.push(`at most ${MAX_FLOWS} flows; ${list.length} were given`);
  for (const [i, f] of list.slice(0, MAX_FLOWS).entries()) {
    const label = isObject(f) && str(f.name) ? `"${str(f.name)}"` : `flow ${i + 1}`;
    if (!isObject(f)) {
      problems.push(`${label}: a flow is an object with name, needs and steps`);
      continue;
    }
    const before = problems.length;
    const name = str(f.name, 120);
    if (!name) problems.push(`${label}: needs a name`);
    const needs = f.needs === undefined ? "local" : f.needs;
    if (!["local", "wallet", "deployed"].includes(String(needs))) problems.push(`${label}: needs is local, wallet or deployed`);
    const rawSteps = Array.isArray(f.steps) ? f.steps : [];
    if (!rawSteps.length) problems.push(`${label}: needs at least one step`);
    if (rawSteps.length > MAX_STEPS) problems.push(`${label}: at most ${MAX_STEPS} steps`);
    const steps: Step[] = [];
    for (const [n, s] of rawSteps.slice(0, MAX_STEPS).entries()) {
      const step = parseStep(s);
      if (typeof step === "string") problems.push(`${label} step ${n + 1}: ${step}`);
      else steps.push(step);
    }
    // A flow with any problem is left out whole: a shortened flow would test something else.
    if (name && problems.length === before) flows.push({ name, needs: needs as Needs, steps });
  }
  return { flows, problems };
}

export function describeLocator(l: Locator): string {
  if ("role" in l) return l.name ? `${l.role} "${l.name}"` : `a ${l.role}`;
  if ("text" in l) return `text "${l.text}"`;
  if ("label" in l) return `the field labelled "${l.label}"`;
  if ("placeholder" in l) return `the field with placeholder "${l.placeholder}"`;
  return `[data-testid="${l.testid}"]`;
}

export function describeStep(s: Step): string {
  if ("goto" in s) return `go to ${s.goto}`;
  if ("click" in s) return `click ${describeLocator(s.click)}`;
  if ("fill" in s) return `type "${s.value}" into ${describeLocator(s.fill)}`;
  if ("press" in s) return `press ${s.press}`;
  if ("wait" in s) return `wait ${s.wait} ms`;
  if ("connectWallet" in s) return "connect the wallet";
  const e = s.expect;
  if ("hidden" in e) return `expect "${e.hidden}" not to show`;
  if ("route" in e) return `expect to be on ${e.route}`;
  return `expect ${describeLocator(e)} to show`;
}

function locate(page: Page, l: Locator) {
  if ("role" in l) return page.getByRole(l.role as Parameters<Page["getByRole"]>[0], l.name ? { name: l.name } : {}).first();
  if ("text" in l) return page.getByText(l.text).first();
  if ("label" in l) return page.getByLabel(l.label).first();
  if ("placeholder" in l) return page.getByPlaceholder(l.placeholder).first();
  return page.getByTestId(l.testid).first();
}

export interface FlowRunner {
  /** A fresh page for a flow, already served the built app, with the stand-in wallet when asked for. */
  newPage(wallet: boolean): Promise<Page>;
  /** Open the app's home page and wait for its first render. */
  open(page: Page): Promise<void>;
  /** Connect the stand-in wallet through the app's own Connect wallet button. Returns why it couldn't, or null. */
  connectWallet(page: Page): Promise<string | null>;
  /** The page as text, for a failure report. */
  outline(page: Page): Promise<string>;
}

async function runFlow(flow: Flow, runner: FlowRunner, deadline: number): Promise<FlowResult> {
  const base = { name: flow.name, needs: flow.needs };
  if (flow.needs === "deployed") return { ...base, status: "skipped", reason: "needs a deployed contract, so it is listed as unverified until the app is live" };
  const page = await runner.newPage(flow.needs === "wallet");
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push((error.message || String(error)).split("\n")[0].slice(0, 300)));
  const flowEnds = Math.min(deadline, Date.now() + FLOW_MS);
  let at = 0;
  try {
    await runner.open(page);
    for (const [i, step] of flow.steps.entries()) {
      at = i + 1;
      if (Date.now() > flowEnds) throw new Error("the flow ran out of time");
      const timeout = Math.max(250, Math.min(STEP_MS, flowEnds - Date.now()));
      if ("goto" in step) {
        await page.evaluate((r) => {
          window.location.hash = `#${r}`;
        }, step.goto);
        await page.waitForTimeout(300);
      } else if ("click" in step) {
        await locate(page, step.click).click({ timeout });
        await page.waitForTimeout(150);
      } else if ("fill" in step) {
        await locate(page, step.fill).fill(step.value, { timeout });
      } else if ("press" in step) {
        await page.keyboard.press(step.press === "Space" ? " " : step.press);
        await page.waitForTimeout(150);
      } else if ("wait" in step) {
        await page.waitForTimeout(step.wait);
      } else if ("connectWallet" in step) {
        const why = await runner.connectWallet(page);
        if (why) throw new Error(why);
      } else {
        const e = step.expect;
        if ("hidden" in e) await page.getByText(e.hidden).first().waitFor({ state: "hidden", timeout });
        else if ("route" in e) await page.waitForFunction((r) => (window.location.hash.replace(/^#/, "") || "/") === r, e.route, { timeout });
        else await locate(page, e).waitFor({ state: "visible", timeout });
      }
      if (crashes.length) throw new Error(`the app crashed: ${crashes[0]}`);
    }
    return { ...base, status: "pass" };
  } catch (error) {
    const message = String((error as Error)?.message ?? error).split("\n")[0].replace(/^[a-zA-Z.]+: /, "").slice(0, 300);
    const step = flow.steps[at - 1];
    const reason = crashes.length ? `the app crashed: ${crashes[0]}` : step ? `step ${at} (${describeStep(step)}) failed: ${message}` : `the app didn't open: ${message}`;
    return { ...base, status: "fail", ...(at ? { step: at } : {}), reason, outline: await runner.outline(page).catch(() => undefined) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Run each flow on its own fresh page, within ALL_FLOWS_MS in all. `only` runs the flows whose name contains it. */
export async function runFlows(flows: Flow[], runner: FlowRunner, only?: string): Promise<FlowResult[]> {
  const wanted = only?.trim().toLowerCase();
  const chosen = wanted ? flows.filter((f) => f.name.toLowerCase().includes(wanted)) : flows;
  const deadline = Date.now() + ALL_FLOWS_MS;
  const results: FlowResult[] = [];
  for (const flow of chosen) {
    if (Date.now() > deadline) {
      results.push({ name: flow.name, needs: flow.needs, status: "skipped", reason: "the flows ran out of time" });
      continue;
    }
    results.push(await runFlow(flow, runner, deadline));
  }
  return results;
}

/** One line for the build log. */
export function acceptanceSummary(results: FlowResult[]): string {
  const run = results.filter((r) => r.status !== "skipped");
  const passed = run.filter((r) => r.status === "pass").length;
  const failed = run.filter((r) => r.status === "fail");
  const skipped = results.length - run.length;
  return `${passed} of ${run.length} flows pass${skipped ? ` (${skipped} skipped: need a deployed contract or ran out of time)` : ""}${failed.length ? `; "${failed[0].name}" failed at ${failed[0].reason}` : ""}`;
}

/** The results as the builder reads them (run_acceptance, and run_checks when they fail). */
export function formatFlowResults(results: FlowResult[]): string {
  if (!results.length) return "No acceptance flows ran.";
  return results
    .map((r) => {
      const head = `${r.status === "pass" ? "pass" : r.status === "fail" ? "FAIL" : "skipped"} ${r.name}${r.needs === "local" ? "" : ` (needs ${r.needs})`}`;
      if (r.status === "pass") return head;
      return `${head}: ${r.reason ?? ""}${r.outline ? `\nWhat the page showed:\n${r.outline.slice(0, 1_500)}` : ""}`;
    })
    .join("\n\n");
}

/** Failed flows as check issues, for ACCEPTANCE=enforce. */
export function acceptanceIssues(results: FlowResult[]): CheckIssue[] {
  return results
    .filter((r) => r.status === "fail")
    .map((r) => ({ file: "src/App.tsx", source: "acceptance" as const, message: `Acceptance flow "${r.name}": ${r.reason ?? "failed"}. The spec's flows describe what the app must do; make the app do it (the wording and roles they name, too).` }));
}
