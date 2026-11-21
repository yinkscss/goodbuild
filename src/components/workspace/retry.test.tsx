import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceState } from "@/server/workspace-state";
import { useWorkspace } from "./use-workspace";

const initial = {
  project: { id: "project", name: "Game", status: "draft", chainId: 11142220, currentVersion: 0, building: false, upgradeable: false },
  files: {}, messages: [], versions: [], estimate: { buildMicro: 10000, planMicro: 1000 }, assets: [], outdatedContracts: [], upgradableContracts: [], offerVerification: false, freePolicy: "verified", availableMicro: 0, jobs: [],
} satisfies WorkspaceState;
afterEach(() => vi.unstubAllGlobals());
it("retries the job without adding a synthetic user message, and runs on credits when the repair allowance doesn't cover it (D163)", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/retry")) {
      const paid = JSON.parse(String(init?.body)).useCredits === true;
      return Response.json(paid ? { jobId: "child" } : { error: "funding_unavailable", message: "Included repair used up" }, { status: paid ? 202 : 402 });
    }
    return Response.json(initial);
  });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useWorkspace(initial));
  act(() => result.current.retry("failed-job", false, "The preview shows this error. Fix it:\nTypeError"));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
  await waitFor(() => expect(result.current.error).toBeNull());
  expect(result.current.state.messages).toEqual([]);
  expect(result.current.needsCredits).toBe(false);
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(["/api/projects/project/turns/failed-job/retry", "/api/projects/project/turns/failed-job/retry"]);
  expect(posts.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { useCredits: false, note: "The preview shows this error. Fix it:\nTypeError" },
    { useCredits: true, note: "The preview shows this error. Fix it:\nTypeError" },
  ]);
});

it("shows the out-of-credits card when even the credits can't cover the fix", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/retry")) {
      const paid = JSON.parse(String(init?.body)).useCredits === true;
      return Response.json(paid ? { error: "out_of_credits", message: "Top up" } : { error: "funding_unavailable" }, { status: 402 });
    }
    return Response.json(initial);
  });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useWorkspace(initial));
  act(() => result.current.retry("failed-job"));
  await waitFor(() => expect(result.current.needsCredits).toBe(true));
  expect(result.current.error).toBeNull();
});
