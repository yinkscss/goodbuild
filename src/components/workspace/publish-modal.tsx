"use client";

import * as React from "react";
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Wrench } from "lucide-react";

import { useDeployAction } from "@/components/deploy/deploy-trigger";
import { formatClock, useElapsed } from "@/components/ui/wait";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AppDataRow } from "./app-data-row";
import { backendState } from "./backend-modal";
import type { Publish, PublishFailure } from "./use-publish";

type SlugCheck = "idle" | "checking" | "free" | "taken" | "reserved" | "invalid";

const SLUG_COPY: Partial<Record<SlugCheck, string>> = {
  taken: "That address is taken. Try another.",
  reserved: "That address is reserved. Try another.",
  invalid: "Use 3 to 40 lowercase letters, numbers or single hyphens.",
};

/** The header button: Publish, then Update once the project has moved past what's live. */
export function PublishButton({ publish, onOpen, disabled, className }: { publish: Publish; onOpen: () => void; disabled: boolean; className?: string }) {
  const { info } = publish;
  const outdated = info?.live && info.publishedVersion !== info.currentVersion;
  return (
    <Button variant="secondary" className={className} disabled={disabled || !info?.hasApp} title={!info?.hasApp ? "Build your app first" : disabled ? "Wait for the build to finish" : "Put your app on its own address"} onClick={onOpen}>
      {info?.live && !outdated && <span className="size-2 rounded-full bg-pink" aria-hidden />}
      {outdated ? "Update" : info?.live ? "Published" : "Publish"}
    </Button>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/**
 * The Publish button while it works (wait-state pick E1): a progress pill with the stage inside.
 * Publishing is one request that reports no stages, so the words and the fill follow elapsed time,
 * and the fill slows as it nears the end instead of promising a finish it cannot know.
 */
function PublishProgress() {
  const seconds = useElapsed(true);
  const fill = Math.round(92 * (1 - Math.exp(-seconds / 25)));
  const stage = seconds < 6 ? "Packing your files" : seconds < 40 ? "Building your app" : "Putting it online";
  return (
    <div className="grid justify-items-end gap-1.5" role="status">
      <span className="relative inline-flex min-w-[220px] items-center gap-2 overflow-hidden rounded-full bg-violet px-6 py-3 text-sm font-medium text-white">
        <span className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-700 ease-gb" style={{ width: `${fill}%` }} aria-hidden />
        <Loader2 className="relative size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        <span className="relative">{stage}</span>
        <span className="relative ml-auto font-mono text-[11px] text-white/70">{formatClock(seconds)}</span>
      </span>
      {seconds >= 30 && <span className="text-xs text-grey-600">Bigger apps take about a minute. Keep this window open.</span>}
    </div>
  );
}

/** Publish modal (DESIGN_SYSTEM §4): address, what ships, a required confirmation, then the live link. */
export function PublishModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publish: Publish;
  projectBusy: boolean;
  onFix: (prompt: string) => void;
  /** The app's files, to say before publishing what its saved data shows (D34). */
  files?: Record<string, string>;
}) {
  const [working, setWorking] = React.useState<"publish" | "unpublish" | null>(null);
  return (
    <Dialog open={props.open} onOpenChange={(next) => !working && props.onOpenChange(next)}>
      <DialogContent className="sm:w-[560px]" onInteractOutside={(e) => working && e.preventDefault()}>
        {/* Dialog content unmounts on close, so each opening starts from the saved address. */}
        <PublishBody {...props} working={working} setWorking={setWorking} />
      </DialogContent>
    </Dialog>
  );
}

