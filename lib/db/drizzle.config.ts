import { defineConfig } from "drizzle-kit";
import path from "path";
import { buildPgPoolConfig } from "./src/ssl";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const pool = buildPgPoolConfig(process.env.DATABASE_URL);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: pool.connectionString,
    ssl: pool.ssl,
  },
});
