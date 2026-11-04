import type { LandingStats } from "@/config/landing-stats";

/** Build a smooth SVG path through evenly spaced points (Catmull-Rom → cubic Bézier). */
export function smoothPath(values: number[], width: number, height: number, padTop = 20): string {
  if (values.length < 2) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    padTop + (1 - (v - min) / span) * (height - padTop - 30),
  ]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const W = 300;
const H = 180;

/** Left bento card: one metric, a pink line chart (DESIGN_SYSTEM §3 Charts). */
export function MetricCard({ stats }: { stats: LandingStats }) {
  const line = smoothPath(stats.series, W, H);
  const last = stats.series.length - 1;
  const max = Math.max(...stats.series);
  const min = Math.min(...stats.series);
  const endY = 20 + (1 - (stats.series[last] - min) / (max - min || 1)) * (H - 50);

  return (
    <section aria-label={stats.headlineLabel} className="flex flex-col rounded-card bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-grey-600">{stats.headlineLabel}</p>
        <span
          className="rounded-full bg-tint px-2 py-1 text-[11px] font-semibold text-violet"
          title={stats.isLive ? undefined : "Sample figures until GoodBuild has live deploys"}
        >
          {stats.isLive ? "Live" : "Preview"}
        </span>
      </div>
      <p className="display mt-4 text-[40px] font-bold">{stats.headlineValue}</p>
      <p className="mt-1 text-sm font-medium text-violet">{stats.deltaLabel}</p>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-6 min-h-[140px] w-full flex-1" aria-hidden>
        <defs>
          <linearGradient id="gb-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF85D9" stopOpacity="0.45" />
            <stop offset="1" stopColor="#FF85D9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="#111" strokeOpacity="0.05" vectorEffect="non-scaling-stroke">
          <path d={`M0 45H${W}M0 90H${W}M0 135H${W}`} vectorEffect="non-scaling-stroke" />
        </g>
        <path d={`${line} V${H} H0Z`} fill="url(#gb-chart-fill)" />
        <path
          d={line}
          fill="none"
          stroke="#FF85D9"
          strokeWidth="3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={900}
          strokeDasharray="900"
          className="animate-draw motion-reduce:animate-none"
        />
        <circle cx={W} cy={endY} r="5" fill="#FF85D9" className="animate-pulse-dot motion-reduce:animate-none" />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-grey-400" aria-hidden>
        <span>MON</span>
        <span>WED</span>
        <span>FRI</span>
        <span>SUN</span>
      </div>
      <div className="mt-5 flex justify-between border-t border-hairline pt-4 text-sm">
        <span className="text-grey-600">{stats.footerLabel}</span>
        <b className="font-semibold">{stats.footerValue}</b>
      </div>
    </section>
  );
}
