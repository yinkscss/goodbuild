import { cn } from "@/lib/utils";
import { FirstWait } from "./first-wait";

/** Workspace placeholder. With a prompt it also shows what was sent, so the wait reads as progress. */
export function WorkspaceSkeleton({ prompt, className }: { prompt?: string; className?: string }) {
  return (
    <div className={cn("flex h-dvh flex-col gap-4 p-4", className)} aria-busy="true" aria-label="Loading project">
      <div className="h-12" />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[420px_1fr]">
        {prompt ? (
          <div className="min-h-0 overflow-hidden rounded-card bg-surface p-5">
            <p className="ml-auto w-fit max-w-[85%] rounded-block bg-tint px-4 py-3 text-sm whitespace-pre-wrap">{prompt}</p>
            <div className="mt-4">
              <FirstWait />
            </div>
          </div>
        ) : (
          <div className="skeleton rounded-card motion-reduce:animate-none" />
        )}
        <div className="skeleton hidden rounded-card motion-reduce:animate-none lg:block" />
      </div>
    </div>
  );
}
