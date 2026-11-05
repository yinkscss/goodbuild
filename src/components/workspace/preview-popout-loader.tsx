"use client";

import dynamic from "next/dynamic";

// Sandpack is browser-only and heavy: load it on the client, as the workspace does.
export const PreviewPopoutLoader = dynamic(() => import("./preview-popout").then((m) => m.PreviewPopout), {
  ssr: false,
  loading: () => <div className="skeleton h-dvh motion-reduce:animate-none" aria-label="Loading preview" />,
});
