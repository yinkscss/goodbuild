import { MAX_BRIEF_IMAGES, templateBrief, thumbnailsFor, type PageTemplate } from "../page-templates";
import { COMMUNITY } from "./community";
import { EVENTS } from "./events";
import { PORTFOLIO } from "./portfolio";
import { SAAS } from "./saas";
import { STORE } from "./store";
import { WEB3 } from "./web3";
import { EXTRA_PAGES } from "./pages";
import { MORE_COMMUNITY, MORE_EVENTS, MORE_PORTFOLIO, MORE_SAAS, MORE_STORE, MORE_WEB3 } from "./more";

/** Gallery order: SaaS first, then the rest, so the first row shows range. */
const BASE: PageTemplate[] = [...SAAS, ...MORE_SAAS, ...WEB3, ...MORE_WEB3, ...PORTFOLIO, ...MORE_PORTFOLIO, ...STORE, ...MORE_STORE, ...EVENTS, ...MORE_EVENTS, ...COMMUNITY, ...MORE_COMMUNITY];

/** Plain websites get extra routed pages; dApps stay one screen. */
export const PAGE_TEMPLATES: PageTemplate[] = BASE.map((t) => (EXTRA_PAGES[t.id] ? { ...t, pages: EXTRA_PAGES[t.id] } : t));

export function getPageTemplate(id: string | null | undefined): PageTemplate | undefined {
  return id ? PAGE_TEMPLATES.find((t) => t.id === id) : undefined;
}

/** The full build brief for a project that started from a gallery template, or "" for any other project. */
export function templateBriefFor(id: string | null | undefined): string {
  const t = getPageTemplate(id);
  return t ? templateBrief(t) : "";
}

/** Screenshot file names (in public/templates/) that go to the agent with a template project's first build. */
export function templateImageFiles(id: string | null | undefined): string[] {
  const t = getPageTemplate(id);
  return t ? thumbnailsFor(t).slice(0, MAX_BRIEF_IMAGES).map((u) => u.split("/").pop()!) : [];
}
