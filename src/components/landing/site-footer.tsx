import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { FOOTER_COLUMNS } from "@/config/site-links";

export function SiteFooter() {
  return (
    <footer className="mt-24 grid gap-10 border-t border-hairline py-14 text-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
      <div className="max-w-sm">
        <Logo />
        <p className="mt-4 text-grey-600">Made for the GoodDollar community. In testnet beta on Celo Sepolia.</p>
        <p className="mt-2 text-grey-600">For people aged 18 and over. Not available to US persons.</p>
      </div>
      {FOOTER_COLUMNS.map((c) => (
        <nav key={c.title} aria-label={c.title}>
          <p className="eyebrow">{c.title}</p>
          <ul className="mt-4 space-y-2.5 text-grey-600">
            {c.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="rounded-full transition-colors duration-200 ease-gb hover:text-violet">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}
      <p className="text-grey-400 md:col-span-4">© 2026 GoodBuild</p>
    </footer>
  );
}
