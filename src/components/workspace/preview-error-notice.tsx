"use client";

import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { previewFixPrompt, type PreviewError } from "@/lib/preview-errors";

/** "GoalList.tsx" → "goal list". */
function partName(path?: string): string | null {
  const base = path?.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "");
  if (!base || /^(App|main|index)$/.test(base)) return null;
  return base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").toLowerCase();
}

/**
 * A preview crash, in plain words, with "Fix it for me", which sends it to the builder (AI_AGENT.md §7, D163).
 * The file, line and message are behind "Technical details". Shared by both previews.
 */
export function PreviewErrorNotice({ error, onFix, fixDisabled, onDismiss }: { error: PreviewError; onFix: (prompt: string) => void; fixDisabled: boolean; onDismiss: () => void }) {
  const part = partName(error.path);
  const where = error.path ? `${error.path.replace(/^\//, "")}${error.line ? `:${error.line}` : ""} · ` : "";
  return (
    <div className="mt-3 rounded-block bg-canvas p-4" role="alert">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">{part ? `The ${part} crashed when it opened` : "Part of your app crashed when it opened"}</p>
            <p className="text-sm text-grey-600">That happens while an app is being built. GoodBuild can usually fix it by itself.</p>
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
          Fix it for me
        </Button>
      </div>
      <details className="mt-3 pl-5 text-xs text-grey-600">
        <summary className="w-fit cursor-pointer rounded-full outline-none select-none focus-visible:shadow-focus">Technical details (for support)</summary>
        <p className="mt-2 font-mono text-[12px] break-words">
          {where}
          {error.message || error.title}
        </p>
      </details>
    </div>
  );
}
