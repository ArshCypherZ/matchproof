import DatabaseDriver from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { schema } from "./sqlite-schema";

export type SqliteDatabase = BetterSQLite3Database<typeof schema>;
export type SqliteConnection = { db: SqliteDatabase; client: DatabaseDriver.Database };
export function createSqliteDatabase(file: string): SqliteConnection { const client = new DatabaseDriver(file); client.pragma("journal_mode = WAL"); return { db: drizzle(client, { schema }), client }; }
