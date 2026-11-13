/**
 * Does a contract take in other people's money? (GB-02)
 *
 * Read from the compiler's AST, so comments and function names don't decide it: a G$ pool whose entry is
 * `joinPool` holds members' money just as much as one whose entry is `deposit`. A contract counts when one
 * of the project's own (non-test) contracts:
 * - has a payable function, `receive`, or a payable `fallback` (CELO in; a payable constructor is the
 *   deployer's own money, so it doesn't count);
 * - pulls tokens in from someone with `transferFrom` / `safeTransferFrom` on another token, the usual way G$ arrives;
 * - implements a hook that tokens call when sent to it: `onTokenTransfer` (G$ `transferAndCall`),
 *   `onERC721Received`, `onERC1155Received`, `onERC1155BatchReceived`, `tokensReceived`;
 * - inherits OpenZeppelin's ERC4626 vault or Governor.
 *
 * It is deliberately broad: a false positive costs the owner one confirmation, a false negative lets a
 * money-holding contract reach mainnet without its exploit tests. It says nothing about whether the
 * contract is safe, only that it needs the money-holding checks.
 */

type Json = Record<string, unknown>;

export interface CustodyReason {
  file: string;
  contract: string;
  /** The function (or "contract" for an inherited vault/governor) that takes value in. */
  fn: string;
  how: string;
  line?: number;
}

const HOOKS = new Set(["onTokenTransfer", "onERC721Received", "onERC1155Received", "onERC1155BatchReceived", "tokensReceived"]);
const PULLS = new Set(["transferFrom", "safeTransferFrom"]);

function lineAt(content: string | undefined, node: Json): number | undefined {
  const start = Number(String(node.src ?? "").split(":")[0]);
  if (content === undefined || !Number.isFinite(start) || start < 0) return undefined;
  return content.slice(0, start).split("\n").length;
}

function eachNode(node: unknown, visit: (n: Json) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((c) => eachNode(c, visit));
  visit(node as Json);
  for (const value of Object.values(node as Json)) if (value && typeof value === "object") eachNode(value, visit);
}

/** Calls in `body` that pull tokens from someone into this contract: `token.transferFrom(...)`, not `super.` or `this.`. */
function pullsTokens(body: unknown): Json | null {
  let found: Json | null = null;
  eachNode(body, (n) => {
    if (found || n.nodeType !== "FunctionCall") return;
    let callee = n.expression as Json | undefined;
    if (callee?.nodeType === "FunctionCallOptions") callee = callee.expression as Json;
    if (callee?.nodeType !== "MemberAccess" || !PULLS.has(String(callee.memberName))) return;
    const target = callee.expression as Json | undefined;
    if (target?.nodeType === "Identifier" && (target.name === "super" || target.name === "this")) return;
    found = n;
  });
  return found;
}

export function custodyOf(asts: Array<{ file: string; ast: Json; content?: string }>): CustodyReason[] {
  const out: CustodyReason[] = [];
  for (const { file, ast, content } of asts) {
    for (const c of ((ast.nodes as Json[]) ?? []).filter((n) => n.nodeType === "ContractDefinition" && n.contractKind === "contract")) {
      const contract = String(c.name);
      const bases = ((c.baseContracts as Json[]) ?? []).map((b) => String((b.baseName as Json | undefined)?.name ?? ""));
      for (const base of bases) {
        if (/^ERC4626/.test(base)) out.push({ file, contract, fn: "contract", how: "is an ERC4626 vault that takes deposits", line: lineAt(content, c) });
        else if (/^Governor/.test(base)) out.push({ file, contract, fn: "contract", how: "is a Governor that can move the treasury", line: lineAt(content, c) });
      }
      for (const f of ((c.nodes as Json[]) ?? []).filter((n) => n.nodeType === "FunctionDefinition")) {
        const kind = String(f.kind);
        const name = kind === "function" ? String(f.name) : kind;
        const add = (how: string, node: Json = f) => out.push({ file, contract, fn: name, how, line: lineAt(content, node) });
        if (kind === "constructor" || !f.implemented) continue;
        if (kind === "receive") add("receives CELO sent to the contract");
        else if (f.stateMutability === "payable") add(kind === "fallback" ? "accepts CELO in its fallback" : "accepts CELO (payable)");
        if (kind === "function" && HOOKS.has(name)) add("is called when tokens are sent to the contract");
        const pull = pullsTokens(f.body);
        if (pull) add("pulls tokens in with transferFrom", pull);
      }
    }
  }
  return out;
}

/** "PoolV.joinPool pulls tokens in with transferFrom (contracts/Pool.sol:12)". */
export const custodyText = (r: CustodyReason) => `${r.contract}${r.fn === "contract" ? "" : `.${r.fn}`} ${r.how} (${r.file}${r.line ? `:${r.line}` : ""})`;
