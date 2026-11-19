import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceState } from "@/server/workspace-state";
import { useWorkspace } from "./use-workspace";

const initial = {
  project: { id: "project", name: "Game", status: "draft", chainId: 11142220, currentVersion: 0, building: false, upgradeable: false },
  files: {}, messages: [], versions: [], estimate: { buildMicro: 10000, planMicro: 1000 }, assets: [], outdatedContracts: [], upgradableContracts: [], offerVerification: false, freePolicy: "verified", availableMicro: 0, jobs: [],
} satisfies WorkspaceState;
afterEach(() => vi.unstubAllGlobals());
it("retries the job without adding a synthetic user message, and requires an explicit paid choice", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/retry")) return Response.json(init?.body === JSON.stringify({ useCredits: true }) ? { jobId: "child" } : { error: "funding_unavailable", message: "Included repair used up" }, { status: init?.body === JSON.stringify({ useCredits: true }) ? 202 : 402 });
    return Response.json(initial);
  });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useWorkspace(initial));
  act(() => result.current.retry("failed-job"));
  await waitFor(() => expect(result.current.paidRetryJobId).toBe("failed-job"));
  expect(result.current.state.messages).toEqual([]);
  expect(result.current.needsCredits).toBe(false);
  act(() => result.current.retry("failed-job", true));
  await waitFor(() => expect(result.current.paidRetryJobId).toBeNull());
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(["/api/projects/project/turns/failed-job/retry", "/api/projects/project/turns/failed-job/retry"]);
  expect(posts.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ useCredits: false }, { useCredits: true }]);
});
