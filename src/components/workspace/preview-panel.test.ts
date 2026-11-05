import { describe, expect, it } from "vitest";

import { CAPTURE_FILES } from "./preview-capture";
import { toAppFiles, toSandpack } from "./preview-panel";

const files = { "src/App.tsx": 'const a = "/assets/logo.png";', "contracts/Tip.sol": "contract Tip {}" };

describe("preview files", () => {
  it("gives the pop-out the app without the screenshot helper or contracts", () => {
    const app = toAppFiles(files, { "logo.png": "data:image/png;base64,AA" });
    expect(Object.keys(app)).toEqual(["/src/App.tsx"]);
    expect(app["/src/App.tsx"]).toContain("data:image/png;base64,AA");
    for (const helper of Object.keys(CAPTURE_FILES)) expect(app).not.toHaveProperty([helper]);
  });

  it("gives the workspace preview the screenshot helper as well", () => {
    expect(Object.keys(toSandpack(files))).toEqual(expect.arrayContaining(Object.keys(CAPTURE_FILES)));
  });
});
