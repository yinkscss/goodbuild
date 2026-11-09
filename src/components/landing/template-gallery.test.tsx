import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { thumbnailsFor } from "@/config/page-templates";
import { TemplateGallery } from "./template-gallery";
import { SLIDE_MS, TemplateBanner, TemplateSlides } from "./template-slides";

afterEach(() => vi.useRealTimers());

describe("TemplateGallery", () => {
  it("shows a card per template for the first nine and can show all", async () => {
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

  it("a click attaches the template to the prompt box and sends nothing", async () => {
    const heard: string[] = [];
    const listener = (e: Event) => heard.push((e as CustomEvent<string>).detail);
    window.addEventListener("gb:fill-prompt", listener);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<TemplateGallery />);
    await userEvent.click(screen.getByRole("button", { name: "Use the Flowdesk template" }));
    window.removeEventListener("gb:fill-prompt", listener);
    expect(heard).toEqual(["flowdesk"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists the pages of a multi-page template", () => {
    render(<TemplateGallery />);
    expect(screen.getByText(/3 pages: Home, Customers, Security/)).toBeInTheDocument();
  });
});

describe("TemplateSlides", () => {
  const flowdesk = PAGE_TEMPLATES.find((t) => t.id === "flowdesk")!;

  it("rests on the first screenshot and loads the others only when played", () => {
    const { container } = render(<TemplateSlides template={flowdesk} playing={false} sizes="100px" />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("[data-slide]")).toHaveAttribute("data-slide", "0");
  });

  it("cycles through every screenshot while playing and goes back to the first when it stops", () => {
    vi.useFakeTimers();
    const total = thumbnailsFor(flowdesk).length;
    expect(total).toBeGreaterThan(2);
    const { container, rerender } = render(<TemplateSlides template={flowdesk} playing sizes="100px" />);
    const slide = () => container.querySelector("[data-slide]")!.getAttribute("data-slide");
    act(() => void vi.advanceTimersByTime(300));
    expect(slide()).toBe("1");
    act(() => void vi.advanceTimersByTime(SLIDE_MS));
    expect(slide()).toBe("2");
    expect(container.querySelectorAll("img")).toHaveLength(total);
    rerender(<TemplateSlides template={flowdesk} playing={false} sizes="100px" />);
    expect(slide()).toBe("0");
  });

  it("never cycles for people who prefer reduced motion", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container } = render(<TemplateSlides template={flowdesk} playing sizes="100px" />);
    act(() => void vi.advanceTimersByTime(5000));
    expect(container.querySelector("[data-slide]")).toHaveAttribute("data-slide", "0");
    vi.unstubAllGlobals();
  });
});

describe("TemplateBanner", () => {
  it("shows the template at the top of a project's chat, and nothing for other projects", () => {
    const { rerender } = render(<TemplateBanner templateId="mintdrop" />);
    expect(screen.getByText("Mint Drop")).toBeInTheDocument();
    rerender(<TemplateBanner templateId="tip-jar" />);
    expect(screen.queryByText("Template")).not.toBeInTheDocument();
    rerender(<TemplateBanner templateId={null} />);
    expect(screen.queryByText("Template")).not.toBeInTheDocument();
  });
});
