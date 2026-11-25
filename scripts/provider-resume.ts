/**
 * Start builds again by hand after topping up an AI provider account (D177). The worker also checks by itself every
 * 3 minutes, so this is only for when you don't want to wait. Held requests then start in order.
 *
 *   pnpm provider:resume            # both providers
 *   pnpm provider:resume deepseek   # one
 */
import { getDb } from "../src/server/db/client";
import { resumeProvider, type Provider } from "../src/server/agent/provider-status";

async function main() {
  const arg = process.argv[2];
  if (arg && arg !== "deepseek" && arg !== "anthropic") throw new Error("name deepseek or anthropic, or nothing for both");
  const db = await getDb();
  for (const p of (arg ? [arg] : ["deepseek", "anthropic"]) as Provider[]) {
    console.log(`${p}: ${(await resumeProvider(db, p, "restarted by the owner")) ? "builds restarted" : "wasn't paused"}`);
  }
  // Let the Telegram message go out before exiting.
  await new Promise((r) => setTimeout(r, 2000));
  process.exit(0);
}

main().catch((e) => {
  console.error(`provider resume failed: ${(e as Error).message}`);
  process.exit(1);
});
