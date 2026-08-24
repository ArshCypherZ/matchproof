import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export function createDatabase(
  connectionString = process.env.DATABASE_URL ??
    "postgres://incident:incident@localhost:9998/incident_commander",
) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}
