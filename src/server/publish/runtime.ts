import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

/** Unpack a runtime pack (scripts/build-publish-runtime.mjs) under `baseDir`, once per pack. */
export async function unpackRuntime(pack: Buffer, baseDir: string): Promise<string> {
  const target = path.join(baseDir, `goodbuild-publish-runtime-${createHash("sha256").update(pack).digest("hex").slice(0, 16)}`);
  if (existsSync(target)) return target;
  const temp = await mkdtemp(`${target}-`);
  const files = JSON.parse(gunzipSync(pack).toString("utf8")) as Record<string, string>;
  for (const [file, content] of Object.entries(files)) {
    const out = path.join(temp, file);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(content, "base64"));
  }
  try {
    await rename(temp, target); // atomic, so another process never sees half a runtime
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    if (!existsSync(target)) throw error; // otherwise another process got there first
  }
  return target;
}

let unpacked: Promise<string> | undefined;

/** Where published apps' packages resolve from: the deployed pack, or the workspace in development. */
export function publishRuntimeDir(): Promise<string> {
  const packPath = path.join(process.cwd(), "publish-runtime.pack.gz");
  if (!existsSync(packPath)) return Promise.resolve(path.join(process.cwd(), "publish-runtime"));
  unpacked ??= readFile(packPath)
    .then((pack) => unpackRuntime(pack, tmpdir()))
    .catch((error: unknown) => {
      unpacked = undefined; // let the next publish try again
      throw error;
    });
  return unpacked;
}
