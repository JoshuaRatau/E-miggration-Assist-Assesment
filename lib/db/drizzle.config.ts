import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const parsed = new URL(process.env.DATABASE_URL);

// Honour an explicit `sslmode=disable` (Replit's local `helium` dev DB does not
// support SSL). Any other environment (e.g. production) keeps SSL enabled with
// certificate verification relaxed.
const sslDisabled = parsed.searchParams.get("sslmode") === "disable";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/*.ts"),
  dialect: "postgresql",
  dbCredentials: {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
  },
});
