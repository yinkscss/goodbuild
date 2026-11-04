import { Logo } from "@/components/brand/logo";
import { ConnectButton } from "@/components/landing/connect-button";

const LINKS = [
  { href: "#templates", label: "Templates" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing in G$" },
  { href: "#docs", label: "Docs" },
];

export function SiteNav() {
  return (
    <header className="relative mx-auto flex h-20 max-w-[1360px] items-center justify-between px-4 sm:px-8">
      <Logo />
      <nav
        aria-label="Main"
        className="absolute left-1/2 hidden -translate-x-1/2 gap-9 text-sm text-ink/60 md:flex"
      >
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className="rounded-full transition-colors duration-200 ease-gb hover:text-violet">
            {l.label}
          </a>
        ))}
      </nav>
      <ConnectButton />
    </header>
  );
}
