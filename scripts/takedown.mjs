// Take a published app down, or restore it. Its owner can't republish while it is down.
//   DATABASE_URL=… node scripts/takedown.mjs <slug> [--restore]
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
await sql.end();
process.exit(rows.length ? 0 : 1);
