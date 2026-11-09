"use client";

import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { previewFixPrompt, type PreviewError } from "@/lib/preview-errors";

/** A preview error with "Fix it", which sends it to the builder (AI_AGENT.md §7). Shared by both previews. */
export function PreviewErrorNotice({ error, onFix, fixDisabled, onDismiss }: { error: PreviewError; onFix: (prompt: string) => void; fixDisabled: boolean; onDismiss: () => void }) {
  const where = error.path ? ` in ${error.path.replace(/^\//, "")}${error.line ? `:${error.line}` : ""}` : "";
  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-block bg-canvas p-4" role="alert">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">The preview hit an error{where}</p>
          <p className="line-clamp-3 font-mono text-xs break-words text-grey-600">{error.message || error.title}</p>
        </div>
      </div>
      <Button
        variant="chipSelected"
        size="sm"
        disabled={fixDisabled}
        onClick={() => {
          onFix(previewFixPrompt(error, false));
          onDismiss();
        }}
      >
        <Wrench />
        Fix it
      </Button>
    </div>
  );
}
