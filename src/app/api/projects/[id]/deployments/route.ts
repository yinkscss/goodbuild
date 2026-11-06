import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { deployments } from "@/server/db/deploy-schema";
import { DeployError, publicDeployment, recordDeployment } from "@/server/deploy/service";
import { AFTER_DEPLOY, verifyDeployment } from "@/server/deploy/verify";
import { getOwnedProject } from "@/server/projects";

export const maxDuration = 60;

export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/deployments">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const rows = await db.select().from(deployments).where(eq(deployments.projectId, id)).orderBy(desc(deployments.createdAt));
    return NextResponse.json({ deployments: rows.map(publicDeployment) });
  } catch (error) {
    return errorResponse(error);
  }
}

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const body = z.object({
  runId: z.string().min(8).max(64),
  chainId: z.number().int(),
  contractName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  txHash: hex.length(66),
  sourceHash: hex.length(66),
  evmVersion: z.enum(["cancun", "paris"]),
  /** Behind a proxy (D33): what txHash is, and the transaction that deployed the new code. */
  proxied: z.object({ kind: z.enum(["proxy", "upgrade"]), implementationTxHash: hex.length(66) }).optional(),
});

/** Record a mined deployment. The server reads the chain; the browser only names the transaction. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/deployments">) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const db = await getDb();
    if (!(await getOwnedProject(db, id, session.user.id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      const row = await recordDeployment(db, {
        projectId: id,
        userId: session.user.id,
        wallet: session.user.wallet,
        ...parsed.data,
        txHash: parsed.data.txHash as `0x${string}`,
        sourceHash: parsed.data.sourceHash as `0x${string}`,
        proxied: parsed.data.proxied && { kind: parsed.data.proxied.kind, implementationTxHash: parsed.data.proxied.implementationTxHash as `0x${string}` },
      });
      // Verification runs after the response so the stepper isn't held up by Sourcify.
      const { after } = await import("next/server");
      after(() => verifyDeployment(db, row, fetch, AFTER_DEPLOY).then(() => undefined, () => undefined));
      return NextResponse.json({ deployment: publicDeployment(row) }, { status: 201 });
    } catch (error) {
      if (error instanceof DeployError) return NextResponse.json({ error: error.code, message: error.message, details: error.details }, { status: 422 });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
