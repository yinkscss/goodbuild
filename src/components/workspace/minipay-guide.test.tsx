import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deployOpen = vi.fn();
vi.mock("@/components/deploy/deploy-trigger", () => ({ useDeployAction: () => ({ open: deployOpen, blocked: null, deployed: [] }) }));

import { MiniPayGuide } from "./minipay-guide";
import type { PublishInfo } from "./use-publish";

const FILES = { "src/goodbuild.json": '{"kits":["mini-app"]}', "src/App.tsx": "export default function App() { return <main />; }\n" };
const info = (over: Partial<PublishInfo> = {}): PublishInfo => ({
  slug: "rock-dodge",
  url: "https://rock-dodge.goodbuildit.xyz",
  domain: "goodbuildit.xyz",
  live: false,
  disabled: false,
  publishedVersion: null,
  currentVersion: 3,
  undeployed: [],
  hasApp: true,
  ...over,
});

function guide(props: Partial<React.ComponentProps<typeof MiniPayGuide>> = {}) {
  const onPublish = vi.fn();
  render(
    <MiniPayGuide projectId="p1" chainId={11142220} files={FILES} hasContracts={false} outdatedContracts={[]} publish={info()} onPublish={onPublish} onAsk={vi.fn()} busy={false} {...props} />,
  );
  return { onPublish };
}

beforeEach(() => {
  deployOpen.mockClear();
  window.localStorage.clear();
});

describe("MiniPayGuide", () => {
  it("starts with deploying when the game has a contract, and locks the MiniPay steps until then", async () => {
    guide({ hasContracts: true, publish: info({ undeployed: ["Scores"] }) });
    expect(screen.getByText(/Step 1 of 9/)).toBeTruthy();
    expect(screen.getByText("Deploy your game's contract")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Deploy first" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(deployOpen).toHaveBeenCalled();
  });

  it("asks to publish next, and won't go on until it's published", async () => {
    const { onPublish } = guide();
    expect(screen.getByText(/Step 1 of 8/)).toBeTruthy();
    expect(screen.getByText("Publish your game")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Publish first" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onPublish).toHaveBeenCalled();
  });

  it("asks to publish again when the public link has an older version", () => {
    guide({ publish: info({ live: true, publishedVersion: 2 }) });
    expect(screen.getByText("Publish your latest version")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish again" })).toBeTruthy();
  });

  it("once published, starts at the link and walks through MiniPay's developer settings", async () => {
    guide({ publish: info({ live: true, publishedVersion: 3 }) });
    expect(screen.getByText("Copy your game's link")).toBeTruthy();
    expect(screen.getByText("rock-dodge.goodbuildit.xyz", { selector: "code" })).toBeTruthy();
    const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));
    await next();
    expect(screen.getByText("Open MiniPay's Settings")).toBeTruthy();
    await next();
    expect(screen.getByText("Tap the Version number")).toBeTruthy();
    await next();
    await next();
    expect(screen.getByText("Turn on Developer Mode and Use Testnet")).toBeTruthy();
    await next();
    expect(screen.getByText("Load test page, paste, Load")).toBeTruthy();
    await next();
    expect(screen.getByText("Check it works")).toBeTruthy();
    expect(screen.getByText(/GoodBuild checked/)).toBeTruthy();
  });

  it("says to leave Use Testnet off on Celo mainnet", async () => {
    guide({ chainId: 42220, publish: info({ live: true, publishedVersion: 3 }) });
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Turn on Developer Mode")).toBeTruthy();
    expect(screen.getByText(/Leave Use Testnet off/)).toBeTruthy();
  });

  it("can be hidden, and comes back from its chip", async () => {
    guide({ publish: info({ live: true, publishedVersion: 3 }) });
    await userEvent.click(screen.getByRole("button", { name: "Hide the MiniPay guide" }));
    expect(screen.queryByText("Copy your game's link")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Test it in MiniPay" }));
    expect(screen.getByText("Copy your game's link")).toBeTruthy();
  });
});
