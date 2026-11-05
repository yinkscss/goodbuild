import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; tests import server code directly.
      "server-only": fileURLToPath(new URL("./test/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Every worker starts its own PGlite (wasm) and some run solc. With a worker per core those
    // first starts pass 30s and time out; four workers finish about as fast and don't.
    maxWorkers: 4,
    // PGlite's wasm start-up in beforeEach can take >10s while solc and the contract-test EVM
    // child processes run in parallel test files.
    hookTimeout: 30_000,
    // Cold dynamic imports (sharp, jsdom) are slow when the whole suite runs in parallel.
    testTimeout: 30_000,
  },
});
