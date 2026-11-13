/**
 * 測試用的 D1：以 Node 內建的 node:sqlite 實作 D1 介面中本專案用到的部分，
 * 並套用 migrations/ 裡真正的 SQL。這是 D1 的替身，不是 D1 本身；
 * 真正的 D1 行為由 `npm run smoke`（wrangler dev 的本機 D1）驗證。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params as SQLInputValue[]);
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })) as T[], success: true, meta: {} };
  }
  async first<T>() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row ? { ...row } : null) as T | null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  }
}

export function createTestDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = join(fileURLToPath(import.meta.url), "../../migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
