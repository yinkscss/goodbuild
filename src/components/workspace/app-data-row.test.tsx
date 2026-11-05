import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppDataRow } from "./app-data-row";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.restoreAllMocks());

describe("AppDataRow", () => {
  it("shows nothing until visitors have saved something", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ records: 0, wallets: 0, bytes: 0 }));
    const { container } = render(<AppDataRow projectId="p1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/app-data"));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows totals, and deletes only after confirming", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok({ records: 1200, wallets: 1, bytes: 9 }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = render(<AppDataRow projectId="p1" />);
    expect(await screen.findByText("1,200 records from 1 wallet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));
    expect(confirm).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(ok({ records: 0, wallets: 0, bytes: 0 }));
    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/projects/p1/app-data", { method: "DELETE" });
  });

  it("says so when deleting fails, and keeps the row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok({ records: 2, wallets: 2, bytes: 9 })).mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AppDataRow projectId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /delete all/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete it");
    expect(screen.getByText("2 records from 2 wallets")).toBeInTheDocument();
  });
});
