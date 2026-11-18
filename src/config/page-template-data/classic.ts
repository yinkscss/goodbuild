import type { PageTemplate, Section, TemplateTheme } from "../page-templates";

const paper: TemplateTheme = { bg: "#F7F3EB", fg: "#242820", muted: "#65695E", card: "#EDE8DD", accent: "#3F523A", accentFg: "#FFFFFF" };
const clay: TemplateTheme = { bg: "#FAF6F0", fg: "#30251E", muted: "#736458", card: "#EEE5D9", accent: "#8C432D", accentFg: "#FFFFFF" };
const ink: TemplateTheme = { bg: "#F5F3EE", fg: "#172A3B", muted: "#586573", card: "#E7EBED", accent: "#244B68", accentFg: "#FFFFFF" };
const interior = { src: "/templates/assets/classic-interior.webp", alt: "Sunlit limewash room with an oak table, linen chair and arched doorway" };
const ceramics = { src: "/templates/assets/classic-ceramics.webp", alt: "Handmade ivory ceramic vessels on travertine with linen and an olive branch" };
const garden = { src: "/templates/assets/classic-garden.webp", alt: "Gravel path through white flowers and olive trees toward a stone pavilion" };

function classic(t: Omit<PageTemplate, "category" | "kind" | "font" | "inspiration">): PageTemplate {
  return {
    category: "Classic", kind: "site", font: "serif",
    inspiration: [{ source: "GoodBuild original", licence: "Original", idea: "Original art direction, copy, layout specification and generated photography" }],
    ...t,
  };
}

function contact(title: string, button: string): Section {
  return { type: "form", title, sub: "Sample enquiry form. Replace these details with your own before publishing.", placeholder: "Your email address", button };
}

