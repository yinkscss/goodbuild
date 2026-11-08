import type { PageTemplate } from "../page-templates";
import { COMMUNITY } from "./community";
import { EVENTS } from "./events";
import { PORTFOLIO } from "./portfolio";
import { SAAS } from "./saas";
import { STORE } from "./store";
import { WEB3 } from "./web3";

/** Gallery order: SaaS first, then the rest, so the first row shows range. */
export const PAGE_TEMPLATES: PageTemplate[] = [...SAAS, ...WEB3, ...PORTFOLIO, ...STORE, ...EVENTS, ...COMMUNITY];
