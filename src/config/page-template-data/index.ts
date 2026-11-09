import { templateBrief, type PageTemplate } from "../page-templates";
import { COMMUNITY } from "./community";
import { EVENTS } from "./events";
import { PORTFOLIO } from "./portfolio";
import { SAAS } from "./saas";
import { STORE } from "./store";
import { WEB3 } from "./web3";

/** Gallery order: SaaS first, then the rest, so the first row shows range. */
export const PAGE_TEMPLATES: PageTemplate[] = [...SAAS, ...WEB3, ...PORTFOLIO, ...STORE, ...EVENTS, ...COMMUNITY];

export function getPageTemplate(id: string | null | undefined): PageTemplate | undefined {
  return id ? PAGE_TEMPLATES.find((t) => t.id === id) : undefined;
}

/** The full build brief for a project that started from a gallery template, or "" for any other project. */
export function templateBriefFor(id: string | null | undefined): string {
  const t = getPageTemplate(id);
  return t ? templateBrief(t) : "";
}
