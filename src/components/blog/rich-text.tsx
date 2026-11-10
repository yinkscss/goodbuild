import Link from "next/link";
import type { ReactNode } from "react";

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Turns [label](href) in post text into links. Anything else is plain text, so posts can't inject markup. */
export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const href = m[2];
    const cls = "text-violet underline-offset-2 hover:underline";
    out.push(
      href.startsWith("/") ? (
        <Link key={at} href={href} className={cls}>
          {m[1]}
        </Link>
      ) : (
        <a key={at} href={href} className={cls} rel="noopener noreferrer" target="_blank">
          {m[1]}
        </a>
      ),
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
