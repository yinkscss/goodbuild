"use client";

import * as React from "react";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";

import { GithubMark } from "@/components/brand/github-mark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Github } from "./use-github";

/** The GitHub logo in the top bar. A small dot says how syncing is going. */
export function GithubButton({ github, onOpen, className }: { github: Github; onOpen: () => void; className?: string }) {
  const status = github.link?.status;
  const label = !github.link ? "GitHub" : status === "synced" ? "Synced to GitHub" : status === "syncing" ? "Syncing to GitHub" : "GitHub needs attention";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={cn("relative grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-card transition-colors duration-200 ease-gb outline-none hover:bg-tint focus-visible:shadow-focus", className)}
    >
      <GithubMark />
      {status && (
        <span
          aria-hidden
          className={cn("absolute top-1 right-1 size-2.5 rounded-full ring-2 ring-surface", status === "synced" ? "bg-success" : status === "syncing" ? "bg-violet motion-safe:animate-pulse" : "bg-warning")}
        />
      )}
    </button>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function GithubModal({ projectId, github, open, onOpenChange }: { projectId: string; github: Github; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { account, link, busy, error } = github;
  const [confirmUnlink, setConfirmUnlink] = React.useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = React.useState(false);
  const connectHref = `/api/github/connect?returnTo=${encodeURIComponent(`/p/${projectId}?github=connected`)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <div className="flex items-center gap-3 pr-10">
          <span className="grid size-10 place-items-center rounded-full bg-ink text-white">
            <GithubMark />
          </span>
          <DialogTitle className="text-xl font-semibold">GitHub</DialogTitle>
        </div>

        {account && !account.configured ? (
          <DialogDescription className="mt-5 text-sm text-grey-600">GitHub isn&rsquo;t switched on for this GoodBuild yet. It needs a GitHub app set up by the owner.</DialogDescription>
        ) : !account?.connected ? (
          <>
            <DialogDescription className="mt-5 text-sm text-grey-600">
              Connect your GitHub account, then put any app you build in a public repository with one tap. GoodBuild keeps the <b>main</b> branch up to date as you keep building (or the repository&rsquo;s default branch, if GitHub won&rsquo;t let it make <b>main</b>).
            </DialogDescription>
            <p className="mt-3 text-[13px] text-grey-600">GoodBuild asks GitHub for permission to create public repositories and push to them. It only ever touches the repositories it creates for you.</p>
            <Button asChild className="mt-6 w-full">
              <a href={connectHref}>
                <GithubMark className="size-4" /> Connect GitHub
              </a>
            </Button>
          </>
        ) : !link ? (
          <>
            <DialogDescription className="mt-5 text-sm text-grey-600">
              Connected as <b>{account.login}</b>. This creates a <b>public</b> repository in your GitHub and pushes this app to its main branch. After that, every new version is pushed automatically.
            </DialogDescription>
            <Button className="mt-6 w-full" onClick={() => void github.create()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GithubMark className="size-4" />}
              {busy ? "Creating the repository…" : "Create public repository"}
            </Button>
          </>
        ) : (
          <div className="mt-5">
            <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-violet hover:underline">
              {link.fullName} <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <p className="mt-1 text-[13px] text-grey-600">Branch {link.branch} · public</p>

            <div
              role="status"
              className={cn("mt-4 flex items-start gap-2.5 rounded-2xl p-3.5 text-sm", link.status === "synced" ? "bg-success/10 text-ink" : link.status === "syncing" ? "bg-tint text-ink" : "bg-warning/10 text-ink")}
            >
              {link.status === "synced" ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : link.status === "syncing" ? (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-violet motion-reduce:animate-none" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              )}
              <span>
                {link.status === "synced" && `Up to date with version ${link.lastVersion}${link.syncedAt ? ` · ${ago(link.syncedAt)}` : ""}.`}
                {link.status === "syncing" && "Pushing to GitHub…"}
                {(link.status === "diverged" || link.status === "error") && (link.error ?? "Something went wrong.")}
              </span>
            </div>

            {link.status === "diverged" && (
              <div className="mt-3 rounded-2xl bg-canvas p-3.5 text-sm text-grey-600">
                Replacing adds one new commit on top of what&rsquo;s on GitHub, so your commits stay in the history. Files you added there are removed from the latest version.
                {confirmOverwrite ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => void github.overwrite().then(() => setConfirmOverwrite(false))} disabled={busy}>
                      Yes, replace {link.branch} with GoodBuild&rsquo;s version
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setConfirmOverwrite(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => setConfirmOverwrite(true)} disabled={busy}>
                    Replace {link.branch} with GoodBuild&rsquo;s version
                  </Button>
                )}
              </div>
            )}
            {link.status === "error" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {account?.connected ? (
                  <Button size="sm" variant="secondary" onClick={() => void github.sync()} disabled={busy}>
                    Try again
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <a href={connectHref}>Connect GitHub again</a>
                  </Button>
                )}
              </div>
            )}

            <label className="mt-5 flex cursor-pointer items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">Keep {link.branch} up to date automatically</span>
                <span className="block text-[13px] text-grey-600">Pushes each new version as it&rsquo;s saved.</span>
              </span>
              <input type="checkbox" checked={link.autoSync} onChange={(e) => void github.setAuto(e.target.checked)} disabled={busy} className="size-5 accent-violet" />
            </label>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {link.status === "synced" && (
                <Button size="sm" variant="secondary" onClick={() => void github.sync()} disabled={busy}>
                  Sync now
                </Button>
              )}
              {confirmUnlink ? (
                <>
                  <Button size="sm" variant="quiet" onClick={() => void github.unlink().then(() => setConfirmUnlink(false))} disabled={busy}>
                    Stop syncing (the repository stays on GitHub)
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(true)} disabled={busy}>
                  Stop syncing
                </Button>
              )}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
