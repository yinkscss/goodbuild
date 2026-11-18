import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { AssetInfo } from "@/server/agent/assets";
import { Composer } from "./chat-panel";

const asset = (id: string, name: string, pending: boolean): AssetInfo & { pending: boolean } => ({
  id,
  name,
  kind: "image",
  mime: "image/png",
  size: 10,
  width: 1,
  height: 1,
  palette: [],
  description: "",
  pending,
});

function renderComposer(assets: Array<AssetInfo & { pending: boolean }>) {
  const onSend = vi.fn();
  render(
    <Composer
      assets={assets}
      assetUrls={{}}
      onUpload={vi.fn()}
      onRemove={vi.fn()}
      onChangeKind={vi.fn()}
      uploading={false}
      running={false}
      estimate={{ buildMicro: 0, planMicro: 0 }}
      onSend={onSend}
      placeholder="Ask"
    />,
  );
  return onSend;
}

describe("Composer files", () => {
  it("shows only files waiting to be sent as chips; sent ones sit behind Files", () => {
    renderComposer([asset("1", "hero.png", true), asset("2", "old-logo.png", false)]);
    expect(screen.getByText("hero.png")).toBeTruthy();
    expect(screen.queryByText("old-logo.png")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Files 1/ }));
    expect(screen.getByText("old-logo.png")).toBeTruthy();
  });

  it("no Files button when nothing was sent before", () => {
    renderComposer([asset("1", "hero.png", true)]);
    expect(screen.queryByRole("button", { name: /Files/ })).toBeNull();
  });
});
