import "server-only";

import { estimateTokens } from "@/lib/pricing";

import type { ModelClient } from "./model";
import { scriptedModel } from "./fake-model";
import { looksLikeWebsite } from "./plan-intake";

/**
 * Development-only stand-in for the LLM (GOODBUILD_DEMO_MODEL=1): replays a realistic
 * first build of a G$ tip jar, including a compile error the cheap model fixes, so the
 * workspace, streaming, checks and preview can be tried without API keys.
 * Refused in production.
 */

/** The tip jar the demo writes. G$ is the ERC-20, never native CELO. */
export const DEMO_TIP_JAR_FIXED = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Club tip jar: every G$ tip is split between the coach and the kit fund.
/// @notice Tip in one transaction with G$.transferAndCall (ERC-677), or approve then tip().
contract TipJar is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ShareTooHigh();
    error ZeroTip();
    error NotGoodDollar();

    event Tipped(address indexed from, uint256 amount, string note);

    /// @notice The G$ token.
    IERC20 public immutable gd;
    address public immutable coach;
    address public immutable kitFund;
    /// @notice Share of each tip that goes to the coach, in percent.
    uint8 public immutable coachShare;
    uint256 public totalTips;
    uint256 public tipCount;

    constructor(IERC20 gd_, address coach_, address kitFund_, uint8 coachShare_) {
        if (address(gd_) == address(0) || coach_ == address(0) || kitFund_ == address(0)) revert ZeroAddress();
        if (coachShare_ > 100) revert ShareTooHigh();
        gd = gd_;
        coach = coach_;
        kitFund = kitFund_;
        coachShare = coachShare_;
    }

    /// @notice Tip after approving this contract to spend \`amount\` G$.
    function tip(uint256 amount, string calldata note) external nonReentrant {
        if (amount == 0) revert ZeroTip();
        gd.safeTransferFrom(msg.sender, address(this), amount);
        _split(msg.sender, amount, note);
    }

    /// @notice ERC-677 hook: G$.transferAndCall(tipJar, amount, abi.encode(note)) tips in one step.
    function onTokenTransfer(address from, uint256 amount, bytes calldata data) external nonReentrant returns (bool) {
        if (msg.sender != address(gd)) revert NotGoodDollar();
        if (amount == 0) revert ZeroTip();
        string memory note = data.length > 0 ? abi.decode(data, (string)) : "";
        _split(from, amount, note);
        return true;
    }

    function _split(address from, uint256 amount, string memory note) private {
        uint256 toCoach = (amount * coachShare) / 100;
        totalTips += amount;
        tipCount += 1;
        emit Tipped(from, amount, note);
        gd.safeTransfer(coach, toCoach);
        gd.safeTransfer(kitFund, amount - toCoach);
    }
}
`;

/** The first draft has one missing semicolon, so the demo shows an auto-fix. */
export const DEMO_TIP_JAR_DRAFT = DEMO_TIP_JAR_FIXED.replace("emit Tipped(from, amount, note);", "emit Tipped(from, amount, note)");

export const DEMO_APP = `import { useEffect, useState } from "react";
import { encodeAbiParameters, formatUnits, parseUnits, type Address } from "viem";
import { HandCoins } from "lucide-react";
import { ConnectButton } from "./components/ConnectButton";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { TipJarAbi, TipJarAddress } from "./contracts";
import { chain, publicClient, writeContract } from "./lib/chain";
import { gdTokenAbi } from "./lib/tokens";
import { useWallet } from "./lib/useWallet";

const PRESETS = ["50", "100", "500"];

