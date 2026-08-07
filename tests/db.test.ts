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

});
