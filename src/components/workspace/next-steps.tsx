"use client";

import * as React from "react";
import { ArrowUpRight, ImagePlus, Loader2, X } from "lucide-react";

import { useDeployAction } from "@/components/deploy/deploy-trigger";
import { Button } from "@/components/ui/button";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { imageFiles } from "./asset-bar";
import type { PublishInfo } from "./use-publish";

/** What the "Use my logo" chip sends with the uploaded logo (D176). */
export const USE_LOGO_PROMPT = "Use my logo in the app's header and as its tab icon.";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const hiddenKey = (projectId: string) => `gb:logo-chip-hidden:${projectId}`;
const noSubscribe = () => () => undefined;

/**
 * "Add your logo or photo" after a build works (D176). People asked for this in chat again and again without
 * knowing uploads exist. The chip uploads the file as a logo (an uploaded logo is the app's tab icon by
 * default), then turns into "Use my logo in the app", which sends it with a message. Nothing is sent, and no
 * credits spent, until they press that. "Not now" hides it for this project.
 */
export function LogoChip({
  projectId,
  assets,
  onUpload,
  uploading,
  onUse,
  disabled,
}: {
  projectId: string;
  assets: Array<AssetInfo & { pending?: boolean }>;
  onUpload: (file: File, kind: AssetKind) => Promise<void>;
  uploading: boolean;
  onUse: (prompt: string) => void;
  disabled: boolean;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [dismissed, setHidden] = React.useState(false);
  const stored = React.useSyncExternalStore(
    noSubscribe,
    () => window.localStorage.getItem(hiddenKey(projectId)) !== null,
    () => false,
  );
  const hidden = dismissed || stored;

  const logos = assets.filter((a) => a.kind === "logo");
  const waiting = logos.some((a) => a.pending);
  // A logo already went with a message: the builder has it.
  if (logos.length && !waiting) return null;
  if (hidden && !waiting) return null;

  if (waiting) {
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your logo">
        <Button type="button" variant="chip" size="chip" disabled={disabled} onClick={() => onUse(USE_LOGO_PROMPT)}>
          Use my logo in the app
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Button>
        <span className="text-xs text-grey-600">It also becomes your app&apos;s tab icon.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add your logo">
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        aria-label="Choose your logo or photo"
        className="hidden"
        onChange={(e) => {
          const [file] = imageFiles(e.target.files);
          e.target.value = "";
          if (file) void onUpload(file, "logo");
        }}
      />
      <Button type="button" variant="chip" size="chip" disabled={disabled || uploading} onClick={() => input.current?.click()}>
        {uploading ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ImagePlus className="size-3.5" aria-hidden />}
        {uploading ? "Adding your picture…" : "Add your logo or photo"}
      </Button>
      <button
        type="button"
        aria-label="Not now"
        title="Not now"
        onClick={() => {
          window.localStorage.setItem(hiddenKey(projectId), "1");
          setHidden(true);
        }}
        className="grid size-7 place-items-center rounded-full text-grey-400 outline-none hover:bg-canvas hover:text-violet focus-visible:shadow-focus"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * One clear next step once the newest build works and the app isn't public yet (D176). People asked "how do I
 * publish" in chat more than anything else. Reuses the existing flows unchanged: with contracts that aren't on
 * Celo yet it opens the deploy (signed in their wallet), which offers Publish when it's done; otherwise the
 * publish window.
 */
export function PublishNextStep({ info, onPublish }: { info: PublishInfo; onPublish: () => void }) {
  const deploy = useDeployAction();
  const needsDeploy = info.undeployed.length > 0 && !deploy.blocked;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-block bg-canvas p-4" role="region" aria-label="Next step">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-[.18em] text-violet uppercase">Next step</p>
        <p className="mt-1 text-sm font-semibold">Publish so others can use it</p>
        <p className="mt-0.5 text-sm text-grey-600">
          {needsDeploy
            ? "First you confirm its contract from your wallet, so it works for real. Then your app gets its own link anyone can open."
            : "Your app gets its own link anyone can open. You can keep changing it and update it any time."}
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={needsDeploy ? deploy.open : onPublish}>
        Publish
      </Button>
    </div>
  );
}
