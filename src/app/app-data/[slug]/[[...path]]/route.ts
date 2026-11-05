import { connection } from "next/server";

import { handleAppData } from "@/server/app-data/handler";
import { getDb } from "@/server/db/client";

/**
 * The data API of a published app (docs/APP_DATA.md). Apps reach it at /__gb/data/* on their own
 * host; proxy.ts rewrites that here and refuses this path on the main site. handleAppData repeats
 * the Host check. No CORS headers are ever sent, including on OPTIONS.
 */
async function handle(request: Request, ctx: RouteContext<"/app-data/[slug]/[[...path]]">) {
  await connection();
  const { slug, path } = await ctx.params;
  return handleAppData(await getDb(), request, { slug, path: path ?? [] });
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH, handle as OPTIONS };
