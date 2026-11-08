import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import { SendGateProvider } from "@/components/auth/send-gate";
import { CreditsPill } from "./credits-pill";
import { HomePrompt, HomePromptProvider } from "./home-prompt";
import { ProjectGrid, ProjectsEmpty, ProjectsError, RecentBuilds } from "./projects";
import { TEMPLATES } from "@/config/templates";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

describe("CreditsPill", () => {
  it("says free AI instead of inventing a balance before the ledger exists", () => {
    render(<CreditsPill balanceGd={null} usdPerGd={null} />);
    expect(screen.getByText("Free AI")).toBeInTheDocument();
    expect(screen.queryByText(/\d G\$/)).not.toBeInTheDocument();
  });
  it("shows G$ and USD when live", () => {
    render(<CreditsPill balanceGd={120} usdPerGd={0.000112} />);
    expect(screen.getByText("120 G$")).toBeInTheDocument();
    expect(screen.getByText("≈ $0.01")).toBeInTheDocument();
    expect(screen.queryByText("Top up")).not.toBeInTheDocument();
  });
  it("warns with a top-up link at 10 G$ or less", () => {
    render(<CreditsPill balanceGd={8} usdPerGd={null} />);
    expect(screen.getByRole("link", { name: "Top up" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

const now = new Date(2026, 10, 4, 15, 0);
const projects = [
  { id: "a", name: "SavingsCircle", status: "deployed", chainId: 11142220, updatedAt: new Date(2026, 10, 4, 13, 0), kind: "savings" as const },
  { id: "b", name: "Co-op Grain Fund", status: "needs_fix", chainId: 11142220, updatedAt: new Date(2026, 9, 27, 9, 0), kind: "custom" as const },
];

describe("project cards", () => {
  it("link to the workspace with status and time", () => {
    render(<ProjectGrid projects={projects} now={now} />);
    expect(screen.getByRole("link", { name: /savingscircle/i })).toHaveAttribute("href", "/p/a");
    expect(screen.getByText("Deployed · Celo Sepolia")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("Needs fix · build error")).toBeInTheDocument();
    expect(screen.getByText("Last week")).toBeInTheDocument();
    expect(screen.getByText("Savings circle")).toBeInTheDocument();
    expect(screen.getByText("Custom dApp")).toBeInTheDocument();
  });

  it("keeps every project reachable past the first eight", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...projects[0], id: `p${i}`, name: `Project ${i}` }));
    render(<ProjectGrid projects={many} now={now} />);
    expect(screen.getAllByRole("link")).toHaveLength(11);
    expect(screen.getByText("Show all 11 projects")).toBeInTheDocument();
  });

  it("sidebar shows a hint when there are no builds", () => {
    render(<RecentBuilds projects={[]} />);
    expect(screen.getByText(/will show up here/i)).toBeInTheDocument();
  });

  it("error card offers a retry and details", () => {
    render(<ProjectsError detail="connect ECONNREFUSED" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load your projects/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText("connect ECONNREFUSED")).toBeInTheDocument();
  });
});

function Home({ balanceGd = null as number | null }) {
  return (
    <AuthContextProvider value={{ ...unconfiguredAuth, configured: true }}>
      <SendGateProvider>
        <HomePromptProvider>
          <HomePrompt balanceGd={balanceGd} />
          <ProjectsEmpty />
        </HomePromptProvider>
      </SendGateProvider>
    </AuthContextProvider>
  );
}

describe("home prompt and empty state", () => {
  it("empty-state chips fill the prompt box", async () => {
    render(<Home />);
    const empty = screen.getByText(/no builds yet/i).parentElement!;
    const chip = Array.from(empty.querySelectorAll("button")).find((b) => b.textContent === "Community tip jar")!;
    await userEvent.click(chip);
    expect(screen.getByLabelText(/describe the dapp/i)).toHaveValue(TEMPLATES[1].examplePrompt);
  });

  it("shows the testnet hint before credits exist", () => {
    render(<Home />);
    expect(screen.getByText("$0.20 of AI free during the testnet beta")).toBeInTheDocument();
  });

  it("disables Build it at zero credits with the top-up message", async () => {
    render(<Home balanceGd={0} />);
    await userEvent.type(screen.getByLabelText(/describe the dapp/i), "A tip jar");
    expect(screen.getByRole("button", { name: /build it/i })).toBeDisabled();
    expect(screen.getByText("Top up to keep building")).toBeInTheDocument();
  });
});
