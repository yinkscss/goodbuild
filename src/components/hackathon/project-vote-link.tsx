"use client";

import * as React from "react";
import { useHackathonEvent } from "./use-event";

/** A direct link that opens the selected project's approval steps. */
export function ProjectVoteLink({
  entryId,
  compact = false,
}: {
  entryId: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const [link, setLink] = React.useState("");
  // A FUTMinna project's link opens the FUTMinna page (D160).
  const votePage = useHackathonEvent().config.votePage;

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the origin only exists in the browser
    setLink(`${window.location.origin}${votePage}?vote=${encodeURIComponent(entryId)}`);
  }, [entryId, votePage]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        className="text-sm font-medium text-violet underline-offset-4 hover:underline"
        onClick={() => void copy()}
        disabled={!link}
      >
        {copied ? "Vote link copied" : "Copy vote link"}
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-block bg-tint p-4">
      <p className="text-sm font-semibold">Share your project’s vote link</p>
      <p className="mt-1 text-sm text-grey-600">
        Friends will verify, support GoodBuildIt on FlowState, then approve your project here.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          aria-label="Project vote link"
          value={link || "Creating your link…"}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-block bg-surface px-3 py-2 text-sm outline-none focus-visible:shadow-focus"
        />
        <button
          type="button"
          className="rounded-full bg-violet px-4 py-2 text-sm font-medium text-white outline-none focus-visible:shadow-focus disabled:opacity-50"
          onClick={() => void copy()}
          disabled={!link}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
