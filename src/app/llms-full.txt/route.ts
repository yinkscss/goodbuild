import { buildLlmsFullTxt } from "@/content/blog/markdown";

export function GET() {
  return new Response(buildLlmsFullTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
