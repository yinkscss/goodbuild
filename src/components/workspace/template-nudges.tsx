"use client";

import * as React from "react";
import { ImageIcon, Loader2, Sparkles, X } from "lucide-react";

import { getPageTemplate } from "@/config/page-template-data";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { ACCEPT, imageFiles } from "./asset-bar";

/** The wording each button drops into the composer once its file is uploaded (editable, never sent for them). */
export const LOGO_DRAFT = "Use my logo in the top bar and as the favicon, and match the colours to it.";
export const HERO_DRAFT = "Use my image in the hero section.";

/** User messages after which the card stops showing, so it never nags a project that is well under way. */
const MAX_USER_MESSAGES = 2;

/**
 * "Make it yours" after a template's first build: two optional shortcuts for the logo and the hero
 * image. It sits in the chat flow and blocks nothing: the composer stays live, the person can send
 * any other prompt while a file uploads, and the card can be dismissed. A shortcut uploads the file
 * and drops a suggested sentence in the composer (only when it is empty) for them to edit and send.
 */
export function TemplateNudges({
  templateId,
  version,
  assets,
  userMessages,
  running,
  onUpload,
  onDraft,
}: {
  templateId: string | null | undefined;
  version: number;
  assets: AssetInfo[];
  userMessages: number;
  running: boolean;
  /** Resolves true when the file was saved. */
  onUpload: (file: File, kind: AssetKind) => Promise<boolean>;
  onDraft: (text: string) => void;
}) {
  const [dismissed, setDismissed] = React.useState(false);
  const [busy, setBusy] = React.useState<AssetKind | null>(null);
  const logoInput = React.useRef<HTMLInputElement>(null);
  const heroInput = React.useRef<HTMLInputElement>(null);

  const template = getPageTemplate(templateId);
  const hasLogo = assets.some((a) => a.kind === "logo");
  const hasImage = assets.some((a) => a.kind === "image");
  if (!template || dismissed || running || version < 1 || userMessages > MAX_USER_MESSAGES || (hasLogo && hasImage)) return null;

  async function pick(files: FileList | null, kind: AssetKind, draft: string) {
    const file = imageFiles(files)[0];
    if (!file) return;
    setBusy(kind);
    try {
      if (await onUpload(file, kind)) onDraft(draft);
    } finally {
      setBusy(null);
    }
  }

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-medium text-violet shadow-card outline-none transition-shadow hover:shadow-pop focus-visible:shadow-focus disabled:opacity-60";
  return (
    <div className="rounded-block bg-canvas p-4" role="group" aria-label="Make it yours">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-violet" aria-hidden />
          Make {template.label} yours
        </p>
        <button type="button" onClick={() => setDismissed(true)} className="grid size-6 place-items-center rounded-full text-grey-600 hover:bg-tint hover:text-violet" aria-label="Dismiss">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-xs text-grey-600">Optional. You can keep chatting, these just save a step.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!hasLogo && (
          <>
            <input ref={logoInput} type="file" accept={ACCEPT} aria-label="Choose your logo" className="hidden" onChange={(e) => { void pick(e.target.files, "logo", LOGO_DRAFT); e.target.value = ""; }} />
            <button type="button" className={buttonClass} disabled={busy === "logo"} onClick={() => logoInput.current?.click()}>
              {busy === "logo" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ImageIcon className="size-3.5" aria-hidden />}
              Add your logo
            </button>
          </>
        )}
        {!hasImage && (
          <>
            <input ref={heroInput} type="file" accept={ACCEPT} aria-label="Choose a hero image" className="hidden" onChange={(e) => { void pick(e.target.files, "image", HERO_DRAFT); e.target.value = ""; }} />
            <button type="button" className={buttonClass} disabled={busy === "image"} onClick={() => heroInput.current?.click()}>
              {busy === "image" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ImageIcon className="size-3.5" aria-hidden />}
              Replace the hero image
            </button>
          </>
        )}
      </div>
    </div>
  );
}
