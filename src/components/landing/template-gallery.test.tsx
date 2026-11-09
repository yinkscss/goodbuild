import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { templateRequest } from "@/config/page-templates";
import { TemplateGallery } from "./template-gallery";

const send = vi.fn(async () => undefined);
vi.mock("@/components/auth/send-gate", () => ({ useSendGate: () => ({ send, sendError: null, openConnect: vi.fn() }) }));

describe("TemplateGallery", () => {
  it("shows a screenshot card for the first templates and can show all", async () => {
    render(<TemplateGallery />);
    expect(screen.getAllByRole("img").length).toBe(9);
    await userEvent.click(screen.getByRole("button", { name: /show all/i }));
    expect(screen.getAllByRole("img").length).toBe(PAGE_TEMPLATES.length);
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("src", expect.stringContaining("flowdesk.png"));
  });

  it("filters by category", async () => {
    render(<TemplateGallery />);
    await userEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getAllByRole("img")).toHaveLength(PAGE_TEMPLATES.filter((t) => t.category === "Events").length);
  });

  it("one click sends that template's request with its id", async () => {
    render(<TemplateGallery />);
    await userEvent.click(screen.getByRole("button", { name: "Build the Flowdesk template" }));
    const t = PAGE_TEMPLATES.find((x) => x.id === "flowdesk")!;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: templateRequest(t), templateId: "flowdesk", network: "celo-sepolia" }));
  });
});
