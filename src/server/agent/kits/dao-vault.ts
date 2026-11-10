import type { CheckIssue } from "../checks";

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

/** What a project's own (non-test) contracts do, read from their source. */
export function rolesOf(files: Record<string, string>): Role[] {
  const source = Object.entries(files)
    .filter(([p]) => /^contracts\/.*\.sol$/.test(p) && !isTest(p))
    .map(([, c]) => c)
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

const isTest = (p: string) => /^contracts\/test\/.*\.t\.sol$/.test(p) || /\.t\.sol$/.test(p);

interface Need {
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

/** The exploit tests in a project: test functions named testExploit..., with their bodies. */
export function exploitTests(files: Record<string, string>): Array<{ file: string; name: string; body: string }> {
  const out: Array<{ file: string; name: string; body: string }> = [];
  for (const [file, content] of Object.entries(files)) {
    if (!/^contracts\/.*\.t\.sol$/.test(file)) continue;
    for (const m of content.matchAll(/function\s+(testExploit\w*)\s*\(\s*\)/g)) out.push({ file, name: m[1], body: bodyAt(content, m.index ?? 0) });
  }
  return out;
}

/**
 * The exploit-test rule. A project with a vault or a DAO needs a named attack test for each of the
 * ways these contracts are drained, and each must really assert something. The tests run with the
 * others after every compile and a failing one is fixed like any other. This shows that the attacks
 * the builder thought of are tried and turned away, not that the contract is safe: a contract that
 * holds real money still deserves a human audit, and the guide says so.
 */
export function exploitTestIssues(files: Record<string, string>): CheckIssue[] {
  const roles = rolesOf(files);
  if (!roles.length) return [];
  const tests = exploitTests(files);
  const issues: CheckIssue[] = [];
  const file = tests[0]?.file ?? "contracts/test/";
  for (const t of tests) {
    if (!/\b(assert\w*|expectRevert\w*)\s*\(/.test(t.body)) {
      issues.push({ file: t.file, message: `${t.name} doesn't check anything. An exploit test must try the attack and then assert it failed (expectRevert) or that nobody gained (assertEq).`, source: "test" });
    }
  }
  const needs = [...NEEDS.any, ...roles.flatMap((r) => NEEDS[r])];
  for (const need of needs) {
    if (!tests.some((t) => need.pattern.test(t.name))) {
      issues.push({ file, message: `This ${roles.join(" and ")} holds other people's money, so it needs an exploit test. Add ${need.say}. Put it in contracts/test/<Name>.t.sol.`, source: "test" });
    }
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
- Exploit tests (required): in contracts/test/<Name>.t.sol write one test per attack, named testExploit..., that tries the attack as an Actor and asserts it failed or that nobody gained. Needed: testExploitUnauthorizedCall and testExploitReentrancy for all; testExploitDonationInflation for a vault; testExploitDoubleVote and testExploitFlashVotes for a DAO. For reentrancy, write a small attacker contract in the test file that calls back into the target from its receive() or from a token hook. The compile check names any that are missing.
- Mainnet: before a deploy to Celo mainnet, GoodBuild runs the compile, the guardrails and every test again, and refuses if any fail or an exploit test is missing. Say plainly to the person that this checks the common attacks, is not an audit, and that a vault holding a lot of real money should have one.
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
