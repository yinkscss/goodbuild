/**
 * Does a contract take in other people's money? (GB-02, widened by GB-05)
 *
 * Read from the compiler's AST, so comments and function names don't decide it: a G$ pool whose entry is
 * `joinPool` holds members' money just as much as one whose entry is `deposit`. Code counts when one of the
 * project's own (non-test) sources:
 * - has a payable function, `receive`, or a payable `fallback` (CELO in; a payable constructor is the
 *   deployer's own money, so it doesn't count);
 * - pulls tokens in from someone with `transferFrom` / `safeTransferFrom` on another token, the usual way G$
 *   arrives. That is looked for in contract functions, constructors (a factory's `new Escrow(buyer, amt)`),
 *   modifiers, libraries and file-level functions, since a library or free function runs as the contract that
 *   calls it;
 * - implements a hook that tokens call when sent to it: `onTokenTransfer` (G$ `transferAndCall`),
 *   `onTransferReceived` / `onApprovalReceived` (ERC-1363), `onERC721Received`, `onERC1155Received`,
 *   `onERC1155BatchReceived`, `tokensReceived`;
 * - reads its own token balance and sends tokens out (`token.balanceOf(address(this))` with a `transfer`), the
 *   shape of a pot that people fund with a plain `transfer` (GB-05 (f));
 * - inherits any of that. Bases come from the compiler's linearized inheritance, not the name written in the
 *   source, so an import alias (`ERC4626 as Base`) and a receiver that only an OpenZeppelin base provides
 *   (ERC721Holder, ERC1155Holder, TimelockController, VestingWallet, a Governor) are seen. OpenZeppelin's own
 *   files are read for that, never reported on their own.
 *
 * It is deliberately broad: a false positive costs the owner one confirmation, a false negative lets a
 * money-holding contract reach mainnet without its exploit tests. It says nothing about whether the
 * contract is safe, only that it needs the money-holding checks.
 *
 * Not seen (a known limit, docs/DECISIONS.md D110): a contract that is funded by plain `transfer` and pays
 * out from its own bookkeeping, never reading `balanceOf(address(this))`; a pull hidden behind a call to an
 * external contract the project doesn't contain.
 */

type Json = Record<string, unknown>;

export interface CustodyReason {
  file: string;
  /** The contract or library; empty for a function outside any contract. */
  contract: string;
  /** The function (or "contract" for an inherited receiver, vault or governor) that takes value in. */
  fn: string;
  how: string;
  line?: number;
}

const HOOKS = new Set(["onTokenTransfer", "onTransferReceived", "onApprovalReceived", "onERC721Received", "onERC1155Received", "onERC1155BatchReceived", "tokensReceived"]);
const PULLS = new Set(["transferFrom", "safeTransferFrom"]);
const SENDS = new Set(["transfer", "safeTransfer"]);

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

/** The member a call goes through, `token.transferFrom(...)` → the MemberAccess; not `super.` or `this.`. */
function memberCall(n: Json): Json | null {
  if (n.nodeType !== "FunctionCall") return null;
  let callee = n.expression as Json | undefined;
  if (callee?.nodeType === "FunctionCallOptions") callee = callee.expression as Json;
  if (callee?.nodeType !== "MemberAccess") return null;
  const target = callee.expression as Json | undefined;
  if (target?.nodeType === "Identifier" && (target.name === "super" || target.name === "this")) return null;
  return callee;
}

/** Calls in `body` that pull tokens from someone into this contract: `token.transferFrom(...)`, not `super.` or `this.`. */
function pullsTokens(body: unknown): Json | null {
  let found: Json | null = null;
  eachNode(body, (n) => {
    if (found) return;
    const callee = memberCall(n);
    if (callee && PULLS.has(String(callee.memberName))) found = n;
  });
  return found;
}

/** `x.balanceOf(address(this))`: the contract reading how many tokens it holds. */
function readsOwnBalance(body: unknown): Json | null {
  let found: Json | null = null;
  eachNode(body, (n) => {
    if (found) return;
    const callee = memberCall(n);
    const args = (n.arguments as Json[] | undefined) ?? [];
    if (!callee || callee.memberName !== "balanceOf" || args.length !== 1) return;
    const arg = args[0];
    const cast = arg.nodeType === "FunctionCall" ? ((arg.expression as Json | undefined) ?? {}) : {};
    const inner = ((arg.arguments as Json[] | undefined) ?? [])[0];
    if (cast.nodeType === "ElementaryTypeNameExpression" && inner?.nodeType === "Identifier" && inner.name === "this") found = n;
  });
  return found;
}

/** `token.transfer(to, amount)` / `safeTransfer`: tokens leaving. Native `payable(x).transfer(amount)` has one argument and isn't this. */
function sendsTokens(body: unknown): boolean {
  let found = false;
  eachNode(body, (n) => {
    const callee = memberCall(n);
    if (callee && SENDS.has(String(callee.memberName)) && ((n.arguments as unknown[] | undefined) ?? []).length >= 2) found = true;
  });
  return found;
}

