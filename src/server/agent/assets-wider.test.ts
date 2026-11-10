// @vitest-environment node
import { describe, expect, it } from "vitest";

import { AssetRejected, ingestAsset, type AssetStore } from "./asset-store";
import { MAX_BYTES_BY_CATEGORY, MAX_PROJECT_ASSET_BYTES, assetManifest, assetRefs, assetsModule, kindFor, sniffType, type AssetInfo } from "./assets";
import { checkApp } from "./checks";
import { starterFiles } from "./template";
import { buildPublishedApp } from "@/server/publish/build";
import { Workspace } from "./workspace";

const bytes = (head: number[], size = 64) => Uint8Array.from({ length: size }, (_, i) => head[i] ?? 0);
const text = (s: string, size = 64) => bytes([...s].map((c) => c.charCodeAt(0)), size);
const MP3 = bytes([0x49, 0x44, 0x33, 3, 0]);
const OGG = text("OggS");
const WAV = text("RIFF\0\0\0\0WAVE");
const WOFF2 = text("wOF2");
const WOFF = text("wOFF");
const TTF = bytes([0, 1, 0, 0]);
const OTF = text("OTTO");
const GLB = bytes([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);

/** A store that keeps what it is given, so ingestAsset can be tested without a database. */
function memoryStore(): AssetStore & { rows: AssetInfo[] } {
  const rows: AssetInfo[] = [];
  return {
    rows,
    list: async () => rows,
    get: async () => null,
    put: async (_p, a) => {
      const { bytes: _b, ...info } = a;
      void _b;
      const row = { ...info, id: `id${rows.length}` };
      rows.push(row);
      return row;
    },
    update: async () => {},
    remove: async () => true,
    unattached: async () => [],
    markAttached: async () => {},
  };
}
const ingest = (store: AssetStore, fileName: string, data: Uint8Array, kind: "logo" | "image" | "reference" = "image") =>
  ingestAsset({ store, db: null as never, model: null, projectId: "p", userId: "u", fileName, kind, bytes: data });

describe("uploads beyond images (D78)", () => {
  it("knows sounds, fonts and 3D models from their first bytes, not their names", () => {
    expect(sniffType(MP3)).toBe("audio/mpeg");
    expect(sniffType(bytes([0xff, 0xfb, 0x90]))).toBe("audio/mpeg");
    expect(sniffType(OGG)).toBe("audio/ogg");
    expect(sniffType(WAV)).toBe("audio/wav");
    expect(sniffType(WOFF2)).toBe("font/woff2");
    expect(sniffType(WOFF)).toBe("font/woff");
    expect(sniffType(TTF)).toBe("font/ttf");
    expect(sniffType(OTF)).toBe("font/otf");
    expect(sniffType(GLB)).toBe("model/gltf-binary");
    // A glTF text file, a version 1 binary, a zip and a script are none of these.
    expect(sniffType(text('{"asset":{"version":"2.0"}}'))).toBeNull();
    expect(sniffType(bytes([0x67, 0x6c, 0x54, 0x46, 1, 0, 0, 0]))).toBeNull();
    expect(sniffType(text("PK\u0003\u0004"))).toBeNull();
    expect(sniffType(text("<script>alert(1)</script>"))).toBeNull();
  });

  it("stores them as they are, with a kind that follows from the file", async () => {
    const store = memoryStore();
    const song = await ingest(store, "Victory Jingle.MP3", MP3, "logo");
    expect(song).toMatchObject({ name: "victory-jingle.mp3", kind: "audio", mime: "audio/mpeg", width: null, palette: [], description: "" });
    expect(await ingest(store, "Brand Font.woff2", WOFF2)).toMatchObject({ name: "brand-font.woff2", kind: "font" });
    expect(await ingest(store, "robot.glb", GLB)).toMatchObject({ name: "robot.glb", kind: "model" });
    expect(kindFor("image/png", "reference")).toBe("reference");
    expect(kindFor("audio/ogg", "logo")).toBe("audio");
  });

  it("limits each kind of file by its own size, and a project's files by their total", async () => {
    const store = memoryStore();
    const big = (head: Uint8Array, size: number) => Uint8Array.from({ length: size }, (_, i) => head[i] ?? 0);
    await expect(ingest(store, "a.woff2", big(WOFF2, MAX_BYTES_BY_CATEGORY.font + 1))).rejects.toThrow(/up to 2 MB/);
    await expect(ingest(store, "a.glb", big(GLB, MAX_BYTES_BY_CATEGORY.model + 1))).rejects.toThrow(/up to 15 MB/);
    expect((await ingest(store, "ok.glb", big(GLB, 1_000_000))).size).toBe(1_000_000);
    const full = memoryStore();
    for (let i = 0; i < 2; i++) await ingest(full, `m${i}.glb`, big(GLB, 12_000_000));
    await expect(ingest(full, "m3.glb", big(GLB, 2_000_000))).rejects.toThrow(new RegExp(`${MAX_PROJECT_ASSET_BYTES / 1_000_000} MB`));
    await expect(ingest(store, "x.zip", text("PK\u0003\u0004"))).rejects.toBeInstanceOf(AssetRejected);
    await expect(ingest(store, "x.mp3", new Uint8Array())).rejects.toThrow(/empty/);
  });

  it("tells the builder how to use each, and exports them in the assets module", () => {
    const list: AssetInfo[] = [
      { id: "1", name: "jingle.mp3", kind: "audio", mime: "audio/mpeg", size: 120_000, width: null, height: null, palette: [], description: "" },
      { id: "2", name: "brand.woff2", kind: "font", mime: "font/woff2", size: 40_000, width: null, height: null, palette: [], description: "" },
      { id: "3", name: "robot.glb", kind: "model", mime: "model/gltf-binary", size: 2_000_000, width: null, height: null, palette: [], description: "" },
    ];
    const manifest = assetManifest(list);
    expect(manifest).toContain("new Audio(assets.<key>.src)");
    expect(manifest).toContain("@font-face");
    expect(manifest).toContain("GLTFLoader");
    expect(manifest).toContain("/assets/robot.glb (model, glb, 2.0 MB) → assets.robot");
    expect(assetsModule(list)).toContain('robot: { src: "/assets/robot.glb"');
  });

  it("checks that code only points at files that were uploaded", () => {
    expect(assetRefs('new Audio("/assets/jingle.mp3"); url("/assets/Brand.woff2"); load("/assets/robot.glb"); "/assets/logo.png"')).toEqual(["jingle.mp3", "Brand.woff2", "robot.glb", "logo.png"]);
    const files = { ...starterFiles(), "src/App.tsx": 'export default function App() { return <audio src="/assets/jingle.mp3" />; }\n' };
    expect(checkApp(files, { assets: [] }).errors.map((e) => e.message).join()).toMatch(/jingle\.mp3/);
    expect(checkApp(files, { assets: ["jingle.mp3"] }).errors).toEqual([]);
  });

  it("explains that an uploaded sound or model isn't a code file when the builder tries to read it", () => {
    const ws = new Workspace(starterFiles());
    const r = ws.execute("read_file", JSON.stringify({ path: "public/assets/robot.glb" }), "build");
    expect(r.result).toMatch(/uploaded file, not a code file/);
  });

  it("ships them with the right content type when publishing", async () => {
    const out = await buildPublishedApp({
      files: { ...starterFiles(), "src/App.tsx": 'export default function App() { return <audio src="/assets/jingle.mp3" />; }\n' },
      assets: [{ name: "jingle.mp3", mime: "audio/mpeg", bytes: MP3 }, { name: "robot.glb", mime: "model/gltf-binary", bytes: GLB }],
      title: "Sounds",
      hasUndeployedContracts: false,
    });
    expect(out.find((f) => f.path === "assets/jingle.mp3")?.mime).toBe("audio/mpeg");
    expect(out.find((f) => f.path === "assets/robot.glb")?.mime).toBe("model/gltf-binary");
  });
});
