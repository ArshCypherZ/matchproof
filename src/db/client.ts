import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export class DatabaseConfigurationError extends Error {}

export function createDatabase(connectionString?: string) {
  const resolved = connectionString ?? process.env.DATABASE_URL;
  if (!resolved)
    throw new DatabaseConfigurationError("DATABASE_URL must be configured");
  const pool = new Pool({ connectionString: resolved });
  return { db: drizzle(pool, { schema }), pool };
}

let sharedConnection: ReturnType<typeof createDatabase> | undefined;

/**
 * One pool per process for request handlers. A pool per request costs a TCP
 * handshake and a Postgres backend on every call, so handlers borrow this
 * connection and never close it. Callers that own a lifecycle (tests,
 * repositories) keep using createDatabase.
 */
export function sharedDatabase(connectionString?: string) {
  sharedConnection ??= createDatabase(connectionString);
  return sharedConnection;
}
