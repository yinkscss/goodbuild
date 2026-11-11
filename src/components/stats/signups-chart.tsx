/** Weekly sign-ups as the one pink line (DESIGN_SYSTEM §3 Charts). Server-rendered SVG, draws in once, still under reduced motion. */
export function SignupsChart({ weeks }: { weeks: Array<{ weekStart: string; signups: number }> }) {
  const W = 600;
  const H = 180;
  const pad = 8;
  const max = Math.max(1, ...weeks.map((w) => w.signups));
  const step = weeks.length > 1 ? (W - pad * 2) / (weeks.length - 1) : 0;
  const pts = weeks.map((w, i) => [pad + i * step, H - pad - (w.signups / max) * (H - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)?.[0] ?? pad} ${H} L${pad} ${H} Z`;
  const last = pts.at(-1);
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <figure className="mt-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Sign-ups per week for the last ${weeks.length} weeks`}>
        <defs>
          <linearGradient id="signups-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#FF85D9" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FF85D9" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(17 17 17 / 0.05)" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#signups-fill)" />
        <path
          d={line}
          fill="none"
          stroke="#FF85D9"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pathLength={900}
          style={{ strokeDasharray: 900, strokeDashoffset: 0 }}
          className="animate-draw motion-reduce:animate-none"
        />
        {last && <circle cx={last[0]} cy={last[1]} r="5" fill="#FF85D9" className="animate-pulse-dot motion-reduce:animate-none" />}
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-grey-400">
        <span>Week of {label(weeks[0]?.weekStart ?? "")}</span>
        <span>This week</span>
      </figcaption>
      <table className="sr-only">
        <caption>Sign-ups per week</caption>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}>
              <th scope="row">Week of {label(w.weekStart)}</th>
              <td>{w.signups}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
