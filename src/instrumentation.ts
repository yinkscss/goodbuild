/**
 * Next.js calls register() once per server process. Start the background turn worker there
 * (P18): Node runtime only, never while `next build` collects pages, and not at all when a
 * standalone `pnpm worker` runs instead (GOODBUILD_INLINE_WORKER=0). The worker is a
 * globalThis singleton, so hot reload can't start a second one.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.BACKEND_ORIGIN) (await import("./server/credits/onchain-sync")).startCreditsSync();
  if (process.env.GOODBUILD_INLINE_WORKER === "0" || process.env.BACKEND_ORIGIN) return; // the edge runs no turns (D26)
  const { inlineWorker } = await import("./server/jobs");
  inlineWorker();
}
