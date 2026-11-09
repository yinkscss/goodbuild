import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PromptBox, type PromptBoxHandle } from "./prompt-box";
import { TEMPLATES } from "@/config/templates";

const chips = TEMPLATES.slice(0, 3);

describe("PromptBox", () => {
  it("disables Build it until there is text", async () => {
    render(<PromptBox chips={chips} onSubmit={vi.fn()} />);
    const send = screen.getByRole("button", { name: /build it/i });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/describe the dapp/i), "A tip jar");
    expect(send).toBeEnabled();
  });

  it("fills the prompt from an example chip and submits with Ctrl+Enter", async () => {
    const onSubmit = vi.fn();
    render(<PromptBox chips={chips} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Community tip jar" }));
    const box = screen.getByLabelText(/describe the dapp/i) as HTMLTextAreaElement;
    expect(box.value).toBe(TEMPLATES[1].examplePrompt);
    await userEvent.type(box, "{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: TEMPLATES[1].examplePrompt, templateId: "tip-jar", network: "celo-sepolia" }),
    );
  });

  it("Enter submits and Shift+Enter adds a newline", async () => {
    const onSubmit = vi.fn();
    render(<PromptBox onSubmit={onSubmit} />);
    const box = screen.getByLabelText(/describe the dapp/i) as HTMLTextAreaElement;
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box.value).toBe("line one\nline two");
    await userEvent.type(box, "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps mainnet locked unless the flag is on", () => {
    const { rerender } = render(<PromptBox onSubmit={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Celo" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Celo Sepolia" })).toHaveAttribute("aria-checked", "true");
    rerender(<PromptBox onSubmit={vi.fn()} mainnetEnabled />);
    expect(screen.getByRole("radio", { name: "Celo" })).toBeEnabled();
  });

  it("shows the disabled reason instead of the credits hint", () => {
    render(<PromptBox onSubmit={vi.fn()} disabled disabledReason="Top up to keep building" creditsLabel="0 G$" />);
    expect(screen.getByText("Top up to keep building")).toBeInTheDocument();
  });

  it("Enhance is disabled without a handler", () => {
    render(<PromptBox onSubmit={vi.fn()} initialValue="tip jar" />);
    expect(screen.getByRole("button", { name: /enhance prompt/i })).toBeDisabled();
  });
});

describe("a gallery template attached to the prompt box", () => {
  it("shows its thumbnail, leaves the text for the person, and sends the template id with their own words", async () => {
    const { PAGE_TEMPLATES } = await import("@/config/page-template-data");
    const { getTemplate } = await import("@/config/templates");
    const onSubmit = vi.fn();
    const handle = React.createRef<PromptBoxHandle>();
    render(<PromptBox ref={handle} onSubmit={onSubmit} />);
    act(() => handle.current!.fill(getTemplate(PAGE_TEMPLATES[0].id)!));
    expect(screen.getByText(PAGE_TEMPLATES[0].label, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /template preview/i })).toBeInTheDocument();
    const box = screen.getByLabelText(/with the .* template/i) as HTMLTextAreaElement;
    expect(box.value).toBe("");
    expect(screen.getByRole("button", { name: /build it/i })).toBeDisabled();
    await userEvent.type(box, "A portfolio for me, Ada, a brand designer");
    await userEvent.click(screen.getByRole("button", { name: /build it/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt: "A portfolio for me, Ada, a brand designer", templateId: PAGE_TEMPLATES[0].id }));
  });

  it("can be removed again", async () => {
    const { PAGE_TEMPLATES } = await import("@/config/page-template-data");
    const { getTemplate } = await import("@/config/templates");
    const handle = React.createRef<PromptBoxHandle>();
    render(<PromptBox ref={handle} onSubmit={vi.fn()} />);
    act(() => handle.current!.fill(getTemplate(PAGE_TEMPLATES[0].id)!));
    await userEvent.click(screen.getByRole("button", { name: /remove the .* template/i }));
    expect(screen.queryByRole("img", { name: /template preview/i })).not.toBeInTheDocument();
  });
});