function PublishBody({
  onOpenChange,
  publish,
  projectBusy,
  onFix,
  working,
  setWorking,
  files,
}: {
  onOpenChange: (open: boolean) => void;
  publish: Publish;
  projectBusy: boolean;
  onFix: (prompt: string) => void;
  files?: Record<string, string>;
  working: "publish" | "unpublish" | null;
  setWorking: (w: "publish" | "unpublish" | null) => void;
}) {
  const { info, checkSlug } = publish;
  const deploy = useDeployAction();
  const savedSlug = info?.slug ?? "";
  const [typed, setTyped] = React.useState<string | null>(null);
  const slug = typed ?? savedSlug;
  const [result, setResult] = React.useState<{ slug: string; check: SlugCheck } | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [failed, setFailed] = React.useState<PublishFailure | null>(null);
  const [justPublished, setJustPublished] = React.useState(false);

  const check: SlugCheck = !slug || slug === savedSlug ? "idle" : result?.slug === slug ? result.check : "checking";

  // Check the address once typing pauses.
  React.useEffect(() => {
    if (!slug || slug === savedSlug) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      void checkSlug(slug).then((r) => {
        if (stale) return;
        const next: SlugCheck = !r ? "idle" : r.problem === "invalid" || r.problem === "reserved" ? r.problem : r.available ? "free" : "taken";
        setResult({ slug, check: next });
      });
    }, 300);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [slug, savedSlug, checkSlug]);

  async function run(kind: "publish" | "unpublish") {
    setWorking(kind);
    setFailed(null);
    const error = kind === "publish" ? await publish.publish(slug) : await publish.unpublish();
    setWorking(null);
    setFailed(error);
    if (!error && kind === "publish") setJustPublished(true);
    if (!error && kind === "unpublish") setConfirmed(false);
  }

  const showSuccess = justPublished && info?.live;
  const slugOk = Boolean(slug) && check !== "taken" && check !== "reserved" && check !== "invalid" && check !== "checking";
  const canPublish = slugOk && confirmed && !working && !projectBusy && !info?.disabled;
  const undeployed = info?.undeployed ?? [];

  return (
    <>
        <p className="eyebrow pr-10">{showSuccess ? "Done" : "Share your app"}</p>
        <DialogTitle className="display mt-2 pr-10 text-[28px] font-extrabold">{showSuccess ? "Your app is live" : info?.live ? "Update your app" : "Publish your app"}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-grey-600">
          {showSuccess ? "Anyone with the link can open it and connect their own wallet." : "GoodBuild builds your latest saved version and puts it on its own public address."}
        </DialogDescription>

        {showSuccess ? (
          <div className="mt-5">
            <div className="relative mx-auto grid size-14 place-items-center">
              <span className="gb-burst absolute inset-0 rounded-full bg-pink/40" aria-hidden />
              <span className="relative grid size-14 place-items-center rounded-full bg-success text-white">
                <Check className="size-7" />
              </span>
            </div>
            <p className="mt-4 rounded-block bg-canvas p-3.5 text-center font-mono text-sm break-all">{info.url}</p>
            {undeployed.length > 0 && <p className="mt-3 text-sm text-warning">Your app shows a demo notice until you deploy its contracts and publish again.</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <CopyLink url={info.url} />
              <Button variant="primary" asChild>
                <a href={info.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open app
                </a>
              </Button>
            </div>
          </div>
        ) : !info ? (
          <div className="mt-6 space-y-3" aria-label="Loading">
            <div className="skeleton h-12 rounded-block motion-reduce:animate-none" />
            <div className="skeleton h-12 rounded-block motion-reduce:animate-none" />
          </div>
        ) : info.disabled ? (
          <p className="mt-5 flex items-start gap-2 rounded-block bg-canvas p-4 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
            This app was taken down and can&apos;t be published.
          </p>
        ) : (
          <>
            <label className="mt-5 block text-sm font-medium" htmlFor="publish-slug">
              Address
            </label>
            <div className={cn("mt-2 flex items-center rounded-block bg-canvas px-4 py-3 font-mono text-sm focus-within:shadow-focus", SLUG_COPY[check] && "ring-1 ring-danger/40")}>
              <input
                id="publish-slug"
                value={slug}
                onChange={(e) => setTyped(e.target.value.toLowerCase().trim())}
                disabled={Boolean(working)}
                spellCheck={false}
                autoComplete="off"
                maxLength={40}
                aria-invalid={Boolean(SLUG_COPY[check])}
                aria-describedby="publish-slug-note"
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
              <span className="shrink-0 text-grey-600">.{info.domain}</span>
            </div>
            <p id="publish-slug-note" className={cn("mt-1.5 min-h-4 text-xs", SLUG_COPY[check] ? "text-danger" : "text-grey-600")} aria-live="polite">
              {SLUG_COPY[check] ?? (check === "checking" ? "Checking…" : check === "free" ? "This address is free." : "")}
            </p>

            <dl className="mt-3 divide-y divide-ink/5 rounded-block bg-canvas px-4 text-sm">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-grey-600">Version</dt>
                <dd className="font-medium">
                  v{info.currentVersion}
                  {info.live && info.publishedVersion !== info.currentVersion && <span className="ml-1.5 font-normal text-grey-600">(v{info.publishedVersion} is live)</span>}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-grey-600">Review</dt>
                <dd>
                  <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">Unaudited</span>
                </dd>
              </div>
              <AppDataRow projectId={publish.projectId} />
            </dl>

            {undeployed.length > 0 && (
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-block bg-warning/10 p-4 text-sm" role="status">
                <p className="flex min-w-0 flex-1 items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    {undeployed.join(", ")} {undeployed.length > 1 ? "aren't" : "isn't"} deployed for this version. Your app will go live as a demo with a notice, and on-chain actions won&apos;t work.
                  </span>
                </p>
                {!deploy.blocked && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      deploy.open();
                    }}
                  >
                    Deploy first
                  </Button>
                )}
              </div>
            )}

            {files && <SavedDataSummary files={files} />}

            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={Boolean(working)} className="mt-0.5 size-4 shrink-0 accent-violet" />
              <span className="text-grey-600">I understand this code hasn&apos;t been audited and is public. The app isn&apos;t for sports betting, and isn&apos;t aimed at anyone under 18 or at US persons.</span>
            </label>

            {failed && (
              <div className="mt-4 rounded-block bg-canvas p-4" role="alert">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="flex min-w-0 flex-1 items-start gap-2 text-sm font-medium">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
                    {failed.message}
                  </p>
                  {failed.details.length > 0 && (
                    <Button
                      variant="chipSelected"
                      size="sm"
                      disabled={projectBusy}
                      onClick={() => {
                        onOpenChange(false);
                        onFix(`Publishing the app failed with these build errors. Fix them.\n\n${failed.details.join("\n")}`);
                      }}
                    >
                      <Wrench /> Try fix
                    </Button>
                  )}
                </div>
                {failed.details.length > 0 && (
                  <details className="mt-2 text-xs text-grey-600">
                    <summary className="cursor-pointer">Show details</summary>
                    <pre className="mt-2 font-mono break-words whitespace-pre-wrap">{failed.details.join("\n")}</pre>
                  </details>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              {info.live ? (
                <Button
                  variant="ghost"
                  disabled={Boolean(working)}
                  onClick={() => {
                    if (window.confirm("Unpublish this app? Its link stops working until you publish again.")) void run("unpublish");
                  }}
                >
                  {working === "unpublish" && <Loader2 className="animate-spin motion-reduce:animate-none" />} Unpublish
                </Button>
              ) : (
                <p className="text-xs text-grey-600">{projectBusy ? "Wait for the build to finish." : "You can update or unpublish it at any time."}</p>
              )}
              {working === "publish" ? (
                <PublishProgress />
              ) : (
                <Button variant="primary" disabled={!canPublish} onClick={() => void run("publish")}>
                  {info.live ? "Publish update" : "Publish"}
                </Button>
              )}
            </div>
          </>
        )}
    </>
  );
}

/** The AI writes the rules, so the creator sees in plain words what visitors' data will show before it goes live. */
function SavedDataSummary({ files }: { files: Record<string, string> }) {
  const { on, collections } = backendState(files);
  if (!on || collections.length === 0) return null;
  const open = collections.filter((c) => c.everyone || c.publicFields.length);
  return (
    <div className="mt-3 rounded-block bg-canvas p-4 text-sm" role="note">
      <p className="font-medium">What your app&apos;s saved data shows</p>
      <ul className="mt-1.5 space-y-1 text-grey-600">
        {open.length === 0 && <li>Nothing visitors save is public.</li>}
        {open.map((c) => (
          <li key={c.name}>
            Anyone can read: <span className="font-medium text-ink">{c.name}</span>
            {c.everyone ? " (everything)" : ` (${c.publicFields.join(", ")})`}
          </li>
        ))}
        {collections.some((c) => c.noSignIn) && <li>Some forms take entries from visitors who don&apos;t sign in. Only the readers listed in the Backend window see them.</li>}
      </ul>
    </div>
  );
}
