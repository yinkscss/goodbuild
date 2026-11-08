import type { PageTemplate } from "../page-templates";
import { daisyui, hyperui, magicui, pinterest, st21, tailblocks } from "./sources";

export const EVENTS: PageTemplate[] = [
  {
    id: "gathering",
    label: "Gathering",
    category: "Events",
    kind: "site",
    description: "A one-day conference page with speakers, schedule and ticket tiers",
    mood: "confident and festive, deep navy with a coral highlight",
    font: "sans",
    theme: { bg: "#0F1630", fg: "#F2F4FF", muted: "#A4ACD0", card: "#18214A", accent: "#FF7A59", accentFg: "#2B0F07" },
    nav: { brand: "Gathering 2027", links: ["Speakers", "Schedule", "Tickets", "Venue"], cta: "Get tickets" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "14 March 2027, Lagos", title: "Where African builders meet", sub: "One day, 20 talks and 800 people building products across the continent.", cta: "Get tickets", cta2: "See the schedule", note: "Early bird ends 31 January" },
      { type: "cards", title: "Speakers", items: [
        { title: "Amara Eze", text: "CEO, Kora Labs", meta: "Keynote" },
        { title: "Tunde Bello", text: "Staff engineer, Paystream", meta: "Talk" },
        { title: "Zainab Musa", text: "Design lead, Ndiyo", meta: "Workshop" },
      ] },
      { type: "list", title: "Schedule", rows: [
        { left: "09:00", mid: "Doors and coffee", right: "Main hall" },
        { left: "10:00", mid: "Opening keynote", right: "Main hall" },
        { left: "13:00", mid: "Lunch and demos", right: "Garden" },
      ] },
      { type: "pricing", title: "Tickets", items: [
        { name: "Student", price: "₦10,000", points: ["Full day", "Lunch"] },
        { name: "General", price: "₦25,000", points: ["Full day", "Lunch", "Swag bag"], highlight: true },
        { name: "Supporter", price: "₦60,000", points: ["Reserved seat", "Dinner with speakers"] },
      ] },
    ],
    footer: "Gathering 2027, Landmark Centre, Lagos.",
    inspiration: [hyperui("event hero with date line"), tailblocks("speaker cards"), pinterest("conference landing page boards")],
  },
  {
    id: "buildathon",
    label: "Buildathon",
    category: "Events",
    kind: "site",
    description: "A hackathon page with tracks, prizes, a timeline and a register button",
    mood: "energetic and techy, black with electric purple and lime",
    font: "mono",
    theme: { bg: "#0A0A12", fg: "#F0EEFF", muted: "#9690B8", card: "#14142A", accent: "#A78BFA", accentFg: "#150B33" },
    nav: { brand: "BUILDATHON", links: ["Tracks", "Prizes", "Timeline", "FAQ"], cta: "Register" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "48 hours, online, free", title: "Build something people will use", sub: "Teams of up to four ship a working app on Celo in one weekend. Mentors on call all night.", cta: "Register", cta2: "See the tracks", art: "code" },
      { type: "stats", items: [{ value: "$5,000", label: "in prizes" }, { value: "300+", label: "builders" }, { value: "48h", label: "to ship" }] },
      { type: "cards", title: "Tracks", items: [
        { title: "Payments", text: "Make sending money feel instant.", meta: "G$ and cUSD" },
        { title: "Education", text: "Help students learn by doing.", meta: "Open" },
        { title: "Climate", text: "Track and reward small actions.", meta: "Open" },
      ] },
      { type: "steps", title: "Timeline", items: [
        { title: "Fri 6pm", text: "Kick-off and team match." },
        { title: "Sat", text: "Build, mentor sessions, mid-point check." },
        { title: "Sun 4pm", text: "Demos and winners." },
      ] },
    ],
    footer: "Buildathon. Code of conduct, Contact.",
    inspiration: [magicui("grid and glow background"), daisyui("steps timeline"), st21("hackathon hero ideas")],
  },
  {
    id: "passes",
    label: "Passes",
    category: "Events",
    kind: "dapp",
    description: "NFT tickets for a concert, with a sold counter and a door check-in view",
    mood: "nightlife, deep magenta and black, glossy",
    font: "sans",
    theme: { bg: "#12060F", fg: "#FFEAF6", muted: "#C08BAE", card: "#1F0C19", accent: "#F43F9D", accentFg: "#2B0318" },
    nav: { brand: "Passes", links: ["Event", "Tickets", "Check-in"], cta: "Connect wallet" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Saturday 6 December, Eko Atlantic", title: "Campus Concert Night", sub: "300 tickets, each one an NFT in your wallet. Show it at the door and walk in.", cta: "Buy a ticket, 200 G$", cta2: "Door check-in", art: "mint", note: "184 of 300 sold" },
      { type: "stats", items: [{ value: "300", label: "tickets" }, { value: "200 G$", label: "each" }, { value: "2", label: "per wallet" }] },
      { type: "steps", title: "From wallet to door", items: [
        { title: "Buy", text: "Pay in G$ and get your ticket NFT." },
        { title: "Show", text: "Open the ticket on your phone." },
        { title: "Scan", text: "The door team marks it used." },
      ] },
    ],
    footer: "Passes. Tickets cannot be reused once scanned.",
    onchain: "An ERC-721 ticket contract with a max supply of 300, a price of 200 G$, a limit of 2 per wallet, and a used flag that only the organiser's door wallet can set. The page shows sold count, a buy flow, the wallet's tickets with a QR code each, and a check-in page for the organiser.",
    inspiration: [hyperui("event hero and stat band"), magicui("glow background"), pinterest("nightlife poster layouts")],
  },
];
