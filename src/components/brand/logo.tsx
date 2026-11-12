import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Official GoodBuild mark: glass 2x2 tile (public/brand/logo-mark.png). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/logo-192.png"
      alt=""
      width={32}
      height={32}
      className={cn("size-8", className)}
      aria-hidden
      priority
    />
  );
}

export function Logo({ href = "/", wordmarkClassName }: { href?: string; wordmarkClassName?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5 rounded-full" aria-label="GoodBuild home">
      <LogoMark />
      <span className={cn("text-lg font-semibold tracking-tight whitespace-nowrap", wordmarkClassName)}>GoodBuild</span>
    </Link>
  );
}
