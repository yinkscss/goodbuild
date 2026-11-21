import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Remembered } from "./chat-panel";

afterEach(() => vi.unstubAllGlobals());

describe("what GoodBuild remembers (D163)", () => {
  const open = async () => userEvent.click(screen.getByText(/What GoodBuild remembers about this app/));

  it("keeps an item and says so when the server didn't forget it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "busy", message: "Wait for the build to finish, then try again." }, { status: 409 })));
    const onChange = vi.fn(async () => ({}));
    render(<Remembered items={["No dark mode"]} projectId="p" onChange={onChange} />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(await screen.findByText("Wait for the build to finish, then try again.")).toBeInTheDocument();
    expect(screen.getByText("No dark mode")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides a forgotten item even when the refresh after it fails, and says to reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ remembered: [] })));
    render(<Remembered items={["No dark mode", "Tips at least 5 G$"]} projectId="p" onChange={async () => null} />);
    await open();
    await userEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]);
    expect(await screen.findByText(/Forgotten. The list couldn't refresh/)).toBeInTheDocument();
    expect(screen.queryByText("No dark mode")).toBeNull();
    expect(screen.getByText("Tips at least 5 G$")).toBeInTheDocument();
    expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
  });
});