/** Original classic websites. No MotionSites prompts, code, previews or assets are redistributed. */
export const CLASSIC: PageTemplate[] = [
  classic({
    id: "classic-stillhouse", label: "Stillhouse", description: "A quiet boutique stay with sunlit interiors and a room enquiry form",
    mood: "classic hospitality, generous ivory space, olive ink, thin rules and squared image frames", theme: paper,
    nav: { brand: "Stillhouse", links: ["The house", "Rooms", "Visit"], cta: "Enquire about a stay" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "A slower kind of stay", title: "A little room to do nothing.", sub: "A house of quiet corners, open windows and long breakfasts. Come for a weekend. Find your own pace.", cta: "Explore the rooms", cta2: "Plan your stay", image: interior },
      { type: "features", title: "Simple things, beautifully considered", items: [
        { icon: "Sun", title: "Unhurried mornings", text: "Seasonal breakfast at a table by the garden." },
        { icon: "BookOpen", title: "Space to switch off", text: "Books, linen and a comfortable place to pause." },
        { icon: "Leaf", title: "A gentler footprint", text: "Local makers and thoughtful everyday choices." },
      ] },
      { type: "list", title: "Find your corner", rows: [{ left: "The Courtyard Room", mid: "Garden level", right: "View room" }, { left: "The Library Suite", mid: "A quiet upper floor", right: "View suite" }] },
      contact("Tell us when you would like to visit", "Enquire"),
    ], footer: "Stillhouse. An original sample hospitality website. Replace room details before publishing.",
  }),
  classic({
    id: "classic-form-field", label: "Form & Field", description: "An interiors studio with an editorial project list and a considered process",
    mood: "architectural editorial, warm paper, large serif headlines, precise fine dividers, restrained motion", theme: clay,
    nav: { brand: "Form & Field", links: ["Projects", "Studio", "Process"], cta: "Start a conversation" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Interiors with a sense of belonging", title: "Spaces that feel like you.", sub: "Thoughtful materials. Natural light. Rooms shaped around the way you live, rather than the latest trend.", cta: "View selected work", cta2: "Meet the studio", image: interior },
      { type: "list", title: "Selected spaces", rows: [{ left: "The Courtyard House", mid: "Residential concept", right: "01" }, { left: "A room for reading", mid: "Interior study", right: "02" }, { left: "Gathered around a table", mid: "Hospitality concept", right: "03" }] },
      { type: "steps", title: "From first thought to final detail", items: [{ title: "Listen", text: "Begin with your habits, hopes and constraints." }, { title: "Shape", text: "Explore plans, materials and a clear direction." }, { title: "Make", text: "Bring the agreed design together with care." }] },
      contact("What would you like your space to feel like?", "Get in touch"),
    ], footer: "Form & Field. Sample projects for a fictional studio. Replace with your own work.",
  }),
  classic({
    id: "classic-earthware", label: "Earthware", description: "A timeless ceramics storefront with a collection list and maker story",
    mood: "tactile artisan retail, terracotta accents, cream canvas, refined serif and simple rectangular controls", theme: clay,
    nav: { brand: "earthware", links: ["Collection", "Our craft", "Care"], cta: "Browse the collection" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Objects for everyday rituals", title: "Made slowly. Kept for years.", sub: "Hand-shaped ceramics for the first coffee, the shared meal and the flowers you brought home.", cta: "Explore the collection", cta2: "Our approach", image: ceramics },
      { type: "list", title: "The everyday collection", rows: [{ left: "Morning cup", mid: "Stoneware, warm white", right: "View details" }, { left: "Gathering bowl", mid: "Hand-finished glaze", right: "View details" }, { left: "Stem vessel", mid: "Natural clay", right: "View details" }] },
      { type: "features", title: "A little more considered", items: [{ icon: "Hand", title: "A human touch", text: "Small variations make each piece its own." }, { icon: "Package", title: "Packed with care", text: "Keep the material story clear at every step." }, { icon: "Heart", title: "Made to stay", text: "Simple care advice for years of everyday use." }] },
      contact("Be first to hear about the next collection", "Join the list"),
    ], footer: "Earthware. Sample collection; add your own stock, prices and fulfilment details.",
  }),
  classic({
    id: "classic-sunday-paper", label: "Sunday Paper", description: "An independent journal with a serif masthead, reading list and subscription form",
    mood: "literary magazine, ink on uncoated paper, editorial rules, ample whitespace, no glossy effects", theme: paper,
    nav: { brand: "The Sunday Paper", links: ["Stories", "Objects", "Letters"], cta: "Get the next letter" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Notes on living with less hurry", title: "Good things take a little longer.", sub: "Stories about the spaces we inhabit, the objects we keep and the people who make them.", cta: "Read the latest", cta2: "About the journal", image: ceramics },
      { type: "list", title: "On the reading table", rows: [{ left: "The beauty of a useful thing", mid: "Objects / Sample essay", right: "06 min" }, { left: "Rooms that grow with us", mid: "Spaces / Sample essay", right: "08 min" }, { left: "A walk without a destination", mid: "Everyday / Sample essay", right: "04 min" }] },
      { type: "form", title: "A thoughtful letter, every now and then", sub: "Essays, discoveries and small things worth noticing. Unsubscribe whenever you like.", placeholder: "Your email", button: "Subscribe" },
    ], footer: "The Sunday Paper. An original fictional journal. Replace sample essays with your own writing.",
  }),
  classic({
    id: "classic-garden-room", label: "Garden Room", description: "A landscape designer website with a botanical hero and a clear design process",
    mood: "botanical classic, forest green, ivory serif type, quiet image-led storytelling and fine borders", theme: paper,
    nav: { brand: "Garden Room", links: ["Gardens", "Approach", "Planting"], cta: "Discuss your garden" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Gardens for the life outside", title: "Let a little wildness in.", sub: "Layered planting, natural materials and room for the seasons. Outdoor spaces made to be lived in.", cta: "Explore our approach", cta2: "Start your garden", image: garden },
      { type: "steps", title: "Rooted in your everyday", items: [{ title: "Walk the space", text: "Study the light, soil and the way you move." }, { title: "Draw the possibilities", text: "Balance planting, paths and places to pause." }, { title: "Grow into it", text: "A practical planting and care plan for the seasons." }] },
      { type: "list", title: "Spaces we imagine", rows: [{ left: "The courtyard garden", mid: "Small space, generous planting" }, { left: "A place for gathering", mid: "Outdoor dining and shade" }, { left: "The changing border", mid: "Colour through the seasons" }] },
      contact("Tell us about your outdoor space", "Begin a conversation"),
    ], footer: "Garden Room. Fictional design studio; replace sample concepts with completed projects.",
  }),
  classic({
    id: "classic-meadow-retreat", label: "Meadow Retreat", description: "A countryside retreat with garden photography, a sample itinerary and enquiries",
    mood: "romantic country classic, soft cream and deep green, expansive serif headlines and calm pacing", theme: paper,
    nav: { brand: "Meadow", links: ["The place", "Your weekend", "Questions"], cta: "Ask about a retreat" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Leave a little space in the diary", title: "Somewhere to come back to yourself.", sub: "Walks in the garden, food around a shared table and enough time to follow your own curiosity.", cta: "Imagine your weekend", cta2: "Make an enquiry", image: garden },
      { type: "list", title: "A weekend, lightly planned", rows: [{ left: "Friday", mid: "Arrive, settle in, share supper" }, { left: "Saturday", mid: "Garden walk, creative time, a long lunch" }, { left: "Sunday", mid: "A slow breakfast and a gentle goodbye" }] },
      { type: "faq", items: [{ q: "Is this a fixed programme?", a: "This is a sample itinerary. Replace it with your own retreat schedule and booking terms." }, { q: "How do I ask about dates?", a: "Use the enquiry form below to begin a conversation." }] },
      contact("Find a little time away", "Ask about dates"),
    ], footer: "Meadow. A sample retreat website. No availability or bookings are confirmed by this demo.",
  }),
  classic({
    id: "classic-northline", label: "Northline Advisory", description: "A traditional consultancy website with service pillars and an enquiry form",
    mood: "confident traditional business, navy ink on stone, typography first, precise rules, no decorative gradients", theme: ink,
    nav: { brand: "NORTHLINE", links: ["Expertise", "Approach", "Contact"], cta: "Arrange a conversation" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "Independent thinking. Practical direction.", title: "Clarity for your next chapter.", sub: "A considered approach to strategy, operations and change. Start with the right questions. Move forward with a clear plan.", cta: "Explore our expertise", cta2: "Get in touch", note: "A fictional consultancy template. Add your own credentials and services." },
      { type: "features", title: "Where we can help", items: [{ icon: "Compass", title: "Direction", text: "Turn competing priorities into a focused strategy." }, { icon: "Layers", title: "Operations", text: "Shape simpler ways for teams to do good work." }, { icon: "Waypoints", title: "Change", text: "Build a practical path from intent to delivery." }] },
      { type: "steps", title: "A clear way forward", items: [{ title: "Understand", text: "Get close to the context and the constraints." }, { title: "Decide", text: "Make the choices and tradeoffs explicit." }, { title: "Act", text: "Agree ownership, next steps and measures." }] },
      contact("What is the decision in front of you?", "Arrange a conversation"),
    ], footer: "Northline Advisory. Sample practice; replace all services and credentials before publishing.",
  }),
  classic({
    id: "classic-margin-press", label: "Margin Press", description: "A classic independent publisher with a typographic catalogue and reader newsletter",
    mood: "traditional publishing, oxblood accents, paper cream, oversized serif masthead and numbered catalogue rows", theme: { ...clay, accent: "#742F39" },
    nav: { brand: "MARGIN PRESS", links: ["Books", "Our story", "For readers"], cta: "Browse the catalogue" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "Independent books. Lasting ideas.", title: "For the margins you make your own.", sub: "A small press for curious readers. Essays, stories and new perspectives to return to, again and again.", cta: "Explore the books", cta2: "Meet the press", note: "Original sample catalogue. Replace with your own titles and authors." },
      { type: "list", title: "From our sample catalogue", rows: [{ left: "The Art of Paying Attention", mid: "Essay collection / Sample title", right: "01" }, { left: "A Map of Small Places", mid: "Travel writing / Sample title", right: "02" }, { left: "Everything We Keep", mid: "Short stories / Sample title", right: "03" }] },
      { type: "features", title: "Care on every page", items: [{ icon: "BookOpen", title: "Curious voices", text: "An editorial home for thoughtful writing." }, { icon: "Feather", title: "Considered editions", text: "Typography and materials that serve the words." }, { icon: "Mail", title: "Letters to readers", text: "A conversation beyond the final page." }] },
      { type: "form", title: "A note from the press", sub: "New books, reading notes and occasional letters.", placeholder: "Your email address", button: "Join our readers" },
    ], footer: "Margin Press. A fictional publisher. Sample titles are illustrative, not items for sale.",
  }),
];
