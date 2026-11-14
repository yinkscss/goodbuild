import { isTestFile } from "@/lib/deploy/test-file";

import type { CheckIssue } from "../checks";
import { stripSolidity } from "../solidity-text";

import type { Kit } from "./registry";

/**
 * The DAOs and vaults kit (D76): contracts that hold other people's money, which is where hacks
 * happen. A mistake in a tip jar costs a tip; a mistake in a vault costs every depositor.
 *
 * The kit does three things: a guide that steers the builder to audited OpenZeppelin parts and
 * away from the known ways these contracts get drained, an exploit-test rule (below) that the
 * builder must satisfy before the project passes its checks, and the same rule plus a real run of
 * the tests before a deploy to Celo mainnet (`src/server/deploy/exploit-gate.ts`).
 */

type Role = "vault" | "dao";

/**
 * What a project's own (non-test) contracts do, read from their source with comments and string literals
 * blanked first (GB-04): a comment that mentions `function deposit(` is not a deposit function, and must not
 * turn a money-holding contract into a "known vault shape" that skips the owner's review.
 */
export function rolesOf(files: Record<string, string>): Role[] {
  const source = Object.entries(files)
    .filter(([p]) => /^contracts\/.*\.sol$/.test(p) && !isTestFile(p))
    .map(([, c]) => stripSolidity(c))
    .join("\n");
  const roles: Role[] = [];
  // Money in: deposit, stake, contribute, or an escrow's fund / pledge / lock (live check: an escrow took cUSD through fundDeal).
  const deposit = /ERC4626|function\s+(deposit|stake|contribute|fund|pledge|lock)\w*\s*\(/.test(source);
  const withdraw = /ERC4626|function\s+(withdraw|redeem|unstake|claim)\w*\s*\(/.test(source);
  if (deposit && withdraw) roles.push("vault");
  const propose = /\bGovernor\b|function\s+(propose|createProposal|submitProposal)\w*\s*\(/.test(source);
  const vote = /function\s+(vote|castVote|approve)\w*\s*\(|\bGovernorCountingSimple\b/.test(source);
  if (propose && vote) roles.push("dao");
  return roles;
}

export interface Need {
  id: string;
  pattern: RegExp;
  say: string;
}

const NEEDS: Record<Role | "any", Need[]> = {
  any: [
    { id: "access", pattern: /unauth|access|onlyowner|owneronly|notowner|permission|stranger/i, say: "testExploitUnauthorizedCall: a stranger tries every admin function (pause, set a fee, move funds, execute) and each must fail" },
    { id: "reentrancy", pattern: /reentr/i, say: "testExploitReentrancy: a hostile contract calls back into deposit/withdraw/claim/execute while it is being paid, and gets nothing extra" },
  ],
  vault: [{ id: "inflation", pattern: /inflat|donat|firstdeposit|sharepric/i, say: "testExploitDonationInflation: the first depositor puts in 1 unit, then sends a large amount straight to the vault; the second depositor must still get fair shares, not zero" }],
  dao: [
    { id: "double-vote", pattern: /doublevote|votetwice|twice|doubleclaim/i, say: "testExploitDoubleVote: one member votes twice on the same proposal, and the second vote must fail or add nothing" },
    { id: "late-voter", pattern: /snapshot|flash|latejoin|late|transfervote/i, say: "testExploitFlashVotes: someone who gets voting power after a proposal started (a transfer, a late join) must not be able to use it on that proposal" },
  ],
};

/** Body of a function whose header starts at `from`, by counting braces. */
function bodyAt(text: string, from: number): string {
  const open = text.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

export interface ExploitTest {
  file: string;
  name: string;
  /** The function body with comments and strings blanked. */
  body: string;
}

/**
 * The exploit tests in a project: `testExploit...()` functions that are public or external, in a test file,
 * found in code with comments and string literals blanked (GB-04). A function in a comment, or an internal
 * or private one (which the runner never calls), is not a test. This is what is written, not what ran: the
 * mainnet gate also requires each one in the executed results (exploit-gate.ts).
 */
export function exploitTests(files: Record<string, string>): ExploitTest[] {
  const out: ExploitTest[] = [];
  for (const [file, raw] of Object.entries(files)) {
    if (!isTestFile(file) || !file.endsWith(".sol")) continue;
    const content = stripSolidity(raw);
    for (const m of content.matchAll(/function\s+(testExploit\w*)\s*\(\s*\)([^{;]*)\{/g)) {
      if (!/\b(public|external)\b/.test(m[2])) continue;
      out.push({ file, name: m[1], body: bodyAt(content, m.index ?? 0) });
    }
  }
  return out;
}

/** The arguments of the call whose `(` is at `open`, split at the top level. */
function callArgs(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth === 0) {
        args.push(text.slice(start, i));
        return args.map((a) => a.trim()).filter((a) => a !== "");
      }
    } else if (c === "," && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return args.map((a) => a.trim()).filter((a) => a !== "");
}

/** Numbers, true/false, units and casts only: an expression with no variable, call or state in it. */
const isConstant = (expr: string) =>
  expr !== "" &&
  !/[A-Za-z_$]/.test(
    expr
      .replace(/\b0[xX][0-9a-fA-F_]+\b/g, "")
      .replace(/\b\d[\d_]*(?:\.\d+)?(?:[eE]\d+)?\b/g, "")
      .replace(/\b(?:true|false|wei|gwei|ether|seconds|minutes|hours|days|weeks|payable|address|bool|u?int\d*|bytes\d*)\b/g, ""),
  );

/**
 * Does this test body assert something about the contract under attack? An `assert*` or `expectRevert*` call
 * counts unless everything it checks is a literal constant (`assertTrue(true)`, `assertEq(1, 1)`, `assertGt(2, 1)`),
 * or both sides of a comparison are the same text. It cannot tell a thorough test from a thin one: the gate
 * shows the named tests ran and passed, not that they are sufficient.
 */
export function assertsSomething(body: string): boolean {
  for (const m of body.matchAll(/\b(assert\w*|expectRevert\w*)\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const args = callArgs(body, open);
    // The last argument is the message in Test.sol's helpers; it never counts.
    const checked = args.length > 1 && /^"/.test(args[args.length - 1]) ? args.slice(0, -1) : args;
    if (!checked.length) continue;
    const squash = (a: string) => a.replace(/\s+/g, "");
    const identical = checked.length >= 2 && checked.every((a) => squash(a) === squash(checked[0]));
    if (!checked.every(isConstant) && !identical) return true;
  }
  return false;
}

/** The attack tests a project needs: the two every money-holding contract faces, plus a vault's or DAO's own. */
export function neededTests(roles: Role[]): Need[] {
  return [...NEEDS.any, ...roles.flatMap((r) => NEEDS[r])];
}

/**
 * Needs that no test meets, when each need must be met by a test function of its own (GB-04): one name such as
 * testExploitUnauthorizedReentrancyDonation can't stand in for three attacks. A best assignment of tests to
 * needs, so a test is only counted once however many patterns its name matches.
 */
export function unmetNeeds(needs: Need[], tests: Array<{ name: string }>): Need[] {
  const owner = new Map<number, number>(); // test index -> need index
  const place = (need: number, seen: Set<number>): boolean => {
    for (let t = 0; t < tests.length; t++) {
      if (seen.has(t) || !needs[need].pattern.test(tests[t].name)) continue;
      seen.add(t);
      const held = owner.get(t);
      if (held === undefined || place(held, seen)) {
        owner.set(t, need);
        return true;
      }
    }
    return false;
  };
  const met = new Set<number>();
  needs.forEach((_, i) => {
    if (place(i, new Set())) met.add(i);
  });
  return needs.filter((_, i) => !met.has(i));
}

/**
 * The exploit-test rule. A project with a vault or a DAO needs a named attack test for each of the
 * ways these contracts are drained, each its own function, and each must really assert something. The tests
 * run with the others after every compile and a failing one is fixed like any other. This shows that the attacks
 * the builder thought of are tried and turned away, not that the contract is safe: a contract that
 * holds real money still deserves a human audit, and the guide says so.
 *
 * This reads what is written, in code with comments and strings blanked. It is the fast check the builder's loop
 * runs. The mainnet gate adds the one that matters: each needed test must be in the results of a real run, passing.
 *
 * `custody` (GB-02): the compiler found that the contracts take in other people's money (custodyOf),
 * whatever their functions are called. When no vault or DAO shape matched, they still need the two
 * attacks every money-holding contract faces: a stranger calling admin functions, and re-entrancy.
 */
export function exploitTestIssues(files: Record<string, string>, { custody = false }: { custody?: boolean } = {}): CheckIssue[] {
  const roles = rolesOf(files);
  if (!roles.length && !custody) return [];
  const tests = exploitTests(files);
  const issues: CheckIssue[] = [];
  const file = tests[0]?.file ?? "contracts/test/";
  const meaningful: ExploitTest[] = [];
  for (const t of tests) {
    if (assertsSomething(t.body)) meaningful.push(t);
    else issues.push({ file: t.file, message: `${t.name} doesn't check anything. An exploit test must try the attack and then assert it failed (expectRevert) or that nobody gained (assertEq on real state). Asserting a constant such as assertTrue(true) doesn't count.`, source: "test" });
  }
  const kind = roles.length ? roles.join(" and ") : "contract";
  for (const need of unmetNeeds(neededTests(roles), meaningful)) {
    const shared = meaningful.find((t) => need.pattern.test(t.name));
    issues.push({
      file,
      message: `This ${kind} holds other people's money, so it needs an exploit test. Add ${need.say}. Put it in contracts/test/<Name>.t.sol.${shared ? ` ${shared.name} already covers another attack: each attack needs its own test function.` : ""}`,
      source: "test",
    });
  }
  return issues;
}

const GUIDE = `DAOs and vaults. These contracts hold other people's money, so write them the careful way, not the clever way. GoodBuild refuses to finish one without its exploit tests.
Pick the simplest shape that fits:
- Club treasury (most requests: a group saves together and decides spending): a contract with members, a proposal to pay an amount to an address, one vote per member, and an execute that pays out once enough members said yes. Members are fixed when a proposal starts: record the member count at creation, count only members who joined before it, and mark each member's vote so it counts once.
- Token-weighted DAO (a community token with voting): OpenZeppelin's Governor with GovernorCountingSimple, GovernorVotes and an ERC20Votes token, so voting power is read at the moment the proposal started (a snapshot) and borrowed or just-bought tokens can't swing a vote. Keep the Governor small: it can pass the 24 KB size limit.
- Vault (people deposit a token, the contract holds it, they take it back later, often with a share of earnings): OpenZeppelin's ERC4626 over the deposit token. Override _decimalsOffset() to return 6, which blocks the donation attack where the first depositor inflates the share price so later depositors get nothing.
Rules that apply to all of them:
- Use OpenZeppelin for every standard part (ERC4626, ERC20Votes, Governor, SafeERC20, ReentrancyGuard, Ownable2Step, Pausable). Don't rewrite them. Pay out and take in tokens only with SafeERC20, and for native CELO use call{value: x}("") only after the state is updated.
- Checks, effects, then interactions, always: change the balances and mark things as paid before sending anything out, and put nonReentrant on every function that sends money or tokens.
- Nobody, including the owner, can take depositors' money. No function that lets an owner withdraw the vault's funds, change who owns a deposit, or swap the deposit token. The owner can pause new deposits and set a cap, and withdrawals always work. Owner-only functions use Ownable2Step.
- No upgrade switches, no proxies, no delegatecall (they are refused anyway), no timestamps used as randomness, no prices read from a pool in the same transaction.
- Time windows (voting period, delay) are constructor arguments, so the tests can deploy with a window of zero. The tests have no clock to move: block.timestamp is fixed.
- Exploit tests (required): in contracts/test/<Name>.t.sol (the contract is named <Name>Test and extends Test) write one public test function per attack, each its own function named testExploit..., that tries the attack as an Actor and asserts it failed or that nobody gained, with expectRevert or an assert on real state (assertTrue(true) or assertEq(1, 1) counts as nothing). One function can't cover two attacks, and a test in a comment doesn't count. Needed: testExploitUnauthorizedCall and testExploitReentrancy for all; testExploitDonationInflation for a vault; testExploitDoubleVote and testExploitFlashVotes for a DAO. For reentrancy, write a small attacker contract in the test file that calls back into the target from its receive() or from a token hook. The compile check names any that are missing.
- Mainnet: before a deploy to Celo mainnet, GoodBuild runs the compile, the guardrails and every test again, and refuses if any fail, or if a needed exploit test didn't run and pass. Say plainly to the person that this checks the common attacks, is not an audit, and that a vault holding a lot of real money should have one.
- In the app: show the person what they have in the vault and what they would get back, in plain words, with a clear Deposit and Withdraw. For a DAO show each proposal's status and whether this member has voted. Amounts use the token's real decimals.`;

export const daoVault: Kit = {
  id: "dao-vault",
  title: "DAOs and vaults",
  when: "a contract that holds a group's or many people's money: a DAO, club or community treasury, a vault, a staking or savings pool with deposits and withdrawals, a multisig, a fund with proposals and votes",
  keywords: /\b(dao|daos|treasury|vaults?|staking pool|stake pool|yield|multi-?sig|governance|erc-?4626|shared wallet|community fund|investment club)\b/i,
  packages: {},
  files: {},
  guide: GUIDE,
  checks: exploitTestIssues,
};
