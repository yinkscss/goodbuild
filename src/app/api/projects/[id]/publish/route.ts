import { NextResponse, connection } from "next/server";
import { z } from "zod";

import { publishedAppUrl, publishedAppsDomain, slugProblem } from "@/lib/published-host";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import type { Project } from "@/server/db/schema";
import { getOwnedProject } from "@/server/projects";
import { PublishError, publishApp, publishStatus, slugAvailable, unpublishApp, type PublishStatus } from "@/server/publish/service";

export const maxDuration = 60;

const body = z.object({ slug: z.string().max(64), confirmed: z.literal(true) });

const STATUS: Record<PublishError["code"], number> = {
  invalid_slug: 422,
  reserved_slug: 422,
  slug_taken: 409,
  busy: 409,
  disabled: 403,
  build_failed: 422,
  not_published: 409,
};

function respond(status: PublishStatus, request: Request) {
  const domain = publishedAppsDomain();
  return NextResponse.json(
    { ...status, url: publishedAppUrl(status.slug, request.headers.get("host"), domain), domain },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function withProject(ctx: RouteContext<"/api/projects/[id]/publish">, run: (project: Project) => Promise<Response>) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const owned = await getOwnedProject(await getDb(), id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return await run(owned.project);
  } catch (error) {
    if (error instanceof PublishError) {
      return NextResponse.json({ error: error.code, message: error.message, details: error.details }, { status: STATUS[error.code] });
    }
    return errorResponse(error);
  }
}

/** Publish status, or with ?slug= whether that address could be used. */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/publish">) {
  await connection();
  return withProject(ctx, async (project) => {
    const db = await getDb();
    const slug = new URL(request.url).searchParams.get("slug");
    if (slug === null) return respond(await publishStatus(db, project), request);
    const problem = slugProblem(slug);
    return NextResponse.json({ problem, available: !problem && (await slugAvailable(db, slug, project.id)) });
  });
}

/** Build the saved version and put it live on its address. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/publish">) {
  return withProject(ctx, async (project) => {
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    return respond(await publishApp(await getDb(), project, parsed.data.slug), request);
  });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/projects/[id]/publish">) {
  return withProject(ctx, async (project) => respond(await unpublishApp(await getDb(), project), request));
}
