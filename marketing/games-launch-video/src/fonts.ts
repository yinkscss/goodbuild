import { staticFile } from "remotion";

const FACES: [string, string, string, string][] = [
  ["Unbounded", "unbounded-latin-500-normal.woff2", "500", "normal"],
  ["Unbounded", "unbounded-latin-800-normal.woff2", "800", "normal"],
  ["Unbounded", "unbounded-latin-900-normal.woff2", "900", "normal"],
  ["Instrument Serif", "instrument-serif-latin-400-italic.woff2", "400", "italic"],
  ["JetBrains Mono", "jetbrains-mono-latin-500-normal.woff2", "500", "normal"],
  ["JetBrains Mono", "jetbrains-mono-latin-700-normal.woff2", "700", "normal"],
  ["Inter", "inter-latin-500-normal.woff2", "500", "normal"],
  ["Inter", "inter-latin-700-normal.woff2", "700", "normal"],
];

let promise: Promise<void> | null = null;
export const loadFonts = () => {
  if (!promise) {
    promise = Promise.all(
      FACES.map(async ([family, file, weight, style]) => {
        const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight, style });
        await face.load();
        document.fonts.add(face);
      }),
    ).then(() => undefined);
  }
  return promise;
};
