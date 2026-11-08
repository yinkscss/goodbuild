import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/server/db/schema.ts", "./src/server/db/deploy-schema.ts", "./src/server/db/publish-schema.ts", "./src/server/db/app-data-schema.ts", "./src/server/db/settings-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/goodbuild" },
});
