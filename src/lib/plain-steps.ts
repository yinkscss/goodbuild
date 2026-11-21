import type { Step } from "./turn-types";

/**
 * Plain words for build steps (D164). The server's step labels name files and tools ("Writing GoalCard.tsx");
 * a person reads what is being made ("Building the goal card"), with the file name kept apart so the screen can
 * show it faintly. Done here, not on the server, so turns saved before D164 read the same way.
 */
export interface PlainStep {
  text: string;
  /** The file the step works on, shown faintly after the words. */
  file?: string;
}

/** "GoalCard" → "goal card", "add-goal" → "add goal". */
function words(name: string): string {
  return name
    .replace(/\.[a-z0-9.]+$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim()
    .toLowerCase();
}

/** What writing this file means to a person. */
function writingWords(file: string): string {
  const base = file.split("/").pop() ?? file;
  const name = base.replace(/\.[a-z0-9]+$/i, "");
  if (/\.t\.sol$|\.test\.|\.spec\./i.test(base)) return "Writing checks for your app";
  if (/\.sol$/i.test(base)) return "Writing your contract";
  if (/\.(css|scss)$/i.test(base) || /^(theme|tokens|palette|styles?)$/i.test(name)) return "Choosing colours and layout";
  if (/^(App|main|index|Home|HomePage)$/.test(name)) return "Building the main screen";
  if (/wallet|chain|wagmi|minipay/i.test(name) && !/\.(tsx|jsx)$/i.test(base)) return "Connecting the wallet";
  if (/^spec$|^plan$/i.test(name) || /\.md$/i.test(base)) return "Writing down the plan";
  if (/\.(json|ya?ml|toml|lock)$/i.test(base) || /config/i.test(name)) return "Setting things up";
  if (/\.(svg|png|jpe?g|webp|gif)$/i.test(base)) return "Adding a picture";
  const hook = /^use([A-Z]\w*)$/.exec(name);
  if (hook) return `Making ${words(hook[1])} work`;
  const page = /^(\w+?)(Page|Screen|View)$/.exec(name);
  if (page) return `Building the ${words(page[1])} screen`;
  if (/\.(tsx|jsx)$/i.test(base)) return `Building the ${words(name)}`;
  return `Setting up ${words(name)}`;
}

const FIXED: Record<string, string> = {
  "Compiling contracts": "Building your contract",
  "Testing contracts": "Trying your contract out",
  "Checking types": "Checking the code",
  "Checking the app": "Checking the app",
  "Opening the app": "Opening your app to try it",
  "Looking at the page": "Looking at it on a phone and a computer",
  "Fixing what it saw": "Tidying what it saw",
  "Planning the app": "Planning your app",
  "Writing the contracts": "Writing your contract",
  "Building the rest of the plan": "Building the rest of the plan",
};

/** A step's words for a person, or null when it isn't worth showing (reading a guide, the plan itself). */
export function plainStep(step: Pick<Step, "label" | "detail" | "id">): PlainStep | null {
  const label = step.label;
  if (step.id === "plan" || label === "Plan") return null;
  if (/^Reading the .* guide$/.test(label)) return null;
  const writing = /^Writing (.+)$/.exec(label);
  if (writing && /\.[a-z0-9]+$/i.test(writing[1])) return { text: writingWords(writing[1]), file: writing[1] };
  const tidy = /^(Deleting|Renaming) (.+)$/.exec(label);
  if (tidy) return { text: "Tidying up", file: tidy[2] };
  if (/^Adding the .+ kit$/.test(label)) return { text: `Adding ${words(label.replace(/^Adding the | kit$/g, ""))} support` };
  if (/^Adding /.test(label)) return { text: "Adding a building block" };
  if (label.startsWith("Compiling with solc")) return { text: "Building your contract" };
  if (/^Fixing errors \(attempt \d+ of \d+\)$/.test(label)) return { text: "Fixing a small thing it found" };
  if (label === "Auto-fix: fixed") {
    const n = /Fixed (\d+)/.exec(step.detail ?? "")?.[1];
    return { text: n ? `Fixed ${n === "1" ? "1 problem" : `${n} problems`} by itself` : "Fixed what it found by itself" };
  }
  if (label === "Auto-fix: failed") {
    const n = /(\d+) errors? left/.exec(step.detail ?? "")?.[1];
    return { text: n ? `${n === "1" ? "1 problem still needs" : `${n} problems still need`} a fix` : "Something still needs a fix" };
  }
  return { text: FIXED[label] ?? label };
}

/** A plan step without its route or contract name: "/goals: Add and list goals" → "Add and list goals". */
export function planStepText(step: string): string {
  const m = /^([^\s:]{1,40}):\s+(.+)$/.exec(step.trim());
  if (!m) return step.trim();
  return m[2].charAt(0).toUpperCase() + m[2].slice(1);
}

/** GoodBuild's own last step on every build's checklist. */
export const CHECKING_STEP = "Checking it works on a phone and a computer";
