/** Top nav and footer links. Every "/#id" must match a section on the landing page (site-links.test.ts). */
export interface SiteLink {
  href: string;
  label: string;
}

/** Support and abuse reports. No address yet: legal pages say so rather than invent one. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** The owner's Telegram group for support. A public link, safe in the browser. NEXT_PUBLIC_TELEGRAM_URL overrides it. */
export const SUPPORT_TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/+FkNpTbLck1BjNDk8";

export const NAV_LINKS: SiteLink[] = [
  { href: "/#templates", label: "Templates" },
  { href: "/#apps", label: "Live apps" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#safety", label: "Safety" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/docs", label: "Docs" },
];

export const FOOTER_COLUMNS: Array<{ title: string; links: SiteLink[] }> = [
  {
    title: "Product",
    links: [
      { href: "/#templates", label: "Templates" },
      { href: "/#apps", label: "Live apps" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#builder", label: "Inside the builder" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/hackathon", label: "Hackathon" },
      { href: "/stats", label: "Open stats" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/blog", label: "Blog" },
      { href: "/#safety", label: "Safety" },
      { href: "/#faq", label: "FAQ" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/support", label: "Support" },
      { href: "/report", label: "Report an app" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { href: "https://www.gooddollar.org", label: "GoodDollar" },
      { href: "https://celo.org", label: "Celo" },
    ],
  },
];
