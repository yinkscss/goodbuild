/** Top nav and footer links. Every "/#id" must match a section on the landing page (site-links.test.ts). */
export interface SiteLink {
  href: string;
  label: string;
}

export const NAV_LINKS: SiteLink[] = [
  { href: "/#templates", label: "Templates" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#safety", label: "Safety" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

export const FOOTER_COLUMNS: Array<{ title: string; links: SiteLink[] }> = [
  {
    title: "Product",
    links: [
      { href: "/#templates", label: "Templates" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#builder", label: "Inside the builder" },
      { href: "/#pricing", label: "Pricing" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/#safety", label: "Safety" },
      { href: "/#faq", label: "FAQ" },
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
