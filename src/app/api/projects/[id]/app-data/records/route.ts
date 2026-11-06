import { NextResponse, connection } from "next/server";

import { COLLECTION_NAME, RECORD_KEY } from "@/lib/app-data";
import { errorResponse, requireSession } from "@/server/auth/http";
import { deleteRecord, ownerApp, ownerCollections, ownerRecords, recordsCsv } from "@/server/app-data/store";
import { getDb } from "@/server/db/client";
import { getOwnedProject } from "@/server/projects";

type Ctx = RouteContext<"/api/projects/[id]/app-data/records">;
const NO_STORE = { "Cache-Control": "no-store, private" };

/** Only the project's owner, signed in to GoodBuild itself, so email wallets work too. App hosts can't reach this (proxy.ts). */
async function withApp(ctx: Ctx, run: (app: NonNullable<Awaited<ReturnType<typeof ownerApp>>>) => Promise<Response>) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const db = await getDb();
    const owned = await getOwnedProject(db, id, session.user.id);
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const app = await ownerApp(db, owned.project.id, session.user.wallet);
    if (!app) return NextResponse.json({ collections: [], records: [], nextCursor: null }, { headers: NO_STORE });
    return await run(app);
  } catch (error) {
    return errorResponse(error);
  }
}

function collectionOf(url: URL, allowed: string[]): string | null {
  const name = url.searchParams.get("collection");
  return name && COLLECTION_NAME.test(name) && allowed.includes(name) ? name : null;
}

/** What visitors sent, in collections the owner may read (D34). ?format=csv downloads every record in one collection. */
export async function GET(request: Request, ctx: Ctx) {
  await connection();
  return withApp(ctx, async (app) => {
    const url = new URL(request.url);
    const collections = ownerCollections(app);
    const collection = collectionOf(url, collections) ?? collections[0];
    if (!collection) return NextResponse.json({ collections, records: [], nextCursor: null }, { headers: NO_STORE });
    const db = await getDb();
    if (url.searchParams.get("format") === "csv") {
      const all = [];
      let cursor: number | undefined;
      for (let page = 0; page < 200; page++) {
        const next = await ownerRecords(db, app, collection, { limit: 100, cursor });
        all.push(...next.records);
        if (!next.nextCursor) break;
        cursor = Number(next.nextCursor);
      }
      return new Response(recordsCsv(all), {
        headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${collection}.csv"`, "X-Content-Type-Options": "nosniff" },
      });
    }
    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor && /^[0-9]{1,15}$/.test(rawCursor) ? Number(rawCursor) : undefined;
    const page = await ownerRecords(db, app, collection, { limit: 50, cursor });
    return NextResponse.json({ collections, collection, ...page }, { headers: NO_STORE });
  });
}

/** Delete one record a visitor sent. */
export async function DELETE(request: Request, ctx: Ctx) {
  return withApp(ctx, async (app) => {
    const url = new URL(request.url);
    const collection = url.searchParams.get("collection") ?? "";
    const owner = url.searchParams.get("owner") ?? "";
    const key = url.searchParams.get("key") ?? "";
    if (!COLLECTION_NAME.test(collection) || !RECORD_KEY.test(key) || !/^(0x[0-9a-f]{40}|(anon|email):[0-9a-f-]{36})$/.test(owner)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    // Always allowed here, whatever the app's rules say: deleting exposes nothing, and the owner must be able to clear spam.
    const gone = await deleteRecord(await getDb(), app, collection, owner, key);
    return gone ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_found" }, { status: 404 });
  });
}
