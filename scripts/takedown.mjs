// Take a published app down, or restore it. Its owner can't republish while it is down.
// A takedown stops the app's data API at once and keeps the data, unless --purge-data is given.
//   DATABASE_URL=… node scripts/takedown.mjs <slug> [--restore] [--purge-data]
import postgres from "postgres";

const slug = process.argv[2];
if (!/^[a-z0-9-]{3,40}$/.test(slug ?? "") || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=… node scripts/takedown.mjs <slug> [--restore]");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const value = process.argv.includes("--restore") ? null : new Date();
const rows = await sql`update publications set disabled_at = ${value} where slug = ${slug} returning slug`;
console.log(rows.length ? `${slug} is ${value ? "down" : "restored"}.` : `No published app called ${slug}.`);
if (rows.length && process.argv.includes("--purge-data")) {
  // Everything visitors saved in this app, and their sessions. It can't be undone, though nightly backups keep it for 7 days.
  const deleted = await sql.begin(async (tx) => {
    const where = tx`project_id = (select project_id from publications where slug = ${slug})`;
    const records = await tx`delete from app_data_records where ${where} returning 1`;
    await tx`delete from app_data_usage where ${where}`;
    await tx`delete from app_data_sessions where ${where}`;
    await tx`delete from app_data_nonces where ${where}`;
    return records.length;
  });
  console.log(`Deleted ${deleted} saved records.`);
}
await sql.end();
process.exit(rows.length ? 0 : 1);
