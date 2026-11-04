/**
 * A realistic 30-plus-file project (landing page plus a 3-page tip-jar dApp) for testing code
 * search and context selection (docs/evals/HARNESS.md, eval 3). Starter files plus sections,
 * pages, a hook and a contract with its test.
 */
import { starterFiles } from "../template";

const section = (name: string, id: string, body: string) => `import { ${name === "Hero" ? "ArrowRight" : "Sparkles"} } from "lucide-react";
import { Button } from "../ui/button";

/** ${name} section of the landing page. */
export default function ${name}() {
  return (
    <section id="${id}" className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
${body}
      </div>
    </section>
  );
}
`;

const page = (name: string, body: string, imports = "") => `import * as React from "react";
${imports}
export default function ${name}() {
  React.useEffect(() => {
    document.title = "${name} · Lagos Coders Tip Jar";
  }, []);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
${body}
    </div>
  );
}
`;

export function thirtyFileProject(): Record<string, string> {
  const files = { ...starterFiles() };
  files["src/App.tsx"] = `import { HashRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Jar from "./pages/Jar";
import About from "./pages/About";
import Leaderboard from "./pages/Leaderboard";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="jar" element={<Jar />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
`;
  files["src/components/Layout.tsx"] = `import * as React from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Coffee, Menu, X } from "lucide-react";
import { ConnectButton } from "./ConnectButton";
import Footer from "./Footer";

const LINKS = [
  { to: "/jar", label: "Tip jar" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/about", label: "About" },
];

/** Shared top bar with nav, mobile menu and the footer. */
export default function Layout() {
  const [open, setOpen] = React.useState(false);
  const location = useLocation();
  React.useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-display font-semibold"><Coffee className="size-5 text-accent" /> Lagos Coders</Link>
          <nav className="hidden items-center gap-6 md:flex">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? "font-medium text-foreground" : "text-muted-foreground")}>{l.label}</NavLink>
            ))}
            <ConnectButton />
          </nav>
          <button className="md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <X /> : <Menu />}</button>
        </div>
        {open && (
          <div className="border-t border-border px-4 py-2 md:hidden">
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} className="block py-3">{l.label}</NavLink>)}
            <ConnectButton />
          </div>
        )}
      </header>
      <Outlet />
      <Footer />
    </div>
  );
}
`;
  files["src/components/Footer.tsx"] = `import { Link } from "react-router-dom";

/** Site footer: links and small print. */
export default function Footer() {
  return (
    <footer className="border-t border-border py-10 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 sm:flex-row sm:justify-between">
        <p>© 2026 Lagos Coders. Tips go straight to the club treasury on Celo.</p>
        <div className="flex gap-4">
          <Link to="/about">About</Link>
          <a href="https://github.com/lagoscoders">GitHub</a>
          <a href="mailto:hello@lagoscoders.dev">Contact</a>
        </div>
      </div>
    </footer>
  );
}
`;
  files["src/components/sections/Hero.tsx"] = section(
    "Hero",
    "hero",
    `        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Lagos Coders club</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Buy the club a coffee in G$</h1>
        <p className="mt-4 max-w-xl text-muted-foreground">Every tip funds snacks, data bundles and venue costs for our Saturday meetups.</p>
        <div className="mt-8 flex gap-3"><Button>Send a tip <ArrowRight className="size-4" /></Button></div>`,
  );
  files["src/components/sections/Features.tsx"] = section(
    "Features",
    "features",
    `        <h2 className="text-2xl font-semibold">Why tip with G$</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {["No bank needed", "Seen on-chain", "Instant"].map((t) => <div key={t} className="rounded-lg bg-card p-6 shadow-sm"><Sparkles className="size-5 text-accent" /><p className="mt-3 font-medium">{t}</p></div>)}
        </div>`,
  );
  files["src/components/sections/HowItWorks.tsx"] = section(
    "HowItWorks",
    "how-it-works",
    `        <h2 className="text-2xl font-semibold">How it works</h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          <li>1. Connect your wallet</li>
          <li>2. Pick an amount of G$</li>
          <li>3. Confirm the tip</li>
        </ol>`,
  );
  files["src/components/sections/Faq.tsx"] = section(
    "Faq",
    "faq",
    `        <h2 className="text-2xl font-semibold">Questions</h2>
        <div className="mt-6 space-y-3">
          <details className="rounded-lg bg-card p-4"><summary className="font-medium">Are there fees?</summary><p className="mt-2 text-muted-foreground">Only the Celo network fee, usually under a cent.</p></details>
          <details className="rounded-lg bg-card p-4"><summary className="font-medium">Where does the money go?</summary><p className="mt-2 text-muted-foreground">To the club treasury address, visible on Celoscan.</p></details>
          <details className="rounded-lg bg-card p-4"><summary className="font-medium">What is G$?</summary><p className="mt-2 text-muted-foreground">GoodDollar, a token on Celo.</p></details>
        </div>`,
  );
  files["src/components/sections/CtaBand.tsx"] = section(
    "CtaBand",
    "cta",
    `        <div className="rounded-2xl bg-primary p-8 text-primary-foreground sm:p-12">
          <h2 className="text-2xl font-semibold">Saturday is coming. Fuel the meetup.</h2>
          <Button className="mt-6" variant="secondary">Open the tip jar</Button>
        </div>`,
  );
  files["src/components/sections/Stats.tsx"] = section(
    "Stats",
    "stats",
    `        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[["Total tipped", "–"], ["Tips", "–"], ["This month", "–"], ["Top tip", "–"]].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-card p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></div>
          ))}
        </div>`,
  );
  files["src/pages/Home.tsx"] = page(
    "Home",
    `      <Hero />
      <Stats />
      <Features />
      <HowItWorks />
      <Faq />
      <CtaBand />`,
    `import Hero from "../components/sections/Hero";
import Stats from "../components/sections/Stats";
import Features from "../components/sections/Features";
import HowItWorks from "../components/sections/HowItWorks";
import Faq from "../components/sections/Faq";
import CtaBand from "../components/sections/CtaBand";`,
  );
  files["src/pages/Jar.tsx"] = page(
    "Jar",
    `      <h1 className="text-2xl font-semibold">Tip the club</h1>
      <TipForm />`,
    `import TipForm from "../components/TipForm";`,
  );
  files["src/components/TipForm.tsx"] = `import * as React from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Notice } from "./ui/notice";
import { useTipJar } from "../lib/useTipJar";

const QUICK = [10, 50, 100];

/** The tip form: amount chips, input and the send button. */
export default function TipForm() {
  const [amount, setAmount] = React.useState("");
  const { tip, pending, error, live } = useTipJar();
  return (
    <form className="mt-6 space-y-4 rounded-lg bg-card p-6" onSubmit={(e) => { e.preventDefault(); void tip(amount); }}>
      {!live && <Notice>Deploy the contract to go live</Notice>}
      <div className="flex gap-2">{QUICK.map((q) => <Button key={q} type="button" variant="outline" onClick={() => setAmount(String(q))}>{q} G$</Button>)}</div>
      <Label htmlFor="amount">Amount</Label>
      <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" disabled={pending || !live}>{pending ? "Sending…" : "Send tip"}</Button>
    </form>
  );
}
`;
  files["src/pages/Leaderboard.tsx"] = page(
    "Leaderboard",
    `      <h1 className="text-2xl font-semibold">Top tippers</h1>
      <ol className="mt-6 space-y-2">
        {top.slice(0, 10).map((row, i) => <li key={row.address} className="flex justify-between rounded-lg bg-card p-4"><span>{i + 1}. {shortAddress(row.address)}</span><span className="tabular-nums">{row.total}</span></li>)}
      </ol>`,
    `import { shortAddress } from "../lib/utils";
const top: { address: string; total: string }[] = [];`,
  );
  files["src/pages/About.tsx"] = page(
    "About",
    `      <h1 className="text-2xl font-semibold">About Lagos Coders</h1>
      <p className="mt-4 text-muted-foreground leading-relaxed">We are a free weekly meetup for people learning to code in Lagos. The tip jar keeps the lights on.</p>`,
  );
  files["src/pages/NotFound.tsx"] = page("NotFound", `      <h1 className="text-2xl font-semibold">Page not found</h1>`);
  files["src/lib/useTipJar.ts"] = `import { parseUnits } from "viem";
import { chain, publicClient, writeContract } from "./chain";
import { useTx } from "./hooks";
import { TipJarAbi, TipJarAddress } from "../contracts";

/** Reads and the tip write for the TipJar contract. */
export function useTipJar() {
  const address = TipJarAddress[chain.id];
  const { run, pending, error } = useTx();
  const tip = (amount: string) => run(() => writeContract({ address: address!, abi: TipJarAbi, functionName: "tip", args: [parseUnits(amount || "0", 18)] }));
  return { tip, pending, error: error ? String(error) : null, live: Boolean(address), publicClient };
}
`;
  files["contracts/TipJar.sol"] = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Tip jar for the Lagos Coders club, paid in G$.
contract TipJar is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable gd;
    address public immutable treasury;
    uint256 public totalTipped;
    error ZeroTip();
    event Tipped(address indexed from, uint256 amount);

    constructor(IERC20 gd_) { gd = gd_; treasury = msg.sender; }

    /// @notice Tip the club.
    function tip(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroTip();
        totalTipped += amount;
        gd.safeTransferFrom(msg.sender, treasury, amount);
        emit Tipped(msg.sender, amount);
    }
}
`;
  files["contracts/test/TipJar.t.sol"] = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, Actor} from "@goodbuild/Test.sol";
import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";
import {TipJar} from "../TipJar.sol";

contract TipJarTest is Test {
    MockGoodDollar gd; TipJar jar;
    function setUp() public { gd = new MockGoodDollar(); jar = new TipJar(gd); }
    function testTip() public {
        Actor alice = newActor();
        gd.mint(address(alice), 100);
        alice.exec(address(gd), abi.encodeCall(gd.approve, (address(jar), 100)));
        alice.exec(address(jar), abi.encodeCall(jar.tip, (100)));
        assertEq(jar.totalTipped(), 100, "total");
    }
}
`;
  return files;
}

