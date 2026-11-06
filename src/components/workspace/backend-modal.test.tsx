import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { starterFiles } from "@/server/agent/template";
import { BackendModal, backendIdeas, backendState } from "./backend-modal";

describe("backendState", () => {
  it("is off for a fresh starter app, whose helpers aren't used yet", () => {
    expect(backendState(starterFiles()).on).toBe(false);
  });

  it("is on once app code imports the helper, and lists the declared collections", () => {
    const files = {
      ...starterFiles(),
      "src/App.tsx": `import { useCollection } from "./lib/useDb";\nexport default function App() { return null; }`,
      "src/lib/dataRules.json": JSON.stringify({ collections: { notes: "private", posts: "public-read" } }),
    };
    const state = backendState(files);
    expect(state.on).toBe(true);
    expect(state.collections.map((c) => [c.name, c.who, c.everyone])).toEqual([
      ["notes", "Only the person who saved it can read it", false],
      ["posts", "Anyone can read it", true],
    ]);
  });
});

describe("backendIdeas", () => {
  it("fits the kind of app, and always ends with letting the builder decide", () => {
    const tips = backendIdeas({ name: "Ikeja FC tip jar" });
    expect(tips[0].label).toBe("Thank-you wall");
    expect(tips.at(-1)?.label).toBe("Let the builder decide");
    expect(backendIdeas({ name: "Something else" }).map((i) => i.label)).toEqual(["Contact form", "Profiles", "Public posts", "Let the builder decide"]);
  });
});

describe("BackendModal", () => {
  it("sends a build with the chosen idea and closes, without typing", async () => {
    const onSend = vi.fn();
    const onOpenChange = vi.fn();
    render(<BackendModal open onOpenChange={onOpenChange} projectId="p" project={{ name: "Tip jar" }} files={starterFiles()} published={false} busy={false} onSend={onSend} />);
    expect(screen.getByRole("heading", { name: "Add a backend" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /thank-you wall/i }));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("public thank-you message"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("can't start a build while one is running", () => {
    render(<BackendModal open onOpenChange={() => {}} projectId="p" project={{ name: "Tip jar" }} files={starterFiles()} published={false} busy onSend={() => {}} />);
    expect(screen.getByRole("button", { name: /thank-you wall/i })).toBeDisabled();
  });
});
