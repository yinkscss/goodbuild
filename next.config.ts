import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Loaded from node_modules at runtime, not bundled: PGlite resolves its WASM and data
  // files relative to its own package, which bundling breaks on restart.
  // jsdom (with DOMPurify, for SVG uploads) reads its own data files at runtime too.
  // Publishing runs esbuild and Tailwind's compiler, which load native binaries and their own CSS.
  serverExternalPackages: ["@electric-sql/pglite", "solc", "jsdom", "dompurify", "esbuild", "tailwindcss", "@tailwindcss/oxide"],
  // Read from disk when publishing, so file tracing can't see them on its own.
  outputFileTracingIncludes: {
    "/api/projects/[id]/publish": ["./publish-runtime/**/*", "./node_modules/tailwindcss/*.css"],
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
