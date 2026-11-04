import { connection } from "next/server";

import { dbAssetStore } from "@/server/agent/asset-store";
import { verifyAssetToken } from "@/server/agent/asset-url";
import { getDb } from "@/server/db/client";

/**
 * A public, signed asset URL (src/server/agent/asset-url.ts), loaded by the preview iframe on
 * another origin in production. No session: the HMAC token is the capability. Bytes never
 * change for a given asset id, so it is cached as immutable.
 */
export async function GET(_request: Request, ctx: RouteContext<"/a/[token]">) {
  await connection();
  const { token } = await ctx.params;
  const ref = verifyAssetToken(token);
  if (!ref) return new Response("Not found", { status: 404 });
  const asset = await dbAssetStore(await getDb()).get(ref.projectId, ref.assetId);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(asset.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // The preview runs on another origin; images must be embeddable cross-origin.
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
