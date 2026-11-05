import Link from "next/link";

import { WalletButton } from "@/components/auth/wallet-button";
import { Logo } from "@/components/brand/logo";
import { NAV_LINKS } from "@/config/site-links";
import { SiteNavMenu } from "./site-nav-menu";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 bg-canvas">
      <div className="relative mx-auto flex h-20 max-w-[1360px] items-center justify-between gap-3 px-4 sm:px-8">
        <Logo />
        <nav
          aria-label="Main"
          className="absolute left-1/2 hidden -translate-x-1/2 gap-9 text-sm text-ink/60 lg:flex"
        >
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full transition-colors duration-200 ease-gb hover:text-violet">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <WalletButton />
          <SiteNavMenu />
        </div>
      </div>
    </header>
  );
}
