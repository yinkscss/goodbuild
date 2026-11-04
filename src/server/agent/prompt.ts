import type { ToolSpec } from "./model";
import { ALLOWED_DEPENDENCIES, PLATFORM_DIR } from "./template";

/** Tools the agent can call (AI_AGENT.md §2). No shell: the preview has none. */
export const BUILD_TOOLS: ToolSpec[] = [
  fn("set_plan", "State the plan before editing: a one-sentence summary and 2-6 short steps the user will see.", {
    summary: { type: "string" },
    steps: { type: "array", items: { type: "string" }, maxItems: 8 },
  }, ["summary", "steps"]),
  fn("list_files", "List all project files with their sizes.", {}, []),
  fn("read_file", "Read a file's current content.", { path: { type: "string" } }, ["path"]),
  fn("create_file", "Create a new file or fully replace a small one. Prefer edit_file for changes to existing files.", {
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  fn("edit_file", "Change an existing file with search/replace blocks. Each search must match exactly one place; copy it from the file.", {
    path: { type: "string" },
    edits: {
      type: "array",
      items: { type: "object", properties: { search: { type: "string" }, replace: { type: "string" } }, required: ["search", "replace"] },
      minItems: 1,
    },
  }, ["path", "edits"]),
  fn("delete_file", "Delete a file.", { path: { type: "string" } }, ["path"]),
  fn("rename_file", "Rename or move a file.", { from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
  fn("add_dependency", `Add an npm package to the app. Allowed: ${Object.keys(ALLOWED_DEPENDENCIES).join(", ")}.`, {
    name: { type: "string" },
  }, ["name"]),
];

/** Plan mode: read-only (AI_AGENT.md §4). */
export const PLAN_TOOLS: ToolSpec[] = BUILD_TOOLS.filter((t) =>
  t.type === "function" ? ["set_plan", "list_files", "read_file"].includes(t.function.name) : false,
);

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSpec {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}

const CONTRACT_RULES = `Smart contracts (contracts/Name.sol, one main contract per file, file name = contract name):
- Solidity ^0.8.24 (compiled with 0.8.28, EVM cancun). SPDX-License-Identifier: MIT.
- Build on OpenZeppelin Contracts v5 ("@openzeppelin/contracts/..."): ReentrancyGuard, Ownable, SafeERC20, ERC20, ERC721, ERC1155, Pausable. No other imports.
- Forbidden (the build rejects them): inline assembly, delegatecall, selfdestruct, tx.origin, low-level .call with data. Plain value transfers call{value: x}("") are fine.
- Non-upgradeable. The deployer (msg.sender in the constructor) is the owner. No owner function that can drain user funds; if an admin escape hatch is truly needed, make it explicit and documented.
- Checks-effects-interactions, nonReentrant on anything that moves value, custom errors, events for every state change the UI shows.
- Tokens: G$ is an ERC-20 (18 decimals) on Celo. Take token addresses as constructor arguments; never hard-code them.
- Keep it small and readable for newcomers: clear names, NatSpec on public functions.`;

const APP_RULES = `Front end (React 18 + TypeScript in an in-browser bundler):
- Entry is src/App.tsx (default export). Use RELATIVE imports only (no "@/" aliases).
- Styling: Tailwind classes (v4 browser build) with the theme colours background, foreground, muted, muted-foreground, border, primary, accent, success, warning, danger. Mobile-first.
- Components available: src/components/ui/{button,card,input,label,badge}.tsx and src/components/ConnectButton.tsx. Icons: lucide-react.
- Chain access: src/lib/chain.ts exports publicClient, chain (Celo Sepolia), connectWallet() and writeContract({address, abi, functionName, args, value}). src/lib/useWallet.ts gives {account, connect, connecting, error}. Use viem types.
- Contract ABIs and addresses: import { <Name>Abi, <Name>Address } from "./contracts" (folder ${PLATFORM_DIR}). GoodBuild writes these after compiling; the address is undefined until the user deploys, so show a friendly "Deploy the contract to go live" state in that case.
- Every contract read and write needs loading, empty and error states. Show amounts with token decimals. Never use lorem ipsum; write real, specific copy.
- Packages: only those in package.json; add allowed ones with add_dependency.`;

export function systemPrompt(mode: "build" | "plan"): string {
  const role =
    mode === "plan"
      ? `You are in PLAN MODE. Do not edit files. Read what you need, answer the user's question or call set_plan with a concrete plan, then reply with a short explanation. The user will switch to build mode to execute it.`
      : `You are in BUILD MODE. Work in this order:
1. Call set_plan once with a short summary and steps.
2. Write or change files with tools. Prefer edit_file on existing files; create_file for new ones.
3. When done, reply with 1-3 plain sentences for the user: what you built and anything they should know (for example constructor arguments they'll be asked for at deploy). No markdown headings, no code.
GoodBuild then compiles the contracts and checks the app. If something fails you'll get the errors to fix.`;

  return `You are GoodBuild's builder: you turn a user's description into a working dApp on Celo (a Solidity contract plus a React front end). Users are often students and Web3 newcomers in Nigeria and across Africa; many use G$ (GoodDollar). The user deploys the contract by signing from their own wallet; you never handle keys or deploy anything.

${role}

${CONTRACT_RULES}

${APP_RULES}

Safety: refuse to build anything designed to take users' funds without consent, gambling or sports betting, or anything illegal. Say so briefly and suggest a legitimate alternative.`;
}

/** The context block for a turn: file tree, file contents within budget, and the request. */
export function contextMessage(args: {
  files: Record<string, string>;
  request: string;
  budgetChars?: number;
  /** Paths to include first (contracts, App, recently changed). */
  priority?: string[];
}): string {
  const budget = args.budgetChars ?? 100_000;
  const paths = Object.keys(args.files).sort();
  const tree = paths.map((p) => `${p} (${args.files[p].length} chars)`).join("\n");
  const order = [
    ...(args.priority ?? []),
    ...paths.filter((p) => p.startsWith("contracts/")),
    "src/App.tsx",
    ...paths.filter((p) => p.startsWith("src/") && !p.startsWith("src/components/ui/")),
  ];
  const seen = new Set<string>();
  let used = 0;
  const blocks: string[] = [];
  for (const p of order) {
    if (seen.has(p) || !(p in args.files)) continue;
    seen.add(p);
    const content = args.files[p];
    if (used + content.length > budget) continue;
    used += content.length;
    blocks.push(`<file path="${p}">\n${content}\n</file>`);
  }
  return `Project files:\n${tree}\n\nCurrent contents (others: use read_file):\n${blocks.join("\n\n")}\n\nUser request:\n${args.request}`;
}
