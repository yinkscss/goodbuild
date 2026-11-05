"use client";

import * as React from "react";

export interface PublishInfo {
  slug: string;
  url: string;
  domain: string;
  live: boolean;
  disabled: boolean;
  publishedVersion: number | null;
  currentVersion: number;
  undeployed: string[];
  hasApp: boolean;
}

export interface PublishFailure {
  message: string;
  details: string[];
}

async function failure(res: Response): Promise<PublishFailure> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; details?: string[] };
  return { message: body.message ?? "Something went wrong. Try again.", details: body.details ?? [] };
}

/**
 * Publish status for the workspace. Refetched on a new version and when the modal opens or closes,
 * because a deploy changes the contract status without changing the version.
 */
export function usePublish(projectId: string, version: number, modalOpen: boolean) {
  const [info, setInfo] = React.useState<PublishInfo | null>(null);
  const url = `/api/projects/${projectId}/publish`;

  React.useEffect(() => {
    let stale = false;
    void fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<PublishInfo>) : null))
      .catch(() => null)
      .then((next) => {
        if (next && !stale) setInfo(next);
      });
    return () => {
      stale = true;
    };
  }, [url, version, modalOpen]);

  const send = React.useCallback(
    async (init: RequestInit): Promise<PublishFailure | null> => {
      const res = await fetch(url, init).catch(() => null);
      if (!res) return { message: "GoodBuild couldn't be reached. Check your connection and try again.", details: [] };
      if (!res.ok) return failure(res);
      setInfo((await res.json()) as PublishInfo);
      return null;
    },
    [url],
  );

  const publish = React.useCallback(
    (slug: string) => send({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, confirmed: true }) }),
    [send],
  );
  const unpublish = React.useCallback(() => send({ method: "DELETE" }), [send]);

  const checkSlug = React.useCallback(
    async (slug: string): Promise<{ problem: string | null; available: boolean } | null> => {
      const res = await fetch(`${url}?slug=${encodeURIComponent(slug)}`).catch(() => null);
      return res?.ok ? ((await res.json()) as { problem: string | null; available: boolean }) : null;
    },
    [url],
  );

  return { projectId, info, publish, unpublish, checkSlug };
}

export type Publish = ReturnType<typeof usePublish>;
