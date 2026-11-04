import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PromptBox } from "./prompt-box";
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

  it("plain Enter adds a newline instead of submitting", async () => {
    const onSubmit = vi.fn();
    render(<PromptBox onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/describe the dapp/i), "line one{Enter}line two");
    expect(onSubmit).not.toHaveBeenCalled();
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