interface Hit {
  fn: string;
  how: string;
  node: Json;
}

/** What in these members (functions and modifiers of one contract or library, or a lone free function) takes money in. */
function hitsIn(members: Json[]): Hit[] {
  const hits: Hit[] = [];
  let balanceRead: { fn: string; node: Json } | null = null;
  let sends = false;
  for (const m of members) {
    const isFunction = m.nodeType === "FunctionDefinition";
    if (!isFunction && m.nodeType !== "ModifierDefinition") continue;
    if (isFunction && !m.implemented) continue;
    const kind = isFunction ? String(m.kind) : "modifier";
    const name = kind === "function" || kind === "freeFunction" || kind === "modifier" ? String(m.name) : kind;
    const add = (how: string, node: Json = m) => hits.push({ fn: name, how, node });
    if (kind === "receive") add("receives CELO sent to the contract");
    else if (isFunction && m.stateMutability === "payable" && kind !== "constructor") add(kind === "fallback" ? "accepts CELO in its fallback" : "accepts CELO (payable)");
    if (kind === "function" && HOOKS.has(name)) add("is called when tokens are sent to the contract");
    const pull = pullsTokens(m.body);
    if (pull) add("pulls tokens in with transferFrom", pull);
    const read = readsOwnBalance(m.body);
    if (read && !balanceRead) balanceRead = { fn: name, node: read };
    if (sendsTokens(m.body)) sends = true;
  }
  if (balanceRead && sends && !hits.some((h) => h.how.startsWith("pulls tokens"))) {
    hits.push({ fn: balanceRead.fn, how: "pays out tokens it holds (it reads its own token balance and sends tokens; anyone can fund that with a plain transfer)", node: balanceRead.node });
  }
  return hits;
}

const members = (c: Json) => (c.nodes as Json[] | undefined) ?? [];

/**
 * `asts` are the project's own non-test sources, which are reported on. `others` are the compile's other
 * sources (OpenZeppelin, test helpers): never reported, only read to resolve what a contract inherits.
 */
export function custodyOf(asts: Array<{ file: string; ast: Json; content?: string }>, others: Array<{ file: string; ast: Json }> = []): CustodyReason[] {
  const out: CustodyReason[] = [];
  const own = new Set<number>();
  const byId = new Map<number, Json>();
  for (const { ast } of [...others, ...asts]) {
    for (const c of ((ast.nodes as Json[]) ?? []).filter((n) => n.nodeType === "ContractDefinition")) byId.set(Number(c.id), c);
  }
  for (const { ast } of asts) for (const c of ((ast.nodes as Json[]) ?? []).filter((n) => n.nodeType === "ContractDefinition")) own.add(Number(c.id));

  for (const { file, ast, content } of asts) {
    const push = (contract: string, hit: Hit) => out.push({ file, contract, fn: hit.fn, how: hit.how, line: lineAt(content, hit.node) });
    for (const node of (ast.nodes as Json[]) ?? []) {
      if (node.nodeType === "FunctionDefinition") {
        // A function outside any contract runs as whichever contract calls it.
        for (const hit of hitsIn([node])) push("", { ...hit, how: `${hit.how} (a function outside any contract, used by the contracts that call it)` });
        continue;
      }
      if (node.nodeType !== "ContractDefinition" || node.contractKind === "interface") continue;
      const contract = String(node.name);
      if (node.contractKind === "contract") {
        // Bases the compiler resolved, whatever name the source gave them. Only OpenZeppelin-style bases that
        // aren't the project's own are read here; the project's own are reported where they are written.
        const inherited = ((node.linearizedBaseContracts as number[] | undefined) ?? [])
          .filter((id) => id !== Number(node.id) && !own.has(id))
          .map((id) => byId.get(id))
          .filter((b): b is Json => Boolean(b) && b!.contractKind !== "interface");
        const named = inherited.find((b) => /^(ERC4626|Governor)/.test(String(b.name)));
        if (named) {
          const vault = /^ERC4626/.test(String(named.name));
          out.push({ file, contract, fn: "contract", how: vault ? "is an ERC4626 vault that takes deposits" : "is a Governor that can move the treasury", line: lineAt(content, node) });
        } else {
          for (const base of inherited) {
            const first = hitsIn(members(base))[0];
            if (!first) continue;
            out.push({ file, contract, fn: "contract", how: `inherits ${String(base.name)}, which ${first.how}`, line: lineAt(content, node) });
            break;
          }
        }
      }
      for (const hit of hitsIn(members(node))) push(contract, hit);
    }
  }
  return out;
}

/** "PoolV.joinPool pulls tokens in with transferFrom (contracts/Pool.sol:12)". */
export const custodyText = (r: CustodyReason) => `${r.contract ? `${r.contract}${r.fn === "contract" ? "" : `.${r.fn}`}` : r.fn} ${r.how} (${r.file}${r.line ? `:${r.line}` : ""})`;
