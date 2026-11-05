import { connection } from "next/server";

import { classifyHost, publishedAppsDomain } from "@/lib/published-host";
import { getDb } from "@/server/db/client";
import { effectiveHost } from "@/server/edge";
import { publishedFile, publishedHeaders } from "@/server/publish/service";

const GONE = `<!doctype html><meta charset="utf-8"><title>Not available</title><p style="font:16px system-ui;text-align:center;margin-top:20vh">This app isn't available.</p>`;

/**
 * Serves a published app's files. Reached only through the rewrite in proxy.ts. The Host check repeats
 * that rule here, so generated code can't be served from the main site even if the proxy is bypassed.
 */
export async function GET(request: Request, ctx: RouteContext<"/published-app/[slug]/[[...path]]">) {
  await connection();
  const { slug, path } = await ctx.params;
  const host = classifyHost(effectiveHost(request.headers), publishedAppsDomain());
  if (host.kind !== "app" || host.slug !== slug) return new Response("Not found", { status: 404 });

  const filePath = path?.length ? path.join("/") : "index.html";
  const file = await publishedFile(await getDb(), slug, filePath);
  if (!file) {
    return new Response(GONE, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
  }
  return new Response(new Uint8Array(file.bytes), { headers: publishedHeaders(filePath, file.mime, file.bytes.length) });
}
