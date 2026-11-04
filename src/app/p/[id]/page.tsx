import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { WalletButton } from "@/components/auth/wallet-button";
import { Logo, LogoMark } from "@/components/brand/logo";
import { chainName } from "@/lib/format";
import { currentSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

/**
 * Project workspace. M2 stub: shows the prompt that was sent and that it's queued.
 * M4 replaces the body with the chat + Sandpack split view (mockup c).
 */
export default function ProjectPage({ params }: PageProps<"/p/[id]">) {
  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <Suspense fallback={<WorkspaceSkeleton />}>
        <ProjectView params={params} />
      </Suspense>
    </div>
  );
}

async function ProjectView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect("/");
  const data = await getOwnedProject(await getDb(), id, session.user.id);
  if (!data) notFound();
  const { project, messages } = data;

  return (
    <>
      <header className="flex h-12 items-center justify-between px-2">
        <div className="flex min-w-0 items-center gap-3">
          <Logo href="/" />
          <span className="text-grey-400" aria-hidden>
            /
          </span>
          <h1 className="truncate font-semibold">{project.name}</h1>
          <span className="hidden rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-violet sm:inline">
            {chainName(project.chainId)}
          </span>
        </div>
        <WalletButton />
      </header>

      <main className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Chat" className="flex flex-col rounded-card bg-surface p-5 shadow-card">
          <div className="flex-1 space-y-4">
            {messages
              .filter((m) => m.role === "user")
              .map((m) => (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[80%] rounded-block rounded-br-md bg-tint px-4 py-3 text-sm whitespace-pre-wrap">
                    {m.content}
                  </p>
                </div>
              ))}
            <div className="rounded-block bg-[#FAFAFA] px-4 py-1">
              <div className="flex items-start gap-3 py-2">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-pink motion-safe:animate-pulse-dot" aria-hidden />
                <div>
                  <p className="text-sm font-medium">Queued for the builder</p>
                  <p className="text-xs text-grey-600">
                    Your prompt is saved to this project. The agent that writes the contract and app is the next milestone.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Preview" className="hidden flex-col rounded-card bg-surface p-3 shadow-card lg:flex">
          <div className="flex w-fit rounded-full bg-tint p-1 text-sm" aria-hidden>
            <span className="rounded-full bg-surface px-4 py-1.5 font-medium shadow-card">Preview</span>
            <span className="px-4 py-1.5 text-grey-600">Code</span>
            <span className="px-4 py-1.5 text-grey-600">Contract</span>
          </div>
          <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-3 rounded-block bg-canvas p-8 text-center">
            <LogoMark className="size-10 opacity-80" />
            <p className="max-w-xs text-sm text-grey-600">The live preview appears here once the first build runs.</p>
          </div>
        </section>
      </main>
    </>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading project">
      <div className="h-full min-h-[60vh] rounded-card bg-tint motion-safe:animate-pulse" />
      <div className="hidden h-full rounded-card bg-tint motion-safe:animate-pulse lg:block" />
    </div>
  );
}
