import { MAX_FLOWS, parseFlows, type Flow } from "./acceptance";
import { TEMPLATES, TEMPLATE_CONTRACTS, TEMPLATE_IDS, templateMenu, type TemplateId } from "./contract-templates";
import type { ToolSpec } from "./model";

/**
 * The app's spec (D152, harness v2): written once per first build, milestone or contract change by the spec
 * call (DeepSeek since D165), before any code. A platform-owned project file, so it is versioned with the code,
 * restored by Revert, readable by the builder and never edited by it. The app never imports it.
 */
export const SPEC_PATH = "src/spec.json";

export interface AppSpec {
  summary: string;
  direction: string;
  pages: Array<{ route: string; purpose: string; elements: string[] }>;
  contracts: Array<{ name: string; purpose: string; state: string[]; functions: Array<{ name: string; who: string; does: string }>; events: string[]; invariants: string[]; /** The audited template it inherits (D165), or "none" for custom logic. */ template?: TemplateId | "none" }>;
  data: Array<{ collection: string; rules: string }>;
  /** Browser flows the checker runs (docs/HARNESS_V2_PLAN.md WS3), validated by acceptance.ts. */
  acceptance: Flow[];
  outOfScope: string[];
}

const str = { type: "string" };
const strings = { type: "array", items: str };

export const WRITE_SPEC_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "write_spec",
    description:
      "Write the app's spec: what it is for, its visual direction, its pages, its contracts (only what this milestone needs), its saved data and the browser flows that prove it works. Call it once, when you have read enough. The builders follow it; they can't change it.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences: what the app is for and who uses it." },
        direction: { type: "string", description: "The visual direction in one sentence: type, colour use, shape, layout, mood." },
        pages: { type: "array", items: { type: "object", properties: { route: str, purpose: str, elements: strings }, required: ["route", "purpose"] } },
        contracts: {
          type: "array",
          description: "Empty when the app needs no on-chain state or payments, or when the delivery contract leaves them for later.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "PascalCase, the file name too" },
              template: { type: "string", enum: [...TEMPLATE_IDS, "none"], description: "GoodBuild's audited template this contract inherits, or none only when no template fits" },
              purpose: str,
              state: strings,
              functions: { type: "array", items: { type: "object", properties: { name: str, who: { type: "string", description: "anyone, owner, a member, ..." }, does: str }, required: ["name", "does"] } },
              events: strings,
              invariants: { type: "array", items: str, description: 'Rules that must always hold, each one a contract test: "the pot never pays out more than was deposited"' },
            },
            required: ["name", "purpose", "functions", "template"],
          },
        },
        data: { type: "array", items: { type: "object", properties: { collection: str, rules: str }, required: ["collection", "rules"] } },
        acceptance: {
          type: "array",
          description: "Up to 8 browser flows. needs: local (no wallet), wallet (a stand-in wallet is connected) or deployed (needs a live contract; listed, not run).",
          items: { type: "object", properties: { name: str, needs: { type: "string" }, steps: { type: "array", items: { type: "object" } } }, required: ["name", "steps"] },
        },
        outOfScope: { ...strings, description: "What this build deliberately leaves out." },
      },
      required: ["summary", "direction", "pages", "contracts", "acceptance"],
    },
  },
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max: number, each: number) => (Array.isArray(v) ? v.map((x) => text(x, each)).filter(Boolean).slice(0, max) : []);
const objects = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x)).slice(0, max) : []);

export function parseSpec(raw: Record<string, unknown>, requireTemplate = false): { ok: true; spec: AppSpec } | { ok: false; error: string } {
  const summary = text(raw.summary, 600);
  if (!summary) return { ok: false, error: "write_spec needs a summary." };
  const contracts = objects(raw.contracts, 6).map((c) => ({
    name: text(c.name, 60),
    purpose: text(c.purpose, 400),
    state: list(c.state, 20, 200),
    functions: objects(c.functions, 30).map((f) => ({ name: text(f.name, 60), who: text(f.who, 80) || "anyone", does: text(f.does, 300) })).filter((f) => f.name),
    events: list(c.events, 20, 160),
    invariants: list(c.invariants, 12, 300),
    ...(typeof c.template === "string" && (c.template === "none" || (TEMPLATE_IDS as string[]).includes(c.template)) ? { template: c.template as TemplateId | "none" } : {}),
  }));
  if (requireTemplate && contracts.some(c => !c.template)) return {ok:false,error:"Choose a listed template or none for each contract."};
  const bad = contracts.find((c) => !/^[A-Z][A-Za-z0-9]*$/.test(c.name));
  if (bad) return { ok: false, error: `Contract names are PascalCase and become the file name: "${bad.name}" isn't.` };
  // D165: the app's contract inherits the template, so it can't share its name ("contract GoodSavings is GoodSavings").
  const taken = contracts.find((c) => TEMPLATE_CONTRACTS.includes(c.name));
  if (taken) return { ok: false, error: `${taken.name} is the name of GoodBuild's template. Name the app's contract after the app (for example KoloSavings), with template "${TEMPLATES.find((t) => `${taken.name}.sol` in t.files)?.id ?? "none"}".` };
  // A flow that can't run is sent back to the spec call to fix while it still has the plan in mind.
  if (!Array.isArray(raw.acceptance)) return { ok: false, error: "write_spec needs acceptance: an array of flows (an empty array when nothing can be checked in a browser)." };
  const { flows: acceptance, problems } = parseFlows(raw.acceptance);
  if (problems.length) return { ok: false, error: `Some acceptance flows can't run: ${problems.slice(0, 6).join("; ")}.` };
  if (raw.acceptance.length > MAX_FLOWS) return { ok: false, error: `At most ${MAX_FLOWS} acceptance flows.` };
  return {
    ok: true,
    spec: {
      summary,
      direction: text(raw.direction, 400),
      pages: objects(raw.pages, 12).map((p) => ({ route: text(p.route, 80) || "/", purpose: text(p.purpose, 300), elements: list(p.elements, 20, 160) })),
      contracts,
      data: objects(raw.data, 10).map((d) => ({ collection: text(d.collection, 60), rules: text(d.rules, 300) })).filter((d) => d.collection),
      acceptance,
      outOfScope: list(raw.outOfScope, 12, 200),
    },
  };
}

