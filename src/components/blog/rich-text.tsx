import Link from "next/link";
import type { ReactNode } from "react";

const TOKEN = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;

/** Turns [label](href) into links and **bold** into <strong>. Anything else is plain text, so posts can't inject markup. */
export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[3] !== undefined) {
      out.push(
        <strong key={at} className="font-semibold text-ink">
          {m[3]}
        </strong>,
      );
    } else {
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
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
