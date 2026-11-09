import type { PageTemplate } from "../page-templates";
import { daisyui, hyperui, pinterest, shadcn, st21, tailblocks } from "./sources";

export const STORE: PageTemplate[] = [
  {
    id: "corner",
    label: "Corner Shop",
    category: "Store",
    kind: "site",
    description: "A small-brand online store with featured products and a shipping promise",
    mood: "fresh and handmade, sage green with terracotta",
    font: "sans",
    theme: { bg: "#F5F7F2", fg: "#1F2B22", muted: "#6A7A6E", card: "#FFFFFF", accent: "#C2603A", accentFg: "#FFFFFF" },
    nav: { brand: "Corner Shop", links: ["Shop", "Bestsellers", "About", "Contact"], cta: "Cart (0)" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Handmade in Kano", title: "Everyday things, made with care", sub: "Shea butter, woven baskets and indigo cloth from small workshops across Nigeria.", cta: "Shop now", cta2: "Our story", art: "tiles" },
      { type: "cards", title: "Bestsellers", items: [
        { title: "Shea butter, 250g", text: "Unrefined and whipped", meta: "₦4,500" },
        { title: "Woven market basket", text: "Palm leaf, hand dyed", meta: "₦12,000" },
        { title: "Indigo tea towel", text: "Cotton, set of two", meta: "₦6,500" },
        { title: "Black soap bar", text: "Cocoa pod ash and oil", meta: "₦2,000" },
      ] },
      { type: "features", title: "Why shop with us", items: [
        { icon: "Truck", title: "Delivery in 3 days", text: "Across Lagos, Abuja and Kano." },
        { icon: "HandHeart", title: "Fair to makers", text: "Makers keep 70% of every sale." },
        { icon: "RotateCcw", title: "Easy returns", text: "Changed your mind? Send it back in 14 days." },
      ] },
      { type: "form", title: "Get 10% off your first order", placeholder: "Your email", button: "Subscribe" },
    ],
    footer: "Corner Shop, Kano. Shipping, Returns, Contact.",
    inspiration: [hyperui("product card grid"), tailblocks("ecommerce feature row"), pinterest("earthy small-brand store layouts")],
  },
  {
    id: "pixelshop",
    label: "Pixel Shop",
    category: "Store",
    kind: "dapp",
    description: "A digital downloads store where buyers pay in G$ and get a link",
    mood: "modern and playful, ink black with a mint accent",
    font: "sans",
    theme: { bg: "#F4F6F6", fg: "#101414", muted: "#677272", card: "#FFFFFF", accent: "#10B981", accentFg: "#04241A" },
    nav: { brand: "Pixel Shop", links: ["Templates", "Icons", "Fonts", "License"], cta: "Connect wallet" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "Design assets, paid in G$", title: "Templates and icons you can use today", sub: "Buy once, download instantly and use in unlimited projects. Pay with G$ from your wallet.", cta: "Browse the shop", art: "tiles" },
      { type: "cards", title: "New this week", items: [
        { title: "Resume kit", text: "12 editable layouts", meta: "40 G$" },
        { title: "Line icons, 400 pack", text: "SVG and PNG", meta: "25 G$" },
        { title: "Poster fonts bundle", text: "6 display typefaces", meta: "60 G$" },
      ] },
      { type: "steps", title: "How buying works", items: [
        { title: "Pick a product", text: "Preview before you buy." },
        { title: "Pay in G$", text: "One transaction from your wallet." },
        { title: "Download", text: "The link unlocks right away." },
      ] },
    ],
    footer: "Pixel Shop. Licences, Refunds, Contact.",
    onchain: "A payments contract that takes G$ for a product id and records the purchase for the buyer's wallet. After the transaction the page shows a Download button for each product the wallet owns (the files can be plain links in the app). Product list and prices live in a small data file.",
    inspiration: [shadcn("product cards"), st21("marketplace grid ideas"), daisyui("card and badge styling")],
  },
  {
    id: "kitchen",
    label: "Mama's Kitchen",
    category: "Store",
    kind: "site",
    description: "A restaurant page with the menu, opening hours and a reservation form",
    mood: "appetising and homely, deep red with cream",
    font: "serif",
    theme: { bg: "#FFF8F0", fg: "#2D1410", muted: "#8A6A60", card: "#FFFFFF", accent: "#B91C1C", accentFg: "#FFFFFF" },
    nav: { brand: "Mama's Kitchen", links: ["Menu", "Hours", "Reserve", "Find us"], cta: "Reserve a table" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Home cooking in Yaba", title: "Jollof, suya and everything your aunty makes", sub: "Open for lunch and dinner. Dine in, take away or order for your party.", cta: "See the menu", cta2: "Reserve a table", art: "tiles" },
      { type: "cards", title: "Today's favourites", items: [
        { title: "Party jollof", text: "Smoky rice with fried plantain", meta: "₦3,500" },
        { title: "Beef suya", text: "Spiced, grilled, with onions", meta: "₦2,800" },
        { title: "Pounded yam and egusi", text: "With goat meat", meta: "₦4,200" },
      ] },
      { type: "list", title: "Opening hours", rows: [
        { left: "Monday to Friday", right: "11am to 10pm" },
        { left: "Saturday", right: "10am to 11pm" },
        { left: "Sunday", right: "12pm to 8pm" },
      ] },
      { type: "form", title: "Reserve a table", sub: "We will confirm by SMS within the hour.", placeholder: "Your phone number", button: "Request" },
    ],
    footer: "Mama's Kitchen, 14 Herbert Macaulay Way, Yaba.",
    inspiration: [tailblocks("menu cards and hours list"), hyperui("simple contact form"), pinterest("warm restaurant landing pages")],
  },
];