export function readSpec(files: Record<string, string>): AppSpec | null {
  const raw = files[SPEC_PATH];
  if (raw === undefined) return null;
  try {
    const parsed = parseSpec(JSON.parse(raw) as Record<string, unknown>);
    return parsed.ok ? parsed.spec : null;
  } catch {
    return null;
  }
}

/** The plan card from a spec: its summary, then a step per page and per contract. */
export function specPlan(spec: AppSpec): { summary: string; steps: string[] } {
  const steps = [
    ...spec.contracts.map((c) => `${c.name}: ${c.purpose}`.slice(0, 160)),
    ...spec.pages.map((p) => `${p.route === "/" ? "Home" : p.route}: ${p.purpose}`.slice(0, 160)),
  ].slice(0, 8);
  return { summary: spec.summary.slice(0, 400), steps };
}

/** How much of the spec the context block shows. */
const SPEC_BLOCK_CHARS = 12_000;

/**
 * The spec as the context block shows it. A spec too long to show whole is shown compact with the acceptance
 * flows first, so they are never the part cut off, and the block says it was shortened.
 */
export function specBlock(files: Record<string, string>): string {
  const raw = files[SPEC_PATH];
  if (raw === undefined) return "";
  const head = `The app's spec (${SPEC_PATH}, written by the planner; follow it, and if it is wrong say so in your reply instead of working around it):`;
  if (raw.length <= SPEC_BLOCK_CHARS) return `${head}\n${raw}`;
  const spec = readSpec(files);
  const cut = `[The spec is longer than this and was cut off here. read_file ${SPEC_PATH} for all of it.]`;
  if (!spec) return `${head}\n${raw.slice(0, SPEC_BLOCK_CHARS)}\n${cut}`;
  // The flows are always shown whole (parseFlows bounds their size); the rest fills what room is left.
  const flows = JSON.stringify(spec.acceptance);
  const rest = JSON.stringify({ summary: spec.summary, direction: spec.direction, contracts: spec.contracts, data: spec.data, outOfScope: spec.outOfScope, pages: spec.pages });
  const room = Math.max(2_000, SPEC_BLOCK_CHARS - flows.length);
  return `${head}\nAcceptance flows: ${flows}\nThe rest of the spec: ${rest.length <= room ? rest : `${rest.slice(0, room)}\n${cut}`}`;
}

/** The user message that starts the spec call. */
export function specRequest(hasContracts: boolean, contractsAllowed: boolean): string {
  return [
    "SPEC STEP. GoodBuild runs this before any code is written. You are the planner: read what you need (read_file, search_code, find_symbol, list_files, read_guide), then call write_spec once. Don't write any files.",
    "Plan the whole of what this turn must deliver, concretely enough that another model can build it without guessing: the pages and what is on each, the visual direction, and the saved data.",
    contractsAllowed
      ? `Contracts: list each one the app needs now with its state, every function and who may call it, its events, and its invariants (each invariant becomes a contract test). One focused contract per file; keep each under 24 KB of bytecode. Give each one the GoodBuild template it builds on (audited, already tested; the builder only sets its values): ${templateMenu()}. Use "none" only when none fits, such as a game's own rules or a trading pool. ${hasContracts ? "The project already has contracts: describe them as they should be after this change." : "Leave contracts empty when the app needs no on-chain state or payments."}`
      : "Contracts: leave them empty. The delivery contract keeps on-chain work for a later milestone.",
    'Acceptance: up to 8 short browser flows that prove the main things work, written before the interface exists, so name what a person sees: visible text and roles, the way the pages you planned will word them. Steps: {"goto": "/route"}, {"click": {"role": "button", "name": "Send tip"}} or {"click": {"text": "..."}}, {"fill": {"label": "Amount"}, "value": "50"} (or {"placeholder": "..."}, {"testid": "..."} for a data-testid), {"press": "Enter"}, {"expect": {"text": "..."}}, {"expect": {"hidden": "..."}}, {"expect": {"route": "/about"}}, {"wait": 500}, {"connectWallet": true}. Set needs to wallet when a flow needs a connected wallet, and to deployed when it needs a live contract (before deploy the app shows its "deploy to go live" state, which a local flow can check).',
    "Ambitious is fine: plan the app that was asked for, not a smaller safer one, and leave out only what the delivery contract defers.",
  ].join("\n\n");
}
