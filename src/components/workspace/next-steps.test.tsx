import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deploy = { open: vi.fn(), blocked: null as string | null, deployed: [] as string[] };
vi.mock("@/components/deploy/deploy-trigger", () => ({ useDeployAction: () => deploy }));

import type { AssetInfo } from "@/server/agent/assets";
import { LogoChip, PublishNextStep, USE_LOGO_PROMPT } from "./next-steps";
import type { PublishInfo } from "./use-publish";

const logo = (pending: boolean): AssetInfo & { pending?: boolean } => ({
  id: "a1",
  name: "brand.png",
  kind: "logo",
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

beforeEach(() => {
  window.localStorage.clear();
  deploy.open.mockClear();
  deploy.blocked = null;
});

describe("LogoChip", () => {
  const props = { projectId: "p1", onUse: vi.fn(), uploading: false, disabled: false };

  it("uploads the chosen picture as a logo", async () => {
    const onUpload = vi.fn(async () => undefined);
    render(<LogoChip {...props} assets={[]} onUpload={onUpload} />);
    expect(screen.getByRole("button", { name: /add your logo or photo/i })).toBeInTheDocument();
    const file = new File(["x"], "me.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose your logo or photo/i), file);
    expect(onUpload).toHaveBeenCalledWith(file, "logo");
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