export default function App() {
  const tipJar = TipJarAddress[chain.id];
  const { account } = useWallet();
  const [gd, setGd] = useState<{ address: Address; decimals: number } | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [totalTips, setTotalTips] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("100");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  // The G$ address comes from the deployed contract; decimals from the token itself.
  useEffect(() => {
    if (!tipJar) return;
    (async () => {
      const address = (await publicClient.readContract({ address: tipJar, abi: TipJarAbi, functionName: "gd" })) as Address;
      const decimals = await publicClient.readContract({ address, abi: gdTokenAbi, functionName: "decimals" });
      setGd({ address, decimals });
      setTotalTips((await publicClient.readContract({ address: tipJar, abi: TipJarAbi, functionName: "totalTips" })) as bigint);
    })().catch(() => setError("Couldn't read the tip jar. Check your connection."));
  }, [tipJar, status]);

  useEffect(() => {
    if (!gd || !account) return;
    publicClient.readContract({ address: gd.address, abi: gdTokenAbi, functionName: "balanceOf", args: [account] }).then(setBalance).catch(() => {});
  }, [gd, account, status]);

  async function sendTip() {
    if (!tipJar || !gd) return;
    setStatus("sending");
    setError("");
    try {
      // One transaction: G$.transferAndCall -> TipJar.onTokenTransfer, with the note encoded as data.
      const data = encodeAbiParameters([{ type: "string" }], [note]);
      await writeContract({ address: gd.address, abi: gdTokenAbi, functionName: "transferAndCall", args: [tipJar, parseUnits(amount, gd.decimals), data] });
      setStatus("sent");
      setNote("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message.split("\\n")[0] : "The tip didn't go through.");
    }
  }

  const fmt = (v: bigint | null) => (v === null || !gd ? "–" : Number(formatUnits(v, gd.decimals)).toLocaleString() + " G$");

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
        <b className="flex items-center gap-2"><HandCoins className="size-5 text-accent" /> Ikeja FC Tip Jar</b>
        <ConnectButton />
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Tipped so far</p><p className="text-2xl font-semibold">{fmt(totalTips)}</p><p className="text-xs text-muted-foreground">70% coach · 30% kit fund</p></CardContent></Card>
          <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Your G$</p><p className="text-2xl font-semibold">{account ? fmt(balance) : "Connect"}</p><p className="text-xs text-muted-foreground">{chain.name}</p></CardContent></Card>
        </div>
        <Card>
          <CardHeader><CardTitle>Send a G$ tip</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {!tipJar && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">Deploy the contract to go live. Until then this is a preview.</p>
            )}
            <div className="flex gap-2">
              {PRESETS.map((p) => (
                <Button key={p} variant={amount === p ? "default" : "outline"} size="sm" onClick={() => setAmount(p)}>{p} G$</Button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Up Ikeja FC!" maxLength={80} />
            </div>
            <Button variant="accent" disabled={!tipJar || !gd || !account || status === "sending"} onClick={sendTip}>
              {status === "sending" ? "Sending…" : "Tip " + amount + " G$"}
            </Button>
            {status === "sent" && <p className="text-sm text-success">Thank you! Your tip is on-chain.</p>}
            {status === "error" && <p className="text-sm text-danger">{error}</p>}
            <p className="text-xs text-muted-foreground">One signature: your G$ goes to the tip jar, which splits it 70/30 straight away and keeps nothing.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
`;

const DEMO_MANIFEST = `${JSON.stringify({ contracts: [{ name: "TipJar", args: { gd_: "${GOODDOLLAR}", coach_: "${DEPLOYER}", kitFund_: "${DEPLOYER}", coachShare_: 70 } }] }, null, 2)}\n`;

const DEMO_SITE = `import { Mail, Sparkles } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";

export default function App() {
  return (
    <main className="mx-auto grid max-w-3xl gap-6 p-4 sm:p-8">
      <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-5 text-accent" /> Ada's Kitchen</p>
      <h1 className="text-3xl font-semibold tracking-tight">Home-cooked jollof, delivered across Yaba</h1>
      <p className="text-muted-foreground">Order by Thursday for weekend delivery. Small batches, made fresh.</p>
      <Card><CardContent className="grid gap-3 pt-5">
        <p className="font-medium">This week's menu</p>
        <p className="text-sm text-muted-foreground">Smoky party jollof, peppered chicken and fried plantain.</p>
        <Button variant="accent"><Mail className="size-4" /> Get in touch</Button>
      </CardContent></Card>
    </main>
  );
}
`;

/** The person's request inside a context message, or the message itself. */
function requestText(content: unknown): string {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p.text ?? "").join("\n") : "";
  return text.split("User request:\n").at(-1) ?? "";
}

/** Questions that fit the request, the way the real model is asked to write them. */
function demoQuestions(request: string) {
  const choice = (question: string, label: string, options: string[], multiple = false) => ({
    question,
    label,
    multiple,
    options: options.map((text, i) => ({ label: text, ...(i === 0 ? { recommended: true } : {}) })),
  });
  if (looksLikeWebsite(request)) {
    return {
      summary: "A simple website for what you described.",
      recommended_palette: "sunrise",
      questions: [
        choice("What's the main thing visitors should do?", "Main action", ["Get in touch", "See what you offer", "Sign up for updates"]),
        choice("Which sections do you want?", "Sections", ["About you", "What you offer", "Photos", "Contact details"], true),
        choice("How should it sound?", "Tone", ["Friendly and simple", "Professional", "Bold and exciting"]),
      ],
    };
  }
  return {
    summary: "An app where supporters send money and it's shared out the way you choose.",
    recommended_palette: "forest",
    questions: [
      choice("What should people be able to do?", "People can", ["Send money", "Leave a short message", "See who has given", "Withdraw their own money"], true),
      choice("Who can take the money out?", "Who takes it out", ["It goes straight to who it's for", "Only me", "Everyone votes on it"]),
      choice("Should there be a limit on how much someone can send?", "Limit", ["No limit", "A small minimum", "A maximum per person"]),
    ],
  };
}

export function demoModel(): ModelClient {
  if (process.env.NODE_ENV === "production" && process.env.GOODBUILD_DEMO_MODEL_IN_PROD !== "true") {
    throw new Error("The demo model is for development only.");
  }
  // A fresh script per call: build, then fix, then a short reply.
  return {
    stream(req) {
      const lastUser = String(req.messages.at(-1)?.content ?? "");
      const isFix = lastUser.startsWith("GoodBuild's checks failed");
      const afterFix = req.messages.some((m) => m.role === "user" && String(m.content).startsWith("GoodBuild's checks failed"));
      const hasToolResults = req.messages.some((m) => m.role === "tool");
      const planMode = !(req.tools ?? []).some((t) => t.type === "function" && t.function.name === "create_file");
      const asking = (req.tools ?? []).some((t) => t.type === "function" && t.function.name === "ask_questions");
      // Plan first (D32). Usage is counted from what this call really sends and returns, so the
      // price the chat shows comes from the normal token and pricing code.
      if (asking) {
        const args = demoQuestions(String(req.messages.at(-1)?.content ?? ""));
        const sent = req.messages.reduce((n, m) => n + String(m.content ?? "").length, 0) + JSON.stringify(req.tools).length;
        return scriptedModel([
          {
            text: "Good idea. A few quick questions so I build the right thing.",
            tools: [{ name: "ask_questions", args }],
            usage: { input: estimateTokens(sent), output: estimateTokens(JSON.stringify(args).length + 60) },
          },
        ]).client.stream(req);
      }
      // A plain website (D20) gets a page and no contract.
      if (!planMode && req.messages.some((m) => m.role === "user" && looksLikeWebsite(requestText(m.content)))) {
        return scriptedModel(
          hasToolResults
            ? [{ text: "Built your page: a clear headline, what you offer and a way to get in touch, in the colours you picked.", usage: { input: 8_000, output: 40 } }]
            : [{ tools: [{ name: "set_plan", args: { summary: "One page", steps: ["Build the page"] } }, { name: "create_file", args: { path: "src/App.tsx", content: DEMO_SITE } }], usage: { input: 8_000, output: 500 } }],
        ).client.stream(req);
      }
      if (planMode) {
        return scriptedModel([
          {
            text: "Here's how I'd add a leaderboard: count each supporter's G$ total in the contract (a mapping updated in _split, plus the Tipped event you already emit), then add a Leaderboard page that reads the events and ranks supporters. Switch to Build to run it.",
            usage: { input: 9_000, output: 120 },
          },
        ]).client.stream(req);
      }
      if (isFix) {
        return scriptedModel([
          {
            tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "emit Tipped(from, amount, note)\n", replace: "emit Tipped(from, amount, note);\n" }] } }],
            usage: { input: 9_000, output: 150 },
          },
        ]).client.stream(req);
      }
      if (afterFix && hasToolResults) {
        return scriptedModel([{ text: "Fixed it: a missing semicolon after the Tipped event.", usage: { input: 10_000, output: 20 } }]).client.stream(req);
      }
      if (hasToolResults) {
        return scriptedModel([
          {
            text: "Built your tip jar: TipJar.sol takes G$ (the ERC-20, not CELO) and splits every tip 70/30 between the coach and the kit fund. Supporters tip in one signature with G$ transferAndCall, or approve and call tip(). At deploy you'll be asked for the coach and kit fund wallets; GoodBuild fills in the G$ address.",
            usage: { input: 14_000, output: 110 },
          },
        ]).client.stream(req);
      }
      return scriptedModel([
        {
          text: "On it. G$ is an ERC-20 on Celo, so the contract takes the token and forwards each tip immediately: no balance sits in it for anyone to drain.",
          tools: [
            { name: "set_plan", args: { summary: "1 contract, 1 page", steps: ["Write TipJar.sol (G$, ERC-677 + approve)", "Build the tip page", "Compile and check"] } },
            { name: "create_file", args: { path: "contracts/TipJar.sol", content: DEMO_TIP_JAR_DRAFT } },
            { name: "create_file", args: { path: "contracts/deploy.json", content: DEMO_MANIFEST } },
            { name: "create_file", args: { path: "src/App.tsx", content: DEMO_APP } },
          ],
          usage: { input: 11_000, output: 2_600 },
        },
      ]).client.stream(req);
    },
  };
}
