import type { Guide } from "./guides";

/** Original GoodBuild harness guidance, not third-party prompt text. */
export const CLASSIC_GUIDES: Guide[] = [
  {
    name: "art-directed-web",
    when: "a code-seeded template, immersive product campaign, spatial archive, cinematic travel page or expressive studio website",
    body: `Art-directed websites with working starter code.
- The selected template already has a complete App.tsx, showcase.css, editable templateContent.ts and a bundled templateImage module. Read the composition and content before editing. Preserve its visual silhouette, image layering, typography scale and working interaction while applying the user's copy, brand and requested changes.
- Each design has its own grammar: Halo is a cobalt product stage; Elsewhere is a full-bleed journey planner; Frame Archive is a perspective film shelf; Signal Form is an overlapping typographic studio; Nocturne is a dark audio product stage. Do not normalize them into identical split heroes, feature cards or warm cream layouts.
- The existing CSS supplies mobile layouts, visible keyboard focus, honest sample states and reduced-motion fallbacks. Keep those when adding behavior. Native buttons, labelled inputs and dialogs stay functional with keyboard and touch. Never hide core content until an animation runs.
- Use the supplied image via templateImage, not a gallery screenshot or remote URL. The composition is live React, not an image of a website. Keep a deliberate focal point and do not pile unrelated effects over it.
- Preserve real controls: demo bag, itinerary selector, archive selection, project filter/dialog or sound presets as relevant. Sample products and trips are concepts, not confirmed stock or bookings. A local draft is labelled local; it is not a delivered enquiry.
- For real transactions or shared persistent data requested later, load the matching existing wallet/app-data guide and connect the real workflow. Keep the original visual identity through that change.`,
  },
  {
    name: "classic-web-design",
    when: "a Classic template, timeless business website, editorial journal, hospitality, artisan shop or traditional portfolio",
    body: `Classic website composition.
- Build from the selected template brief and the user's changes. Choose serif display headings with a quiet sans-serif body, warm paper or stone surfaces, one restrained accent and generous whitespace. Use the starter's design tokens rather than scattering hex values.
- Prefer fine dividers, aligned catalogue rows and squared or subtly rounded photograph frames. Keep the headline legible, the navigation short and the primary action explicit. Avoid glossy dashboard styling, glowing orbs, pill-shaped everything and decorative bento grids unless requested.
- Stack split heroes on narrow screens, use fluid heading sizes and keep buttons and navigation reachable by keyboard. Use semantic headings, visible focus indicators and labelled form fields; placeholders are hints, not labels.
- When src/lib/templateImage.ts exists, import { templateImage } from it (relative import) and render <img src={templateImage.src} alt={templateImage.alt} width={templateImage.width} height={templateImage.height} />. Its self-contained image works in preview and published sites. Use object-fit: cover and an explicit aspect ratio. Do not copy a /templates preview URL into the generated app or recreate the photograph with CSS.
- Generated photography and example projects are illustrative. Use the user's real work when supplied. Never invent testimonials, awards, availability, stock or completed transactions. Persist enquiries with app-data and load forms-and-signup; label success as an enquiry received, not a confirmed booking or email delivered.
- Use the original brief to preserve section order, content hierarchy and visual rhythm. Adapt names and copy to the user. Never copy another provider's prompts, source, branding or image URLs.`,
  },
  {
    name: "restrained-motion",
    when: "subtle transitions for a classic website, image reveal, editorial hover treatment or a request for calm motion",
    body: `Restrained motion for content-led websites.
- Keep the full page visible and usable with animation disabled. Motion supports a reader's orientation; it never gates a headline, form or navigation.
- Start with CSS transitions for small hover/focus treatments: opacity or transform, about 160 to 240 ms. Avoid continuous float, scroll hijacking, cursor replacement, parallax backgrounds and autoplay video on classic sites.
- For prefers-reduced-motion: reduce, remove nonessential animation and transform transitions and use instant scrolling. Hover-only information must also be available on keyboard focus and touch.
- If a reveal is explicitly requested, use the existing motion kit instead of a new dependency. Reveal once, keep shifts small and do not wait for animation before controls become interactive. Never use opacity: 0 as the only initial content state without a reliable visible fallback.
- Test keyboard selection, touch layouts and reduced motion along with the default state.`,
  },
];
