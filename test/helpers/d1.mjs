// Minimal D1 stand-in for tests, backed by node:sqlite (in-memory) with all migrations applied.
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

// The real D1 returns a BLOB column as an array of numbers: do the same so a handler that forgets to convert fails here.
const plainRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));

class Stmt {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Stmt(this.db, this.sql, params);
  }
  async first(col) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    const plain = plainRow(row);
    return col ? plain[col] : plain;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params).map(plainRow), success: true, meta: {} };
  }
  async run() {
    return this.runSync();
  }
  runSync() {
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql)) {
      return { success: true, results: this.db.prepare(this.sql).all(...this.params).map(plainRow), meta: { changes: 0 } };
    }
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function createTestD1() {
  const db = new DatabaseSync(":memory:");
  const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}
