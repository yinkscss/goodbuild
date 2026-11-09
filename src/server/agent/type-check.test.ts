// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { starterFiles } from "./template";
import { typeCheck, typeCheckMode } from "./type-check";

const page = (body: string, imports = "") => `${imports}\nexport default function App() {\n${body}\n}\n`;

describe("typeCheckMode", () => {
  it("is off unless the server sets it", () => {
    expect(typeCheckMode({} as NodeJS.ProcessEnv)).toBe("off");
    expect(typeCheckMode({ TYPE_CHECK: "warn" } as unknown as NodeJS.ProcessEnv)).toBe("warn");
    expect(typeCheckMode({ TYPE_CHECK: "enforce" } as unknown as NodeJS.ProcessEnv)).toBe("enforce");
    expect(typeCheckMode({ TYPE_CHECK: "1" } as unknown as NodeJS.ProcessEnv)).toBe("off");
  });
});

// Each run is a TypeScript program over viem's types: several seconds.
describe("typeCheck", { timeout: 120_000 }, () => {
  it("passes the starter with React 18 idioms, and stays quiet about GoodBuild's own files", async () => {
    const r = await typeCheck({
      ...starterFiles(),
      // Fine under React 18's types, errors under React 19's (which GoodBuild itself uses).
      "src/App.tsx": page("  const box = useRef<HTMLDivElement>();\n  const title: JSX.Element = <h1>Tip jar</h1>;\n  return <main ref={box as never}>{title}<Button variant=\"accent\" size=\"lg\">Send</Button></main>;", 'import { useRef } from "react";\nimport { Button } from "./components/ui/button";'),
      // A platform file with a mistake: not the builder's to fix, so not reported.
      "src/lib/goodbuild/extra.ts": "export const n: number = 'not a number';\n",
    });
    expect(r.ran).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.note).toBe("types are consistent");
  });

  it("finds what parsing can't: a missing export, a bad prop, a misspelt method, an unknown name, a number for a bigint", async () => {
    const r = await typeCheck({
      ...starterFiles(),
      "src/App.tsx": page(
        '  void publicClient.getBlokNumber();\n  return <main><Button size="huge">Hi</Button>{formatAmount(1, 18)}{total}</main>;',
        'import { Button } from "./components/ui/button";\nimport { formatAmount, nope } from "./lib/format";\nimport { publicClient } from "./lib/chain";\nvoid nope;',
      ),
    });
    expect(r.ran).toBe(true);
    const at = (line: number) => r.issues.filter((i) => i.line === line).map((i) => i.message).join(" | ");
    expect(r.issues.every((i) => i.file === "src/App.tsx" && i.source === "types")).toBe(true);
    expect(at(2)).toMatch(/no exported member 'nope'/);
    expect(at(6)).toMatch(/getBlokNumber/);
    expect(at(7)).toMatch(/"huge"/);
    expect(at(7)).toMatch(/'number' is not assignable to parameter of type 'bigint'/);
    expect(at(7)).toMatch(/Cannot find name 'total'/);
    expect(r.note).toBe("5 type errors");
  });

  it("is skipped, not failed, where the packages' types aren't installed", async () => {
    const r = await typeCheck(starterFiles(), { cwd: mkdtempSync(path.join(tmpdir(), "gb-no-types-")) });
    expect(r).toMatchObject({ ran: false, issues: [] });
    expect(r.note).toMatch(/aren't installed/);
  });

  it("is skipped when it takes too long", async () => {
    const r = await typeCheck(starterFiles(), { timeoutMs: 50 });
    expect(r).toMatchObject({ ran: false, issues: [] });
    expect(r.note).toMatch(/too long/);
  });
});
