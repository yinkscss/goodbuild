// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { signInUser } from "@/server/auth/service";
import { createTestDb, type Db } from "@/server/db/client";
import { publications } from "@/server/db/publish-schema";
import { createProjectFromPrompt } from "@/server/projects";
import { latestPublishedApps, PUBLISHED_APPS_SHOWCASE_LIMIT } from "./showcase";

const WALLET = "0x7a3000000000000000000000000000000000e41c";

let db: Db;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  const user = await signInUser(db, { wallet: WALLET, walletKind: "external", attestation: { ageOk: true, notUsPerson: true } });
  userId = user.id;
});

async function publish(name: string, slug: string, publishedAt: Date, state: { unpublishedAt?: Date | null; disabledAt?: Date | null } = {}) {
  const project = await createProjectFromPrompt(db, userId, { prompt: name, network: "celo-sepolia" });
  await db.insert(publications).values({
    projectId: project.id,
    slug,
    versionNumber: 1,
    publishedAt,
    unpublishedAt: state.unpublishedAt ?? null,
    disabledAt: state.disabledAt ?? null,
  });
}

describe("latestPublishedApps", () => {
  it("returns only the six newest active apps, newest first", async () => {
    const start = Date.parse("2026-11-01T00:00:00Z");
    for (let i = 1; i <= 8; i += 1) {
      await publish(`Community app ${i}`, `community-app-${i}`, new Date(start + i * 1_000));
    }
    await publish("Unpublished app", "unpublished-app", new Date(start + 20_000), { unpublishedAt: new Date() });
    await publish("Taken down app", "taken-down-app", new Date(start + 21_000), { disabledAt: new Date() });

    const apps = await latestPublishedApps(db);

    expect(PUBLISHED_APPS_SHOWCASE_LIMIT).toBe(6);
    expect(apps.map(({ slug, name }) => [slug, name])).toEqual([
      ["community-app-8", "Community app 8"],
      ["community-app-7", "Community app 7"],
      ["community-app-6", "Community app 6"],
      ["community-app-5", "Community app 5"],
      ["community-app-4", "Community app 4"],
      ["community-app-3", "Community app 3"],
    ]);
  });

  it("returns an empty list when nothing is publicly live", async () => {
    await publish("Draft only", "draft-only", new Date(), { unpublishedAt: new Date() });
    await expect(latestPublishedApps(db)).resolves.toEqual([]);
  });
});
