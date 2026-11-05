// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { unpackRuntime } from "./runtime";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "runtime-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const pack = gzipSync(JSON.stringify({ "node_modules/a/index.js": Buffer.from("export const a = 1;").toString("base64") }));

describe("unpackRuntime", () => {
  it("restores a real node_modules folder, and reuses it", async () => {
    const base = tempDir();
    const dir = await unpackRuntime(pack, base);
    expect(readFileSync(path.join(dir, "node_modules/a/index.js"), "utf8")).toBe("export const a = 1;");
    expect(await unpackRuntime(pack, base)).toBe(dir);
  });

  it("handles two publishes unpacking at once", async () => {
    const base = tempDir();
    const [a, b] = await Promise.all([unpackRuntime(pack, base), unpackRuntime(pack, base)]);
    expect(a).toBe(b);
    expect(existsSync(path.join(a, "node_modules/a/index.js"))).toBe(true);
  });
});
