import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { NETWORKS, type NetworkId } from "@/config/networks";
import { getPageTemplate } from "@/config/page-template-data";
import { getTemplate } from "@/config/templates";
import type { Db } from "@/server/db/client";
import { messages, projects, type Message, type Project } from "@/server/db/schema";

const TRAILING_FILLER = new Set([
  "that", "which", "where", "who", "for", "with", "to", "of", "and", "or", "the", "a", "an", "in", "on", "by",
  "our", "my", "your", "their", "his", "her", "its", "this", "these", "those",
]);

/**
 * A short project name from the template or the prompt: the first clause (up to
 * punctuation), at most 5 words, without a leading article or trailing filler words.
 */
export function nameFromPrompt(prompt: string, templateId?: string | null): string {
  const template = templateId ? getTemplate(templateId) : undefined;
  // A gallery template is only a starting design: the project is named for what the person asked for.
  if (template && !getPageTemplate(templateId)) return template.label;
  const clause = prompt.split(/[.,:;!?\n(]/)[0] ?? "";
  const words = clause
    .replace(/[^\p{L}\p{N}$\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length && /^(an?|the)$/i.test(words[0])) words.shift();
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1].toLowerCase())) words.pop();
  const name = words.join(" ");
  if (!name) return "Untitled build";
  const cased = name.charAt(0).toUpperCase() + name.slice(1);
  return cased.length > 40 ? `${cased.slice(0, 39)}…` : cased;
}

/** Mainnet only when the mainnet switch lets this wallet (D50); otherwise a new project targets Celo Sepolia. */
export function chainIdFor(network: NetworkId, mainnetAllowed = false): number {
  return network === "celo" && mainnetAllowed ? NETWORKS.celo.chainId : NETWORKS["celo-sepolia"].chainId;
}

/**
 * Create a project with the user's first prompt queued. The agent (M4) picks up
 * queued messages; until then the workspace shows the prompt as waiting.
 */
export async function createProjectFromPrompt(
  db: Db,
  ownerId: string,
  input: { prompt: string; templateId?: string | null; network: NetworkId; mainnetAllowed?: boolean },
): Promise<Project> {
  const [project] = await db
    .insert(projects)
    .values({
      ownerId,
      name: nameFromPrompt(input.prompt, input.templateId),
      templateId: input.templateId ?? null,
      chainId: chainIdFor(input.network, input.mainnetAllowed),
      status: "draft",
    })
    .returning();
  await db.insert(messages).values({ projectId: project.id, role: "user", content: input.prompt, status: "queued" });
  return project;
}

/** A project and its chat, only if the user owns it. */
export async function getOwnedProject(
  db: Db,
  projectId: string,
  ownerId: string,
): Promise<{ project: Project; messages: Message[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
    .limit(1);
  if (!project) return null;
  const chat = await db.select().from(messages).where(eq(messages.projectId, project.id)).orderBy(asc(messages.createdAt));
  return { project, messages: chat };
}

export async function listProjects(db: Db, ownerId: string, limit = 500): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.ownerId, ownerId)).orderBy(desc(projects.updatedAt)).limit(limit);
}
