"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export type Loaded<T> = { state: "loading" } | { state: "error" } | { state: "ready"; data: T };

/** Fetch one of the owner-scoped /api/account routes. A 401 sends the person back to the landing page. */
export function useAccountData<T>(url: string, reloadKey = 0): Loaded<T> & { reload: () => void } {
  const [result, setResult] = React.useState<{ url: string; value: Loaded<T> } | null>(null);
  const router = useRouter();
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let stale = false;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/");
          return;
        }
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as T;
        if (!stale) setResult({ url, value: { state: "ready", data } });
      })
      .catch(() => {
        if (!stale) setResult({ url, value: { state: "error" } });
      });
    return () => {
      stale = true;
    };
  }, [url, n, reloadKey, router]);
  const value: Loaded<T> = result && result.url === url ? result.value : { state: "loading" };
  return { ...value, reload: () => setN((v) => v + 1) };
}

export function PanelState({ loaded, empty, children }: { loaded: Loaded<unknown> & { reload: () => void }; empty?: React.ReactNode; children: React.ReactNode }) {
  if (loaded.state === "loading") return <div className="skeleton mt-6 h-[200px] rounded-card motion-reduce:animate-none" />;
  if (loaded.state === "error")
    return (
      <p role="alert" className="mt-6 rounded-card bg-surface p-6 text-sm text-danger shadow-card">
        We could not load this. <button className="font-medium underline" onClick={loaded.reload}>Try again</button>
      </p>
    );
  return empty ?? children;
}

export const CARD = "rounded-card bg-surface p-5 shadow-card";
export const CHIP = "rounded-full bg-tint px-2.5 py-0.5 text-[12px] font-medium text-violet";
