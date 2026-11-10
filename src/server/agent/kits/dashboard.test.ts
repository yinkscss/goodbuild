// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp } from "../checks";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { dashboard } from "./dashboard";
import { detectKits, kitIdsOf, withKit } from "./index";

const PAGE = `import { BarChart, DataTable, LineChart, ShareBars, Stat } from "./dash/Charts";
import { compact, perDay, useLive } from "./dash/live";

export default function App() {
  const { data, loading, problem } = useLive(async () => [{ at: 1_700_000_000, value: 5 }, { at: 1_700_100_000, value: 7 }]);
  const days = perDay(data ?? []);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3"><Stat label="Total" value={compact(12345)} note={loading ? "Loading" : problem} /><Stat label="Days" value={days.length} /></div>
      <LineChart title="Tips per day" points={days} />
      <BarChart title="Bars" points={days} />
      <ShareBars title="Shares" points={days} />
      <DataTable columns={["Day", "Tips"]} rows={days.map((d) => [d.label, d.value])} />
    </main>
  );
}
`;
const project = (): Record<string, string> => ({ ...withKit(starterFiles(), dashboard), "src/App.tsx": PAGE });

describe("the dashboards kit", { timeout: 120_000 }, () => {
  it("is picked for dashboards and not for ordinary apps or games", () => {
    const wants = (r: string) => detectKits(r, starterFiles()).includes(dashboard);
    for (const yes of ["A dashboard for my savings circle", "Show analytics for my tip jar", "charts of donations over time"]) expect(wants(yes), yes).toBe(true);
    for (const no of ["A tip jar for our football club", "A flappy bird game with a leaderboard"]) expect(wants(no), no).toBe(false);
  });

  it("adds no packages and passes the app check and the type check with a page that uses every part", async () => {
    expect(dashboard.packages).toEqual({});
    expect(kitIdsOf(project())).toEqual(["dashboard"]);
    expect(checkApp(project()).errors).toEqual([]);
    const types = await typeCheck(project());
    if (types.ran) expect(types.issues).toEqual([]);
  });
});
