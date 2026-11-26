"use client";

import * as React from "react";
import { ArrowUpRight, ImagePlus, Loader2, X } from "lucide-react";

import { useDeployAction } from "@/components/deploy/deploy-trigger";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { imageFiles } from "./asset-bar";
import type { PublishInfo } from "./use-publish";

/** What the follow-up chip sends with the picture they just added (D176). */
export const USE_LOGO_PROMPT = "Use my logo in the app's header and as its tab icon.";
export const USE_PHOTO_PROMPT = "Use the photo I just added in the app, where it fits best.";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const hiddenKey = (projectId: string) => `gb:logo-chip-hidden:${projectId}`;
const noSubscribe = () => () => undefined;
const CHOICES: Array<{ kind: AssetKind; label: string; help: string }> = [
  { kind: "logo", label: "My logo", help: "Shown in the header and as your app's tab icon" },
  { kind: "image", label: "A photo or picture", help: "Like a photo of you, shown in the app" },
];

/** When the chat offers its next steps (D176): the newest build works and nothing waits on the person. */
export function nextSteps(s: {
  running: boolean;
  live: boolean;
  currentVersion: number;
  lastStatus: string | undefined;
  openQuestions: boolean;
  draftOpen: boolean;
  crashed: boolean;
  publish: PublishInfo | null;
  miniPay: boolean;
  outdatedContracts: number;
}): { works: boolean; publish: boolean } {
  const works =
    !s.running && !s.live && s.currentVersion > 0 && (s.lastStatus === "ready" || s.lastStatus === "answered") && !s.openQuestions && !s.draftOpen && !s.crashed;
  // MiniPay apps get their own publish steps (MiniPayGuide); a contract with newer changes has its own card.
  const publish = works && Boolean(s.publish?.hasApp && !s.publish.live && !s.publish.disabled) && !s.miniPay && s.outdatedContracts === 0;
  return { works, publish };
}

/**
 * "Add your logo or photo" after a build works (D176). People asked for this in chat again and again without
 * knowing uploads exist. The chip opens the upload as a logo (the app's tab icon by default) or a photo, then
 * turns into "Use my logo/photo in the app", which sends it with a message. Nothing is sent, and no credits
 * spent, until they press that. "Not now" (or using it) hides it for this project.
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
  const [chosen, setChosen] = React.useState<AssetKind>("logo");
  const [dismissed, setHidden] = React.useState(false);
  const stored = React.useSyncExternalStore(
    noSubscribe,
    () => window.localStorage.getItem(hiddenKey(projectId)) !== null,
    () => false,
  );
  const hidden = dismissed || stored;
  const hide = () => {
    window.localStorage.setItem(hiddenKey(projectId), "1");
    setHidden(true);
  };

  // Waiting to be used: a logo not sent yet, or the photo added through this chip.
  const waiting = assets.find((a) => a.pending && (a.kind === "logo" || (chosen === "image" && a.kind === "image")));
  // A logo already went with a message: the builder has it.
  if (!waiting && (hidden || assets.some((a) => a.kind === "logo"))) return null;

  if (waiting) {
    const logo = waiting.kind === "logo";
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={logo ? "Your logo" : "Your photo"}>
        <Button
          type="button"
          variant="chip"
          size="chip"
          disabled={disabled}
          onClick={() => {
            hide();
            onUse(logo ? USE_LOGO_PROMPT : USE_PHOTO_PROMPT);
          }}
        >
          {logo ? "Use my logo in the app" : "Use my photo in the app"}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Button>
        {logo && <span className="text-xs text-grey-600">It also becomes your app&apos;s tab icon.</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add your logo or photo">
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        aria-label="Choose your logo or photo"
        className="hidden"
        onChange={(e) => {
          const [file] = imageFiles(e.target.files);
          e.target.value = "";
          if (file) void onUpload(file, chosen);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="chip" size="chip" disabled={disabled || uploading}>
            {uploading ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ImagePlus className="size-3.5" aria-hidden />}
            {uploading ? "Adding your picture…" : "Add your logo or photo"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>What is it?</DropdownMenuLabel>
          {CHOICES.map((c) => (
            <DropdownMenuItem
              key={c.kind}
              onSelect={() => {
                setChosen(c.kind);
                // Let the menu close before the file dialog opens.
                setTimeout(() => input.current?.click(), 0);
              }}
            >
              <span className="min-w-0">
                <span className="block font-medium">{c.label}</span>
                <span className="block text-xs text-grey-600">{c.help}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Not now"
        title="Not now"
        onClick={hide}
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
