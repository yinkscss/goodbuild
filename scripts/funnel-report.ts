/**
 * Read-only weekly funnel (D177). Per week a project was started: projects started, got a version, published, and
 * deployed a contract; and build errors per week grouped by cause. It prints counts only, never prompts or error
 * text, and runs in a READ ONLY transaction. Run against production with its DATABASE_URL:
 *
 *   pnpm funnel                 # the last 8 weeks
 *   pnpm funnel -- --weeks 12   # more weeks
 *   pnpm funnel -- --json       # machine-readable
 */
import { getDb } from "../src/server/db/client";
import { formatFunnel, funnelReport } from "../src/server/reports/funnel";

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--weeks");
  const weeks = at >= 0 ? Number(args[at + 1]) : 8;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) throw new Error("--weeks takes a whole number from 1 to 104");
  const report = await funnelReport(await getDb(), { weeks });
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatFunnel(report));
  process.exit(0);
}

main().catch((e) => {
  console.error(`funnel report failed: ${(e as Error).message}`);
  process.exit(1);
});
