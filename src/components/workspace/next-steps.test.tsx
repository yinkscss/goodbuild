import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deploy = { open: vi.fn(), blocked: null as string | null, deployed: [] as string[] };
vi.mock("@/components/deploy/deploy-trigger", () => ({ useDeployAction: () => deploy }));

import type { AssetInfo } from "@/server/agent/assets";
import { LogoChip, nextSteps, PublishNextStep, USE_LOGO_PROMPT, USE_PHOTO_PROMPT } from "./next-steps";
import type { PublishInfo } from "./use-publish";

const logo = (pending: boolean, kind: AssetInfo["kind"] = "logo"): AssetInfo & { pending?: boolean } => ({
  id: "a1",
  name: "brand.png",
  kind,
  mime: "image/png",
  size: 10,
  width: 64,
  height: 64,
  palette: [],
  description: "",
  pending,
});

const info = (over: Partial<PublishInfo> = {}): PublishInfo => ({
  slug: "my-app",
  url: "https://my-app.example",
  domain: "example",
  live: false,
  disabled: false,
  addressLocked: false,
  publishedVersion: null,
  currentVersion: 1,
  undeployed: [],
  hasApp: true,
  ...over,
});

/** Open the Radix menu with the keyboard (jsdom has no pointer capture) and pick an item by label. */
async function pick(trigger: HTMLElement, label: string) {
  const user = userEvent.setup();
  trigger.focus();
  await user.keyboard("{Enter}");
  const item = await screen.findByRole("menuitem", { name: new RegExp(`^${label}`) });
  item.focus();
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  window.localStorage.clear();
  deploy.open.mockClear();
  deploy.blocked = null;
});

describe("LogoChip", () => {
  const props = { projectId: "p1", onUse: vi.fn(), uploading: false, disabled: false };

  it.each([
    ["My logo", "logo"],
    ["A photo or picture", "image"],
  ] as const)("%s uploads the chosen picture as a %s", async (label, kind) => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const onUpload = vi.fn(async () => undefined);
    render(<LogoChip {...props} assets={[]} onUpload={onUpload} />);
    await pick(screen.getByRole("button", { name: /add your logo or photo/i }), label);
    await waitFor(() => expect(click).toHaveBeenCalled());
    const file = new File(["x"], "me.png", { type: "image/png" });
    const input = screen.getByLabelText(/choose your logo or photo/i);
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    fireEvent.change(input);
    expect(onUpload).toHaveBeenCalledWith(file, kind);
    click.mockRestore();
  });

  it("offers a photo added through the chip as a photo, not a logo", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const onUse = vi.fn();
    const { rerender } = render(<LogoChip {...props} onUse={onUse} assets={[]} onUpload={vi.fn()} />);
    await pick(screen.getByRole("button", { name: /add your logo or photo/i }), "A photo or picture");
    rerender(<LogoChip {...props} onUse={onUse} assets={[logo(true, "image")]} onUpload={vi.fn()} />);
    expect(screen.queryByText(/tab icon/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /use my photo in the app/i }));
    expect(onUse).toHaveBeenCalledWith(USE_PHOTO_PROMPT);
    click.mockRestore();
  });

  it("doesn't claim an image attached in the composer", () => {
    const { container } = render(<LogoChip {...props} assets={[logo(true, "image")]} onUpload={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add your logo or photo/i })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/use my photo/i);
  });

  it("offers to use an uploaded logo, which sends a message only on a click", async () => {
    const onUse = vi.fn();
    render(<LogoChip {...props} onUse={onUse} assets={[logo(true)]} onUpload={vi.fn()} />);
    expect(screen.getByText(/becomes your app's tab icon/i)).toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /use my logo in the app/i }));
    expect(onUse).toHaveBeenCalledWith(USE_LOGO_PROMPT);
  });

  it("goes away once a logo was sent", () => {
    const { container } = render(<LogoChip {...props} assets={[logo(false)]} onUpload={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden for the project after Not now", async () => {
    const { unmount } = render(<LogoChip {...props} assets={[]} onUpload={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByRole("button", { name: /add your logo/i })).not.toBeInTheDocument();
    unmount();
    render(<LogoChip {...props} assets={[]} onUpload={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /add your logo/i })).not.toBeInTheDocument();
  });
});

describe("PublishNextStep", () => {
  it("opens the publish window for an app without contracts", async () => {
    const onPublish = vi.fn();
    render(<PublishNextStep info={info()} onPublish={onPublish} />);
    expect(screen.getByText("Publish so others can use it")).toBeInTheDocument();
    expect(screen.getByText(/its own link anyone can open/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onPublish).toHaveBeenCalled();
    expect(deploy.open).not.toHaveBeenCalled();
  });

  it("deploys the contract from the wallet first when it isn't on Celo yet", async () => {
    const onPublish = vi.fn();
    render(<PublishNextStep info={info({ undeployed: ["Savings"] })} onPublish={onPublish} />);
    expect(screen.getByText(/confirm its contract from your wallet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(deploy.open).toHaveBeenCalled();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("falls back to the publish window when deploying isn't possible right now", async () => {
    deploy.blocked = "Wait for the build to finish.";
    const onPublish = vi.fn();
    render(<PublishNextStep info={info({ undeployed: ["Savings"] })} onPublish={onPublish} />);
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onPublish).toHaveBeenCalled();
  });
});

describe("nextSteps", () => {
  const base = {
    running: false,
    live: false,
    currentVersion: 1,
    lastStatus: "ready",
    openQuestions: false,
    draftOpen: false,
    crashed: false,
    publish: info(),
    miniPay: false,
    outdatedContracts: 0,
  };

  it("offers both after a working build of an app that isn't public", () => {
    expect(nextSteps(base)).toEqual({ works: true, publish: true });
    expect(nextSteps({ ...base, lastStatus: "answered" })).toEqual({ works: true, publish: true });
  });

  it.each([
    ["while a build runs", { running: true }],
    ["while a turn streams", { live: true }],
    ["before any build", { currentVersion: 0 }],
    ["after a failed build", { lastStatus: "error" }],
    ["after a build that needs a fix", { lastStatus: "needs_fix" }],
    ["while questions are open", { openQuestions: true }],
    ["while a drafted plan is open", { draftOpen: true }],
    ["when the preview crashed", { crashed: true }],
  ])("offers nothing %s", (_, over) => {
    expect(nextSteps({ ...base, ...over })).toEqual({ works: false, publish: false });
  });

  it.each([
    ["already live", { publish: info({ live: true }) }],
    ["publishing is turned off", { publish: info({ disabled: true }) }],
    ["nothing to publish", { publish: info({ hasApp: false }) }],
    ["status unknown", { publish: null }],
    ["a MiniPay app (its own guide)", { miniPay: true }],
    ["a contract waiting on newer changes", { outdatedContracts: 1 }],
  ])("doesn't offer publishing when %s", (_, over) => {
    expect(nextSteps({ ...base, ...over })).toEqual({ works: true, publish: false });
  });
});
