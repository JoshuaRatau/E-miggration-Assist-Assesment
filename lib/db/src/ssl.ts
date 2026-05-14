import fs from "node:fs";
import type { ConnectionOptions } from "node:tls";

/**
 * Build the right `ssl` value for a `pg` Pool / drizzle-kit dbCredentials,
 * given a Postgres connection string.
 *
 * Decision tree:
 *   1. Local dev (`localhost` / `127.0.0.1`) → SSL off entirely.
 *   2. `DATABASE_SSL_CA` env var set → strict verification using that CA.
 *      Value can be either a PEM literal (starts with `-----BEGIN`) or a
 *      filesystem path. This is the production-recommended path for AWS RDS.
 *   3. `DATABASE_SSL_REJECT_UNAUTHORIZED=false` → operator escape hatch.
 *   4. Host ends in `.rds.amazonaws.com` → SSL on but `rejectUnauthorized:false`.
 *      AWS RDS uses its own CA bundle that Node's default trust store doesn't
 *      know about. Without `DATABASE_SSL_CA` we can't verify the chain, but we
 *      still want encryption-in-transit. Operators are expected to harden this
 *      by setting `DATABASE_SSL_CA` once they've downloaded the AWS CA bundle.
 *   5. Anything else (Replit-managed Postgres, Neon, Supabase, etc.) → SSL on
 *      with strict verification. These providers all have publicly-trusted
 *      certs, so Node's default trust store handles them fine.
 */
export function buildPgSslConfig(
  connectionString: string,
): false | ConnectionOptions {
  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return { rejectUnauthorized: true };
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return false;
  }

  if (process.env.DATABASE_SSL_CA) {
    const raw = process.env.DATABASE_SSL_CA;
    const ca = raw.trimStart().startsWith("-----BEGIN")
      ? raw
      : fs.readFileSync(raw, "utf8");
    return { rejectUnauthorized: true, ca };
  }

  if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false") {
    return { rejectUnauthorized: false };
  }

  if (hostname.endsWith(".rds.amazonaws.com")) {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}

/**
 * Strip `sslmode`, `ssl`, and `sslrootcert` query params from a Postgres
 * connection string.
 *
 * Why: pg v8.18+ upgrades `sslmode=require` to `verify-full` automatically
 * (see the "SECURITY WARNING" emitted on first connect). When both a URL
 * sslmode AND an explicit `ssl` option are passed to a Pool, the URL value
 * can override the explicit option — silently breaking RDS connections
 * because RDS's CA isn't in Node's default trust store.
 *
 * The fix is to remove ssl-related query params from the URL so the explicit
 * `ssl` option from `buildPgSslConfig()` is the single source of truth.
 */
export function stripSslParamsFromUrl(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }

  let mutated = false;
  for (const key of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      mutated = true;
    }
  }

  return mutated ? url.toString() : connectionString;
}

/**
 * One-stop helper: returns a `{ connectionString, ssl }` pair safe to spread
 * into a `pg.Pool` config or `pg-boss`'s constructor. The connection string
 * has any ssl-related query params stripped, and `ssl` is the value from
 * `buildPgSslConfig()`.
 */
export function buildPgPoolConfig(connectionString: string): {
  connectionString: string;
  ssl: false | ConnectionOptions;
} {
  return {
    connectionString: stripSslParamsFromUrl(connectionString),
    ssl: buildPgSslConfig(connectionString),
  };
}
