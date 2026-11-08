import type { TemplateSource } from "../page-templates";

/** Permissive sources used for layout inspiration only. Licences checked 8 Nov 2026; see docs/TEMPLATES.md. */
const src = (source: string, licence: string) => (idea: string): TemplateSource => ({ idea, source, licence });

export const hyperui = src("HyperUI (markmead/hyperui)", "MIT");
export const tailblocks = src("Tailblocks (mertJF/tailblocks)", "MIT");
export const daisyui = src("daisyUI (saadeghi/daisyui)", "MIT");
export const shadcn = src("shadcn/ui blocks (shadcn-ui/ui)", "MIT");
export const magicui = src("Magic UI (magicuidesign/magicui)", "MIT");
export const flowbite = src("Flowbite (themesberg/flowbite)", "MIT");
export const motionPrimitives = src("Motion-Primitives (ibelick/motion-primitives)", "MIT");
/** Looked at only for ideas on layout and hierarchy. Nothing copied. */
export const pinterest = (idea: string): TemplateSource => ({ idea, source: "Pinterest boards (inspiration only)", licence: "Not reused" });
export const st21 = (idea: string): TemplateSource => ({ idea, source: "21st.dev community components (inspiration only)", licence: "Not reused (site terms restrict reuse)" });
