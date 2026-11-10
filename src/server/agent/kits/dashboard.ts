import type { Kit } from "./registry";

/**
 * The dashboards kit (D75): pages that show numbers and charts, about a contract on Celo, the app's
 * own saved data or both. Charts are small SVG components written for this, so a dashboard adds
 * no package and loads fast on a phone (a charting library is hundreds of kilobytes and more
 * than most dashboards use).
 */

const CHARTS = `import { useId, type ReactNode } from "react";

/** One number, with a label and an optional line under it ("+12% this week"). */
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export interface Point {
  label: string;
  value: number;
}

const W = 320;
const H = 140;
const PAD = 8;

function scale(points: Point[]) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const x = (i: number) => PAD + (points.length < 2 ? (W - 2 * PAD) / 2 : (i * (W - 2 * PAD)) / (points.length - 1));
  const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);
  return { x, y };
}

/** A line over time. Draws a plain message when there is nothing to draw. */
export function LineChart({ points, title }: { points: Point[]; title: string }) {
  const id = useId();
  if (points.length === 0) return <Empty title={title} />;
  const { x, y } = scale(points);
  const line = points.map((p, i) => \`\${i === 0 ? "M" : "L"}\${x(i)},\${y(p.value)}\`).join(" ");
  const area = \`\${line} L\${x(points.length - 1)},\${H - PAD} L\${x(0)},\${H - PAD} Z\`;
  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <svg viewBox={\`0 0 \${W} \${H}\`} role="img" aria-label={title} className="w-full">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={\`url(#\${id})\`} className="text-primary" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="text-primary" />
      </svg>
      <Axis first={points[0].label} last={points[points.length - 1].label} />
    </figure>
  );
}

/** Bars, one per label. */
export function BarChart({ points, title }: { points: Point[]; title: string }) {
  if (points.length === 0) return <Empty title={title} />;
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = (W - 2 * PAD) / points.length;
  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <svg viewBox={\`0 0 \${W} \${H}\`} role="img" aria-label={title} className="w-full">
        {points.map((p, i) => {
          const h = (Math.max(0, p.value) / max) * (H - 2 * PAD);
          return <rect key={p.label + i} x={PAD + i * slot + slot * 0.15} y={H - PAD - h} width={slot * 0.7} height={h} rx="3" className="fill-primary" />;
        })}
      </svg>
      <Axis first={points[0].label} last={points[points.length - 1].label} />
    </figure>
  );
}

/** Shares of a whole, as labelled bars: easier to read than a pie on a phone. */
export function ShareBars({ points, title }: { points: Point[]; title: string }) {
  if (points.length === 0) return <Empty title={title} />;
  const total = points.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>
      <ul className="space-y-2">
        {points.map((p) => (
          <li key={p.label}>
            <div className="flex justify-between text-xs">
              <span>{p.label}</span>
              <span className="tabular-nums">{Math.round((Math.max(0, p.value) / total) * 100)}%</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: \`\${(Math.max(0, p.value) / total) * 100}%\` }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Axis({ first, last }: { first: string; last: string }) {
  return (
    <div className="mt-1 flex justify-between text-xs text-muted-foreground">
      <span>{first}</span>
      <span>{last}</span>
    </div>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <p className="mt-2 text-sm text-muted-foreground">Nothing to show yet.</p>
    </figure>
  );
}

/** A table that scrolls sideways on a phone instead of squashing. */
export function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>{columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">{r.map((cell, j) => <td key={j} className="px-3 py-2 tabular-nums">{cell}</td>)}</tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={columns.length} className="px-3 py-4 text-muted-foreground">Nothing to show yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
`;

const LIVE_TS = `import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Run a loader now and again every few seconds while the page is open (and visible). Returns the
 * latest data, whether the first load is still going, and a problem to show if it failed.
 * Use it with publicClient reads from src/lib/chain.ts, or with the app's saved data.
 */
export function useLive<T>(load: () => Promise<T>, everyMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const loader = useRef(load);
  loader.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loader.current());
      setProblem(null);
    } catch {
      setProblem("Couldn't load the latest numbers. Trying again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [refresh, everyMs]);

  return { data, loading, problem, refresh };
}

/** Add up values by day: [{ label: "3 Nov", value }] in date order, from timestamps in seconds. */
export function perDay(items: Array<{ at: number; value: number }>): Array<{ label: string; value: number }> {
  const days = new Map<number, number>();
  for (const { at, value } of items) {
    const day = Math.floor(at / 86_400);
    days.set(day, (days.get(day) ?? 0) + value);
  }
  return [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, value]) => ({ label: new Date(day * 86_400_000).toLocaleDateString(undefined, { day: "numeric", month: "short" }), value }));
}

/** 1234567 -> "1.2M". For stat cards. */
export function compact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
`;

const GUIDE = `Dashboards. The kit's files are in src/dash/: use them, don't rewrite them.
- Charts.tsx has Stat (one number), LineChart and BarChart (a list of { label, value } points), ShareBars (shares of a whole: use this, not a pie) and DataTable. They are plain SVG and Tailwind, sized to the width they are given, with no package behind them. Don't add a charting package.
- live.ts has useLive(load, everyMs) which loads now and refreshes while the page is open, perDay(items) which sums values by day from timestamps in seconds, and compact(n) for big numbers.
- Real numbers only. A dashboard reads what is true: contract state through publicClient.readContract, past activity through publicClient.getLogs on the contract's events (read it in chunks of at most 5,000 blocks, newest first, and stop when it has enough), or the app's saved data through useDb. Never hard-code numbers to look good. If the project has no data yet, show "Nothing to show yet." plainly. In the preview there is no chain, so the page must still render with that message and no error.
- Amounts: format token amounts with formatUnits and the token's real decimals, then compact() for big ones. Show G$ amounts as "G$ 1,200".
- Lay it out for a phone first: one column of Stat cards in a grid-cols-2 row at the top (the two numbers that matter most), then the main chart, then the table. At sm and up, use more columns. Tables scroll sideways inside DataTable.
- Show a last-updated time and a loading state for each block, and a calm message (not the error text) when a block fails: the other blocks keep working.
- Keep to the project's own look (the theme's colors and fonts); charts take the theme's primary color.
- Reading is free, so a dashboard needs no wallet: don't show a ConnectButton unless the page also lets people act.`;

export const dashboard: Kit = {
  id: "dashboard",
  title: "Dashboards",
  when: "a page that shows numbers, charts or tables: stats, analytics, a treasury or balances view, a leaderboard, activity over time, or a status page for a contract",
  keywords: /\b(dashboards?|analytics|stats page|statistics|charts?|graphs?|treasury (?:view|tracker)|tracker|metrics|kpis?|activity feed|explorer)\b/i,
  packages: {},
  files: {
    "src/dash/Charts.tsx": CHARTS,
    "src/dash/live.ts": LIVE_TS,
  },
  guide: GUIDE,
};
