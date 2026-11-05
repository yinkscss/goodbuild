import Link from "next/link";
import { cn } from "@/lib/utils";

/** The G mark from design/landing/index.html. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="#592E81" />
      <path
        d="M21 12.5a6.5 6.5 0 1 0 0 7H16"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="18.5" y="15" width="4" height="4" rx="1" fill="#FF85D9" />
    </svg>
  );
}

export function Logo({ href = "/", wordmarkClassName }: { href?: string; wordmarkClassName?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-full" aria-label="GoodBuild home">
      <LogoMark />
      <span className={cn("text-lg font-semibold tracking-tight", wordmarkClassName)}>GoodBuild</span>
    </Link>
  );
}
