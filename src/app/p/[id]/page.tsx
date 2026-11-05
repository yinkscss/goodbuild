import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { Workspace } from "@/components/workspace/workspace";
import { WorkspaceSkeleton } from "@/components/workspace/workspace-skeleton";
import { currentSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { workspaceState } from "@/server/workspace-state";

export const metadata = { title: "Workspace · GoodBuild" };

/** Project workspace: chat + live preview (mockup c). */
export default function ProjectPage({ params }: PageProps<"/p/[id]">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <ProjectView params={params} />
    </Suspense>
  );
}

async function ProjectView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect("/");
  const state = await workspaceState(await getDb(), id, session.user.id);
  if (!state) notFound();
  return <Workspace initial={state} />;
}
