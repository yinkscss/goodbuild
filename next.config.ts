import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Loaded from node_modules at runtime, not bundled: PGlite resolves its WASM and data
  // files relative to its own package, which bundling breaks on restart.
  // jsdom (with DOMPurify, for SVG uploads) reads its own data files at runtime too.
  serverExternalPackages: ["@electric-sql/pglite", "solc", "jsdom", "dompurify"],
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
