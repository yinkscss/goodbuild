import { createRequire } from "node:module";
import ts from "typescript";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { designTemplateFiles } from "./index";

const require = createRequire(import.meta.url);
function component(id: string, brand?: string): React.ComponentType {
  const files = designTemplateFiles(id);
  const content = JSON.parse(files["src/lib/templateContent.ts"].split("export const content = ")[1].replace(/;\n$/, ""));
  if (brand) content.brand = brand;
  const code = ts.transpileModule(files["src/App.tsx"], { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const compiledModule = { exports: {} as { default: React.ComponentType } };
  const load = (name: string) => name === "./lib/templateImage" ? { templateImage: { src: "data:image/webp;base64,UklGRg==", alt: "Original campaign image", width: 1200, height: 675 } } : name === "./lib/templateContent" ? { content } : name.endsWith(".css") ? {} : require(name);
  new Function("require", "module", "exports", code)(load, compiledModule, compiledModule.exports);
  return compiledModule.exports.default;
}
function show(id: string) { const App = component(id); return render(<App />); }
beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

describe("the actual runnable template interactions", () => {
  it("selects a Halo finish and adds that exact finish to the demo bag", async () => {
    show("classic-halo");
    await userEvent.click(screen.getByRole("button", { name: "Satin silver" }));
    expect(screen.getByRole("button", { name: "Satin silver" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /add to demo bag/i }));
    expect(screen.getByRole("dialog", { name: "Your demo bag" })).toBeInTheDocument();
    expect(screen.getByText("Orbit cuff / Satin silver")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear bag" }));
    expect(screen.getByText(/your bag is empty/i)).toBeInTheDocument();
  });

  it("plans the selected Elsewhere destination and duration without claiming a booking", async () => {
    show("classic-elsewhere");
    await userEvent.selectOptions(screen.getByLabelText("I want to discover"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Time to wander"), "7 days");
    await userEvent.click(screen.getByRole("button", { name: /explore the journey/i }));
    expect(screen.getByRole("heading", { name: "Desert light" })).toBeInTheDocument();
    expect(screen.getByText("Your sample itinerary")).toBeInTheDocument();
    expect(screen.getByText(/four unplanned days/)).toBeInTheDocument();
  });

  it("moves through the Frame shelf with a keyboard button and its timeline", async () => {
    show("classic-frame-archive");
    const next = screen.getByRole("button", { name: "Next film" }); next.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "After the Rain" })).toBeInTheDocument();
    const range = screen.getByRole("slider", { name: "Select film on the timeline" });
    fireEvent.change(range, { target: { value: "0" } });
    expect(screen.getByRole("heading", { name: "Blue Hours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Blue Hours" })).toHaveAttribute("aria-pressed", "true");
    const active = screen.getByRole("button", { name: "Select Blue Hours" }); active.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Select The Quiet Sea" })).toHaveFocus();
    expect(active).toHaveAttribute("tabindex", "-1");
  });

  it("filters Signal's projects and saves an honest local project note", async () => {
    const first = show("classic-signal-form");
    await userEvent.click(screen.getByRole("button", { name: "Digital" }));
    expect(screen.getByRole("heading", { name: "Soft Systems" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Other Matter" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Have a project?" }));
    await userEvent.type(screen.getByLabelText("Your email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("A little about your project"), "An expressive website for my studio");
    await userEvent.click(screen.getByRole("button", { name: "Save project note" }));
    expect(screen.getByRole("status")).toHaveTextContent("Project note saved on this device.");
    expect(JSON.parse(localStorage.getItem("signal-form-project-note")!)).toMatchObject({ email: "ada@example.com", brief: "An expressive website for my studio" });
    first.unmount();
    show("classic-signal-form");
    await userEvent.click(screen.getByRole("button", { name: "Have a project?" }));
    expect(screen.getByLabelText("Your email")).toHaveValue("ada@example.com");
    expect(screen.getByLabelText("A little about your project")).toHaveValue("An expressive website for my studio");
  });

  it("changes Nocturne's actual preset chart and handles unavailable audio", async () => {
    show("classic-nocturne");
    await userEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(screen.getByRole("img", { name: "Focus equalizer preset visualization" })).toHaveAttribute("data-preset", "Focus");
    await userEvent.click(screen.getByRole("button", { name: "Play test tone" }));
    expect(screen.getByRole("status")).toHaveTextContent("doesn't support the test tone");
  });

  it("uses editable content for the visible brand in all five starters", () => {
    for (const t of PAGE_TEMPLATES.filter((t) => t.designSeed)) {
      const App = component(t.id, "Ada Studio");
      const view = render(<App />);
      expect(view.container.querySelector("header a")?.textContent?.toLowerCase().replace(/[^a-z]/g, "")).toContain("adastudio");
      view.unmount();
    }
  });

  it("preserves readable content and disables motion under reduced motion", () => {
    for (const t of PAGE_TEMPLATES.filter((t) => t.designSeed)) {
      const files = designTemplateFiles(t.id);
      expect(files["src/showcase.css"]).toContain("prefers-reduced-motion:reduce");
      expect(files["src/showcase.css"]).toContain("animation:none!important");
      expect(files["src/App.tsx"]).toContain("Skip to");
      expect(files["src/App.tsx"]).not.toMatch(/dangerouslySetInnerHTML|\/templates\//);
    }
  });
});
