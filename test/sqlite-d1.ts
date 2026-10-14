import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Just enough of D1's API, backed by in-memory SQLite, to run D1Store's real
 * SQL and the real migration in tests.
 */
export function sqliteD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const migration of ["0001_init.sql", "0002_users.sql"]) {
    db.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }

  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...values: unknown[]) {
        params = values;
        return stmt;
      },
      async run() {
        const r = db.prepare(sql).run(...(params as never[]));
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      async all<T>() {
        return { success: true, results: db.prepare(sql).all(...(params as never[])) as T[] };
      },
      async first<T>() {
        return (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}
