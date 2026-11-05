// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DATA_RULES_PATH, accessFor, parseDataRules } from "@/lib/app-data";
import { checkApp, dataIssues, namingProblem, pathProblem } from "@/server/agent/checks";
import { guideNames, loadGuides } from "@/server/agent/guides";
import { systemPrompt } from "@/server/agent/prompt";
import { starterFiles, withStarterHelpers } from "@/server/agent/template";
import { buildPublishedApp } from "@/server/publish/build";

const messages = (files: Record<string, string>) => dataIssues(files).map((i) => i.message).join("\n");

describe("the rules file", () => {
  it("defaults to private: no file, nothing declared, or a name the rules object inherits", () => {
    expect(parseDataRules(undefined)).toEqual({ rules: {}, issues: [] });
    expect(accessFor({}, "notes")).toBe("private");
    expect(accessFor({}, "constructor")).toBe("private");
    expect(accessFor({ notes: "something else" }, "notes")).toBe("private");
    expect(accessFor({ posts: "public-read" }, "posts")).toBe("public-read");
  });

  it("reports what's wrong with a bad file", () => {
    expect(parseDataRules("{").issues).toHaveLength(1);
    expect(parseDataRules("[]").issues).toHaveLength(1);
    expect(parseDataRules('{"collections":{"Bad Name":"private"}}').issues[0]).toContain("Bad Name");
    expect(parseDataRules('{"collections":{"notes":"everyone"}}').issues[0]).toContain("private");
    expect(parseDataRules('{"collections":{"notes":"private","posts":"public-read"}}')).toEqual({ rules: { notes: "private", posts: "public-read" }, issues: [] });
  });
});

describe("what the agent is held to", () => {
  it("the starter passes its own checks, and its helper files are allowed where they are", () => {
    expect(checkApp(starterFiles()).errors).toEqual([]);
    for (const p of ["src/lib/db.ts", "src/lib/useDb.ts", DATA_RULES_PATH]) {
      expect(p in starterFiles(), p).toBe(true);
      expect(pathProblem(p), p).toBeNull();
      expect(namingProblem(p), p).toBeNull();
    }
  });

  it("older projects get the helpers, without overwriting anything", () => {
    const old = withStarterHelpers({ "src/App.tsx": "x", [DATA_RULES_PATH]: '{"collections":{"a":"private"}}' });
    expect(old["src/lib/db.ts"]).toContain("__gb/data");
    expect(old[DATA_RULES_PATH]).toContain('"a"');
  });

  it("refuses an invented backend", () => {
    expect(messages({ "src/App.tsx": 'fetch("/api/notes", { method: "POST" })' })).toContain("no server");
    expect(messages({ "src/App.tsx": "await axios.post(`/api/save`, x)" })).toContain("no server");
    expect(messages({ "src/lib/save.ts": 'const url = "https://abc.supabase.co/rest/v1/x"' })).toContain("abc.supabase.co");
    expect(messages({ "src/App.tsx": 'send("https://my-app.firebaseio.com/x.json")' })).toContain("firebaseio.com");
    expect(messages({ "src/App.tsx": 'fetch("/__gb/data/v1/c/notes")' })).toContain("src/lib/db.ts");
  });

  it("leaves ordinary code alone", () => {
    expect(dataIssues({ "src/App.tsx": 'fetch("/assets/data.json"); fetch("https://forno.celo.org"); useCollection<Note>("notes"); collection("my_posts-2")' })).toEqual([]);
  });

  it("catches a bad collection name and a broken rules file while building", () => {
    expect(messages({ "src/App.tsx": 'useCollection<Note>("My Notes")' })).toContain("My Notes");
    expect(messages({ "src/App.tsx": 'collection("../x")' })).toContain("../x");
    expect(checkApp({ ...starterFiles(), [DATA_RULES_PATH]: '{"collections":{"a":"open"}}' }).ok).toBe(false);
  });

  it("the guide exists, says the safe thing, and the prompt no longer says there's no store", () => {
    expect(guideNames()).toContain("app-data");
    const guide = loadGuides("app-data").text;
    expect(guide).toContain("private (the default");
    expect(guide).toContain("Never emails");
    const prompt = systemPrompt("build");
    expect(prompt).toContain("src/lib/db.ts");
    expect(prompt).not.toContain("There is no backend or database");
    expect(loadGuides("forms-and-signup").text).not.toContain("no backend or database yet");
  });

  it("no helper or guide text uses an em dash", () => {
    for (const p of ["src/lib/db.ts", "src/lib/useDb.ts"]) expect(starterFiles()[p]).not.toContain("—");
    expect(loadGuides("app-data").text).not.toContain("—");
  });
});

describe("the published page", () => {
  const app = {
    ...starterFiles(),
    "src/App.tsx": 'import { useDbSession, useCollection } from "./lib/useDb";\nexport default function App() { const s = useDbSession(); const n = useCollection("notes", { enabled: !!s.wallet, wallet: s.wallet }); return <p>{n.records.length}</p>; }',
  };

  it("carries the public id, so the helper uses the real API", async () => {
    const files = await buildPublishedApp({ files: app, assets: [], title: "T", hasUndeployedContracts: false, dataClientId: "gbc_abc" });
    expect(new TextDecoder().decode(files.find((f) => f.path === "index.html")!.bytes)).toContain('<meta name="goodbuild-data" content="gbc_abc"');
    expect(new TextDecoder().decode(files.find((f) => f.path.endsWith(".js"))!.bytes)).toContain("/__gb/data/v1");
  }, 60_000);

  it("without one the helper stays in preview mode", async () => {
    const files = await buildPublishedApp({ files: app, assets: [], title: "T", hasUndeployedContracts: false });
    expect(new TextDecoder().decode(files.find((f) => f.path === "index.html")!.bytes)).not.toContain("goodbuild-data");
  }, 60_000);
});
