import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AssetInfo } from "@/server/agent/assets";
import { AssetBar, AttachMenu } from "./asset-bar";

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "Logo.png", { type: "image/png" });

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  fireEvent.change(input);
}

/** Open the Radix menu with the keyboard (jsdom has no pointer capture) and pick an item by label. */
async function pick(trigger: HTMLElement, label: string) {
  const user = userEvent.setup();
  trigger.focus();
  await user.keyboard("{Enter}");
  const item = await screen.findByRole("menuitem", { name: new RegExp(`^${label}`) });
  item.focus();
  await user.keyboard("{Enter}");
}

describe("AttachMenu", () => {
  it.each([
    ["Logo", "logo"],
    ["Image", "image"],
    ["Design reference", "reference"],
  ] as const)("the %s item opens the file dialog and uploads the chosen file as a %s", async (label, kind) => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const onUpload = vi.fn();
    render(<AttachMenu onUpload={onUpload} uploading={false} />);
    await pick(screen.getByRole("button", { name: "Attach an image" }), label);
    await waitFor(() => expect(click).toHaveBeenCalled());
    const input = screen.getByLabelText("Choose an image file") as HTMLInputElement;
    expect(input.dataset.kind).toBe(kind);
    setFiles(input, [png()]);
    expect(onUpload).toHaveBeenCalledWith(expect.any(File), kind);
    // The next pick starts from "image" again.
    expect(input.dataset.kind).toBe("image");
    click.mockRestore();
  });

  it("ignores files that aren't images", () => {
    const onUpload = vi.fn();
    render(<AttachMenu onUpload={onUpload} uploading={false} />);
    setFiles(screen.getByLabelText("Choose an image file") as HTMLInputElement, [new File(["x"], "notes.pdf", { type: "application/pdf" })]);
    expect(onUpload).not.toHaveBeenCalled();
  });
});

describe("AssetBar", () => {
  const asset: AssetInfo = { id: "a1", name: "kola.png", kind: "image", mime: "image/png", size: 1, width: 1, height: 1, palette: [], description: "" };
  it("changes an upload's role from the chip menu", async () => {
    const onChangeKind = vi.fn();
    render(<AssetBar assets={[asset]} assetUrls={{}} onRemove={vi.fn()} onChangeKind={onChangeKind} />);
    await pick(screen.getByRole("button", { name: /kola\.png is a image/i }), "Logo");
    expect(onChangeKind).toHaveBeenCalledWith("a1", "logo");
  });
  it("removes an upload", async () => {
    const onRemove = vi.fn();
    render(<AssetBar assets={[asset]} assetUrls={{}} onRemove={onRemove} onChangeKind={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove kola.png" }));
    expect(onRemove).toHaveBeenCalledWith("a1");
  });
});
