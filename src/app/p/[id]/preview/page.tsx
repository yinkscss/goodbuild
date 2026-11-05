import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { PreviewPopoutLoader } from "@/components/workspace/preview-popout-loader";
import { currentSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { workspaceState } from "@/server/workspace-state";

export const metadata = { title: "Preview · GoodBuild" };

/** The project's live preview on its own tab. Owner only, like the workspace. */
export default function ProjectPreviewPage({ params }: PageProps<"/p/[id]/preview">) {
  return (
    <Suspense fallback={<div className="skeleton h-dvh motion-reduce:animate-none" aria-busy="true" aria-label="Loading preview" />}>
      <PreviewView params={params} />
    </Suspense>
  );
}

async function PreviewView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect("/");
  const state = await workspaceState(await getDb(), id, session.user.id);
  if (!state) notFound();
  return <PreviewPopoutLoader initial={state} />;
}
