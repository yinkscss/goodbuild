import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Workspace placeholder. With a prompt it also shows what was sent, so the wait reads as progress. */
export function WorkspaceSkeleton({ prompt, className }: { prompt?: string; className?: string }) {
  return (
    <div className={cn("flex h-dvh flex-col gap-4 p-4", className)} aria-busy="true" aria-label="Loading project">
      <div className="h-12" />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[420px_1fr]">
        {prompt ? (
          <div className="min-h-0 overflow-hidden rounded-card bg-surface p-5" role="status">
            <p className="ml-auto w-fit max-w-[85%] rounded-block bg-tint px-4 py-3 text-sm whitespace-pre-wrap">{prompt}</p>
            <p className="mt-4 flex items-center gap-2 text-sm text-grey-600">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Getting started…
            </p>
          </div>
        ) : (
          <div className="skeleton rounded-card motion-reduce:animate-none" />
        )}
        <div className="skeleton hidden rounded-card motion-reduce:animate-none lg:block" />
      </div>
    </div>
  );
}
