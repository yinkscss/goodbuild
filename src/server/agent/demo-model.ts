import "server-only";

import type { ModelClient } from "./model";
import { scriptedModel } from "./fake-model";

/**
 * Development-only stand-in for the LLM (GOODBUILD_DEMO_MODEL=1): replays a realistic
 * first build of a tip jar, including a compile error the cheap model fixes, so the
 * workspace, streaming, checks and preview can be tried without API keys.
 * Refused in production.
 */
const HEADER = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\n";

const CONTRACT = `${HEADER}import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Club tip jar that splits every tip between two wallets.
contract TipJar is ReentrancyGuard {
    error ZeroTip();
    error TransferFailed();

    event Tipped(address indexed from, uint256 amount, string note);

    address payable public immutable coach;
    address payable public immutable kitFund;
    /// @notice Share of each tip that goes to the coach, in percent.
    uint8 public immutable coachShare;
    uint256 public totalTips;
    uint256 public tipCount;

    constructor(address payable coach_, address payable kitFund_, uint8 coachShare_) {
        require(coachShare_ <= 100, "share > 100");
        coach = coach_;
        kitFund = kitFund_;
        coachShare = coachShare_;
    }

    /// @notice Send a tip in CELO with an optional note.
    function tip(string calldata note) external payable nonReentrant {
        if (msg.value == 0) revert ZeroTip();
        uint256 toCoach = (msg.value * coachShare) / 100;
        totalTips += msg.value;
        tipCount += 1;
        emit Tipped(msg.sender, msg.value, note)
        (bool a, ) = coach.call{value: toCoach}("");
        (bool b, ) = kitFund.call{value: msg.value - toCoach}("");
        if (!a || !b) revert TransferFailed();
    }
}
`;

const APP = `import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { HandCoins } from "lucide-react";
import { ConnectButton } from "./components/ConnectButton";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { TipJarAbi, TipJarAddress } from "./contracts";
import { chain, writeContract } from "./lib/chain";

const PRESETS = ["0.5", "1", "5"];

export default function App() {
  const address = TipJarAddress[chain.id];
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function sendTip() {
    if (!address) return;
    setStatus("sending");
    setError("");
    try {
      await writeContract({ address, abi: TipJarAbi, functionName: "tip", args: [note], value: parseEther(amount) });
      setStatus("sent");
      setNote("");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message.split("\\n")[0] : "The tip didn't go through.");
    }
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
        <b className="flex items-center gap-2"><HandCoins className="size-5 text-accent" /> Ikeja FC Tip Jar</b>
        <ConnectButton />
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Split</p><p className="text-2xl font-semibold">70 / 30</p><p className="text-xs text-muted-foreground">coach / kit fund</p></CardContent></Card>
          <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Network</p><p className="text-2xl font-semibold">Celo</p><p className="text-xs text-muted-foreground">{chain.name}</p></CardContent></Card>
        </div>
        <Card>
          <CardHeader><CardTitle>Send a tip</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {!address && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">Deploy the contract to go live. Until then this is a preview.</p>
            )}
            <div className="flex gap-2">
              {PRESETS.map((p) => (
                <Button key={p} variant={amount === p ? "default" : "outline"} size="sm" onClick={() => setAmount(p)}>{p} CELO</Button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Up Ikeja FC!" maxLength={80} />
            </div>
            <Button variant="accent" disabled={!address || status === "sending"} onClick={sendTip}>
              {status === "sending" ? "Sending…" : "Tip " + amount + " CELO"}
            </Button>
            {status === "sent" && <p className="text-sm text-success">Thank you! Your tip is on-chain.</p>}
            {status === "error" && <p className="text-sm text-danger">{error}</p>}
            <p className="text-xs text-muted-foreground">Tips are split automatically: {formatEther(parseEther(amount) * 70n / 100n)} CELO to the coach, the rest to the kit fund.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
`;

export function demoModel(): ModelClient {
  if (process.env.NODE_ENV === "production" && process.env.GOODBUILD_DEMO_MODEL_IN_PROD !== "true") {
    throw new Error("The demo model is for development only.");
  }
  // A fresh script per turn: build, then fix, then a short reply for follow-ups.
  return {
    stream(req) {
      const isFix = String(req.messages.at(-1)?.content ?? "").startsWith("GoodBuild's checks failed");
      const afterFix = req.messages.some((m) => m.role === "user" && String(m.content).startsWith("GoodBuild's checks failed"));
      const hasToolResults = req.messages.some((m) => m.role === "tool");
      const planMode = !(req.tools ?? []).some((t) => t.type === "function" && t.function.name === "create_file");
      if (planMode) {
        return scriptedModel([
          {
            text: "Here's how I'd add a leaderboard: count each supporter's total in the contract (a mapping plus a Tipped event you already emit), then add a Leaderboard page that reads the events and ranks supporters. Switch to Build to run it.",
            usage: { input: 9_000, output: 120 },
          },
        ]).client.stream(req);
      }
      if (afterFix && hasToolResults && !isFix) {
        return scriptedModel([{ text: "Fixed it: a missing semicolon after the Tipped event.", usage: { input: 10_000, output: 20 } }]).client.stream(req);
      }
      const script = isFix
        ? scriptedModel([
            { tools: [{ name: "edit_file", args: { path: "contracts/TipJar.sol", edits: [{ search: "emit Tipped(msg.sender, msg.value, note)\n", replace: "emit Tipped(msg.sender, msg.value, note);\n" }] } }], usage: { input: 9_000, output: 150 } },
          ])
        : hasToolResults
          ? scriptedModel([{ text: "Built your tip jar: one contract, TipJar.sol, splits every tip 70/30 between the coach and the kit fund, and the page lets supporters tip with a note. At deploy you'll be asked for the coach and kit fund wallet addresses.", usage: { input: 14_000, output: 90 } }])
          : scriptedModel([
              {
                text: "On it. One contract holds nothing: each tip is split and forwarded immediately, so there's no balance anyone could drain.",
                tools: [
                  { name: "set_plan", args: { summary: "1 contract, 1 page", steps: ["Write TipJar.sol", "Build the tip page", "Compile and check"] } },
                  { name: "create_file", args: { path: "contracts/TipJar.sol", content: CONTRACT } },
                  { name: "create_file", args: { path: "src/App.tsx", content: APP } },
                ],
                usage: { input: 11_000, output: 2_400 },
              },
            ]);
      return script.client.stream(req);
    },
  };
}
