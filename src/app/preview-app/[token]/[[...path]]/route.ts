import { connection } from "next/server";

import { classifyHost, publishedAppsDomain } from "@/lib/published-host";
import { dbAssetStore } from "@/server/agent/asset-store";
import { getDb } from "@/server/db/client";
import { effectiveHost } from "@/server/edge";
import { getPreview } from "@/server/preview/cache";
import { previewHeaders, workspaceOrigin } from "@/server/preview/service";

const GONE = `<!doctype html><meta charset="utf-8"><title>Preview</title><p style="font:16px system-ui;text-align:center;margin-top:20vh;color:#555">This preview has expired. Open the project in GoodBuild to see it again.</p>`;

/**
 * Serves a project's own-build preview (D69). Reached only through the rewrite in proxy.ts; the Host
 * check repeats that rule here, so generated code can't be served from the main site even if the
 * proxy is bypassed.
 */
export async function GET(request: Request, ctx: RouteContext<"/preview-app/[token]/[[...path]]">) {
  await connection();
  const { token, path } = await ctx.params;
  const hostHeader = effectiveHost(request.headers);
  const host = classifyHost(hostHeader, publishedAppsDomain());
  if (host.kind !== "preview" || host.token !== token) return new Response("Not found", { status: 404 });
  const origin = workspaceOrigin(hostHeader);

  const build = getPreview(token);
  const gone = () => new Response(GONE, { status: 404, headers: previewHeaders("text/html; charset=utf-8", new TextEncoder().encode(GONE).length, origin) });
  if (!build) return gone();

  const filePath = path?.length ? path.join("/") : "index.html";
  const file = build.files.get(filePath);
  if (file) return new Response(new Uint8Array(file.bytes), { headers: previewHeaders(file.mime, file.bytes.length, origin) });

  // Uploaded images come straight from the asset store, so they aren't held in memory with every build.
  const assetName = /^assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(filePath)?.[1];
  if (assetName) {
    const store = dbAssetStore(await getDb());
    const info = (await store.list(build.projectId)).find((a) => a.name === assetName && a.kind !== "reference");
    const asset = info ? await store.get(build.projectId, info.id) : null;
    if (asset) return new Response(new Uint8Array(asset.bytes), { headers: previewHeaders(asset.mime, asset.bytes.length, origin) });
  }
  return gone();
}
