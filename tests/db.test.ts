import { afterEach, describe, expect, test } from "bun:test";
import { AppDatabase } from "../src/db.ts";

let db: AppDatabase | undefined;
afterEach(() => db?.close());

describe("database schema", () => {
  test("creates required tables and persists settings and sessions", () => {
    db = new AppDatabase(":memory:");
    const tables = (db.sqlite.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(["settings", "admin_sessions", "mappings", "operations"]));
    db.setSettings({ account_id: "account" });
    expect(db.getSetting("account_id")).toBe("account");
    db.createSession("session", "admin", new Date(Date.now() + 60_000).toISOString());
    expect(db.session("session")?.username).toBe("admin");
    expect((db.sqlite.query("PRAGMA wal_autocheckpoint").get() as { wal_autocheckpoint: number }).wal_autocheckpoint).toBe(64);
    expect((db.sqlite.query("PRAGMA journal_size_limit").get() as { journal_size_limit: number }).journal_size_limit).toBe(524288);
  });

  test("uses a requested operation id for exact progress tracking", () => {
    db = new AppDatabase(":memory:");
    const operationId = crypto.randomUUID();
    expect(db.createOperation("create_mapping", undefined, operationId)).toBe(operationId);
    expect(db.operation(operationId)).toMatchObject({ id: operationId, stage: "validate", status: "running" });
  });

  test("creates the current mapping schema without Access columns", () => {
    db = new AppDatabase(":memory:");
    const columns = (db.sqlite.query("PRAGMA table_info(mappings)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toContain("zone_name");
    expect(columns).toContain("raw_rule_json");
    expect(columns).not.toContain("access_app_id");
  });

  test("bounds operation records by count and stored bytes", () => {
    db = new AppDatabase(":memory:");
    for (let index = 0; index < 550; index++) {
      const id = db.createOperation(`operation-${index}`);
      db.updateOperation(id, "complete", "succeeded", "错".repeat(5000), { payload: "x".repeat(50_000) });
    }
    const result = db.sqlite.query(`SELECT COUNT(*) AS count, COALESCE(SUM(
      length(CAST(id AS BLOB)) + length(CAST(action AS BLOB)) +
      length(CAST(COALESCE(mapping_id,'') AS BLOB)) + length(CAST(status AS BLOB)) +
      length(CAST(stage AS BLOB)) + length(CAST(COALESCE(message,'') AS BLOB)) +
      length(CAST(COALESCE(details_json,'') AS BLOB)) + length(CAST(created_at AS BLOB)) +
      length(CAST(updated_at AS BLOB))
    ), 0) AS bytes FROM operations`).get() as { count: number; bytes: number };
    expect(result.count).toBeLessThanOrEqual(500);
    expect(result.bytes).toBeLessThanOrEqual(524288);
  });

});
