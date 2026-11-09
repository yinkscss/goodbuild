// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { PAGE_TEMPLATES, getPageTemplate } from "@/config/page-template-data";
import { templateRequest } from "@/config/page-templates";
import { createTestDb, type Db } from "@/server/db/client";
import { signInUser } from "@/server/auth/service";
import { createProjectFromPrompt } from "@/server/projects";

import { scriptedModel } from "./fake-model";
import { shouldPlanFirst } from "./plan-first";
import { runTurn } from "./runner";

let db: Db;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: "0xabc", walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
});

async function fromTemplate(id: string) {
  const t = getPageTemplate(id)!;
  return createProjectFromPrompt(db, userId, { prompt: templateRequest(t), templateId: id, network: "celo-sepolia" });
}

describe("projects started from a gallery template", () => {
  it("keeps the template id but names the project after what the person asked for", async () => {
    const t = getPageTemplate("folio")!;
    const p = await createProjectFromPrompt(db, userId, { prompt: "A portfolio for me, Ada, a brand designer in Lagos", templateId: t.id, network: "celo-sepolia" });
    expect(p.templateId).toBe("folio");
    expect(p.name).toBe("Portfolio for me");
    expect(p.name).not.toBe(t.label);
  });

  it("builds straight away: the template is the plan, so no questions are asked", async () => {
    const p = await fromTemplate("mintdrop");
    expect(await shouldPlanFirst(db, { projectId: p.id, userId })).toBe(false);
  });

  it("still plans first for an ordinary prompt and for the older dApp starters", async () => {
    const plain = await createProjectFromPrompt(db, userId, { prompt: "A tip jar for my club", network: "celo-sepolia" });
    expect(await shouldPlanFirst(db, { projectId: plain.id, userId })).toBe(true);
    const starter = await createProjectFromPrompt(db, userId, { prompt: "A tip jar for my club", templateId: "tip-jar", network: "celo-sepolia" });
    expect(await shouldPlanFirst(db, { projectId: starter.id, userId })).toBe(true);
  });

  it("gives the agent the full brief on the first build, with a short request in the chat", async () => {
    const p = await fromTemplate("flowdesk");
    const { client, requests } = scriptedModel([
      { tools: [{ name: "create_file", args: { path: "src/App.tsx", content: "export default function App() { return <main>Flowdesk</main>; }\n" } }] },
      { text: "Built it." },
    ]);
    const record = await runTurn({ db, model: client }, { projectId: p.id, userId, mode: "build", prompt: templateRequest(getPageTemplate("flowdesk")!) }, () => undefined);
    expect(record.status).toBe("ready");
    const context = JSON.stringify(requests[0].messages);
    expect(context).toContain("Plan the week. Ship on Friday.");
    expect(context).toContain("#4F46E5");
    expect(context).toContain("started from the \\\"Flowdesk\\\" template");
  });

  it("attaches screenshots of the template to the first build, and none for other projects", async () => {
    const images = (messages: unknown) => JSON.stringify(messages).match(/"type":"image"/g)?.length ?? 0;
    const p = await fromTemplate("flowdesk");
    const first = scriptedModel([{ text: "Built it." }]);
    await runTurn({ db, model: first.client }, { projectId: p.id, userId, mode: "build", prompt: templateRequest(getPageTemplate("flowdesk")!) }, () => undefined);
    expect(images(first.requests[0].messages)).toBe(3);
    expect(JSON.stringify(first.requests[0].messages)).toContain("Screenshots of the template are attached");

    const plain = await createProjectFromPrompt(db, userId, { prompt: "A tip jar", network: "celo-sepolia" });
    const none = scriptedModel([{ text: "Built it." }]);
    await runTurn({ db, model: none.client }, { projectId: plain.id, userId, mode: "build", prompt: "A tip jar" }, () => undefined);
    expect(images(none.requests[0].messages)).toBe(0);
  });

  it("every template has a brief the agent can use", () => {
    for (const t of PAGE_TEMPLATES) expect(getPageTemplate(t.id)).toBe(t);
  });
});
