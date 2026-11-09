import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AssetInfo } from "@/server/agent/assets";
import { Composer } from "./chat-panel";
import { HERO_DRAFT, LOGO_DRAFT, TemplateNudges } from "./template-nudges";

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });
const asset = (kind: AssetInfo["kind"]): AssetInfo => ({ id: kind, name: `${kind}.png`, kind, mime: "image/png", size: 10, width: 10, height: 10, palette: [], description: "" });

function setup(over: Partial<React.ComponentProps<typeof TemplateNudges>> = {}) {
  const props = { templateId: "folio", version: 1, assets: [] as AssetInfo[], userMessages: 1, running: false, onUpload: vi.fn(async () => true), onDraft: vi.fn(), ...over };
  render(<TemplateNudges {...props} />);
  return props;
}

describe("TemplateNudges", () => {
  it("offers both shortcuts after a template's first build", () => {
    setup();
    expect(screen.getByRole("button", { name: "Add your logo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace the hero image" })).toBeInTheDocument();
  });

  it("shows nothing for other projects, before the first build, while building, or once the chat is under way", () => {
    for (const over of [{ templateId: "tip-jar" }, { templateId: null }, { version: 0 }, { running: true }, { userMessages: 5 }]) {
      const { unmount } = render(<TemplateNudges templateId="folio" version={1} assets={[]} userMessages={1} running={false} onUpload={vi.fn()} onDraft={vi.fn()} {...over} />);
      expect(screen.queryByRole("group", { name: "Make it yours" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("uploads the logo as a logo and suggests a sentence for the composer", async () => {
    const p = setup();
    await userEvent.upload(screen.getByLabelText("Choose your logo"), png());
    expect(p.onUpload).toHaveBeenCalledWith(expect.any(File), "logo");
    await waitFor(() => expect(p.onDraft).toHaveBeenCalledWith(LOGO_DRAFT));
  });

  it("uploads the hero image as an image", async () => {
    const p = setup();
    await userEvent.upload(screen.getByLabelText("Choose a hero image"), png());
    expect(p.onUpload).toHaveBeenCalledWith(expect.any(File), "image");
    await waitFor(() => expect(p.onDraft).toHaveBeenCalledWith(HERO_DRAFT));
  });

  it("suggests nothing when the upload fails", async () => {
    const p = setup({ onUpload: vi.fn(async () => false) });
    await userEvent.upload(screen.getByLabelText("Choose your logo"), png());
    await waitFor(() => expect(p.onUpload).toHaveBeenCalled());
    expect(p.onDraft).not.toHaveBeenCalled();
  });

  it("hides a shortcut once that file exists, and can be dismissed", async () => {
    setup({ assets: [asset("logo")] });
    expect(screen.queryByRole("button", { name: "Add your logo" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("group", { name: "Make it yours" })).not.toBeInTheDocument();
  });
});

describe("Composer draft", () => {
  const props = { assets: [], assetUrls: {}, onUpload: vi.fn(), onRemove: vi.fn(), onChangeKind: vi.fn(), uploading: false, running: false, estimate: { buildMicro: 0, planMicro: 0 }, onSend: vi.fn(), placeholder: "Ask" };

  it("fills an empty box with the suggestion", () => {
    render(<Composer {...props} draft={{ id: 1, text: LOGO_DRAFT }} />);
    expect(screen.getByRole("textbox")).toHaveValue(LOGO_DRAFT);
  });

  it("never overwrites what the person is typing, and stays usable meanwhile", async () => {
    const { rerender } = render(<Composer {...props} />);
    await userEvent.type(screen.getByRole("textbox"), "Make the headline bigger");
    rerender(<Composer {...props} draft={{ id: 1, text: LOGO_DRAFT }} />);
    expect(screen.getByRole("textbox")).toHaveValue("Make the headline bigger");
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
});
