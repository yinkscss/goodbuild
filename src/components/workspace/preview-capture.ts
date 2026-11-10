/**
 * Preview-only screenshot helper (P17, the "visual check"). It is added to the files Sandpack
 * bundles, never to the project's files: a wrapper entry imports it, then the app's own entry.
 * Inside the iframe it renders the page with html-to-image when the workspace asks, and posts
 * back a PNG data URL. A cross-origin iframe can't be captured from outside, so this is the
 * only way to see what the user sees.
 */
export const CAPTURE_DEPENDENCY = { "html-to-image": "1.11.13" };
export const CAPTURE_ENTRY = "/__gb/entry.tsx";

const ENTRY = `import "./capture";
import "../src/main";
`;

const CAPTURE = `// GoodBuild preview helper: answers screenshot requests from the workspace. Not part of the app.
window.addEventListener("message", async (event: MessageEvent) => {
  const data = event.data as { gb?: string; id?: string; maxHeight?: number } | null;
  if (!data || data.gb !== "capture" || !event.source) return;
  const reply = (body: Record<string, unknown>) => (event.source as Window).postMessage({ gb: "capture-result", id: data.id, ...body }, "*");
  try {
    const { toPng } = await import("html-to-image");
    const node = document.documentElement;
    // The motion kit hides a section until it is scrolled to. A screenshot of the whole page must show
    // every section in its final state, or the ones further down would be reported as blank.
    const fxBefore = node.getAttribute("data-fx");
    node.setAttribute("data-fx", "off");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const restoreFx = () => (fxBefore === null ? node.removeAttribute("data-fx") : node.setAttribute("data-fx", fxBefore));
    const height = Math.min(Math.max(node.scrollHeight, window.innerHeight), data.maxHeight ?? 2400);
    // A broken image must not fail the capture: it's one of the defects the check looks for.
    const options = { width: window.innerWidth, height, pixelRatio: 1, cacheBust: true, backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff", onImageErrorHandler: () => undefined };
    let url: string;
    try {
      url = await toPng(node, options);
    } catch {
      // Web fonts from another origin can block embedding; the layout still matters most.
      url = await toPng(node, { ...options, skipFonts: true });
    }
    restoreFx();
    reply({ ok: true, url, width: window.innerWidth, height });
  } catch (error) {
    document.documentElement.removeAttribute("data-fx");
    reply({ ok: false, error: String((error as Error)?.message ?? error) });
  }
});
`;

export const CAPTURE_FILES: Record<string, string> = { "/__gb/entry.tsx": ENTRY, "/__gb/capture.ts": CAPTURE };

/** Ask the preview iframe for a screenshot. Resolves to a PNG data URL, or rejects after the timeout. */
export function capturePreview(iframe: HTMLIFrameElement, timeoutMs = 15_000): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The preview didn't answer the screenshot request."));
    }, timeoutMs);
    function onMessage(e: MessageEvent) {
      const d = e.data as { gb?: string; id?: string; ok?: boolean; url?: string; width?: number; height?: number; error?: string } | null;
      if (!d || d.gb !== "capture-result" || d.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (d.ok && d.url) resolve({ url: d.url, width: d.width ?? 0, height: d.height ?? 0 });
      else reject(new Error(d.error || "Screenshot failed."));
    }
    window.addEventListener("message", onMessage);
    iframe.contentWindow?.postMessage({ gb: "capture", id }, "*");
  });
}
