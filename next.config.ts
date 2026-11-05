import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Loaded from node_modules at runtime, not bundled: PGlite resolves its WASM and data
  // files relative to its own package, which bundling breaks on restart.
  // jsdom (with DOMPurify, for SVG uploads) reads its own data files at runtime too.
  // Publishing runs esbuild and Tailwind's compiler, which load native binaries and their own CSS.
  // For hosts that run a Node server: a self-contained folder (`NEXT_OUTPUT=standalone pnpm build`).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  serverExternalPackages: ["@electric-sql/pglite", "solc", "jsdom", "dompurify", "esbuild", "tailwindcss", "@tailwindcss/oxide"],
  // Read from disk when publishing, so file tracing can't see them on its own.
  outputFileTracingIncludes: {
    "/api/projects/[id]/publish": ["./publish-runtime.pack.gz"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