/** Edit requests whose change lives in exactly one file, with that file. */
export const FIND_CASES: Array<{ request: string; target: string }> = [
  { request: "Change the FAQ answer about fees to say tips have no platform fee", target: "src/components/sections/Faq.tsx" },
  { request: "Make the hero headline bigger on desktop", target: "src/components/sections/Hero.tsx" },
  { request: "Add a Twitter link to the footer", target: "src/components/Footer.tsx" },
  { request: "Show the top 20 tippers on the leaderboard instead of 10", target: "src/pages/Leaderboard.tsx" },
  { request: "The how it works steps should be four, add 'Share your receipt'", target: "src/components/sections/HowItWorks.tsx" },
  { request: "Add 500 G$ to the quick amount chips on the tip form", target: "src/components/TipForm.tsx" },
  { request: "In the stats row, rename 'Top tip' to 'Biggest tip'", target: "src/components/sections/Stats.tsx" },
  { request: "On the about page add a paragraph about our mission", target: "src/pages/About.tsx" },
  { request: "Change the call to action band text to 'Fuel Saturday'", target: "src/components/sections/CtaBand.tsx" },
  { request: "The mobile menu should close when I press Escape", target: "src/components/Layout.tsx" },
  { request: "Make the 404 page friendlier with a button back to the tip jar", target: "src/pages/NotFound.tsx" },
];
