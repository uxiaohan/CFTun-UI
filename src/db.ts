import { Database } from "bun:sqlite";
import type { AppSettings, MappingRecord } from "./types.ts";

export class AppDatabase {
  readonly sqlite: Database;

  constructor(path = process.env.DATABASE_PATH ?? (process.env.DATA_DIR ? `${process.env.DATA_DIR}/cftun-ui.sqlite` : "./cftun-ui.sqlite")) {
    this.sqlite = new Database(path, { create: true, strict: true });
    this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA wal_autocheckpoint = 64; PRAGMA journal_size_limit = 524288;");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    const version = (this.sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== 0 && version !== 3) throw new Error("数据库结构不兼容，请删除 cftun-ui.sqlite 后重新启动");
    this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS admin_sessions (
            id TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);
          CREATE TABLE IF NOT EXISTS mappings (
            id TEXT PRIMARY KEY, hostname TEXT NOT NULL, path TEXT, target_type TEXT NOT NULL,
            protocol TEXT NOT NULL, target_host TEXT NOT NULL, target_port INTEGER NOT NULL,
            service TEXT NOT NULL, tunnel_id TEXT NOT NULL, zone_id TEXT NOT NULL, zone_name TEXT NOT NULL,
            dns_record_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, options_json TEXT NOT NULL DEFAULT '{}',
            raw_rule_json TEXT NOT NULL DEFAULT '{}', rule_order INTEGER NOT NULL DEFAULT 0,
            sync_status TEXT NOT NULL DEFAULT 'synced', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(tunnel_id, hostname, path)
          );
          CREATE TABLE IF NOT EXISTS operations (
            id TEXT PRIMARY KEY, action TEXT NOT NULL, mapping_id TEXT, status TEXT NOT NULL,
            stage TEXT NOT NULL, message TEXT, details_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS operations_created_idx ON operations(created_at DESC);
          PRAGMA user_version = 3;
        `);
  }

  close(): void { this.sqlite.close(); }

  getSetting(key: keyof AppSettings | string): string | undefined {
    return (this.sqlite.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null)?.value;
  }

  settings(): AppSettings {
    return Object.fromEntries((this.sqlite.query("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
  }

  setSettings(values: Record<string, string>): void {
    const now = new Date().toISOString();
    const insert = this.sqlite.query("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
    this.sqlite.transaction(() => { for (const [key, value] of Object.entries(values)) insert.run(key, value, now); })();
  }

  clearCloudflareBinding(): void {
    const keys = ["cloudflare_api_token", "account_id", "zone_id", "zone_name", "tunnel_id", "tunnel_name", "tunnel_token", "setup_completed"];
    this.sqlite.transaction(() => {
      this.sqlite.query(`DELETE FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`).run(...keys);
      this.sqlite.exec("DELETE FROM mappings; DELETE FROM operations;");
    })();
  }

  createSession(id: string, username: string, expiresAt: string): void {
    const now = new Date().toISOString();
    this.sqlite.query("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
    this.sqlite.query("INSERT INTO admin_sessions VALUES(?,?,?,?,?)").run(id, username, expiresAt, now, now);
  }

  session(id: string): { username: string; expires_at: string } | null {
    const now = new Date().toISOString();
    const row = this.sqlite.query("SELECT username,expires_at FROM admin_sessions WHERE id=? AND expires_at>?").get(id, now) as { username: string; expires_at: string } | null;
    if (row) this.sqlite.query("UPDATE admin_sessions SET last_seen_at=? WHERE id=?").run(now, id);
    return row;
  }

  deleteSession(id: string): void { this.sqlite.query("DELETE FROM admin_sessions WHERE id=?").run(id); }

  listMappings(): MappingRecord[] {
    return (this.sqlite.query("SELECT * FROM mappings ORDER BY rule_order,hostname,path").all() as Record<string, unknown>[]).map(rowToMapping);
  }

  mapping(id: string): MappingRecord | null {
    const row = this.sqlite.query("SELECT * FROM mappings WHERE id=?").get(id) as Record<string, unknown> | null;
    return row ? rowToMapping(row) : null;
  }

  saveMapping(mapping: MappingRecord): void {
    const options = JSON.stringify({ noTLSVerify: mapping.noTLSVerify, originServerName: mapping.originServerName, httpHostHeader: mapping.httpHostHeader });
    this.sqlite.query(`INSERT INTO mappings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET hostname=excluded.hostname,path=excluded.path,target_type=excluded.target_type,
      protocol=excluded.protocol,target_host=excluded.target_host,target_port=excluded.target_port,service=excluded.service,
      tunnel_id=excluded.tunnel_id,zone_id=excluded.zone_id,zone_name=excluded.zone_name,dns_record_id=excluded.dns_record_id,
      enabled=excluded.enabled,options_json=excluded.options_json,raw_rule_json=excluded.raw_rule_json,
      rule_order=excluded.rule_order,sync_status=excluded.sync_status,updated_at=excluded.updated_at`).run(
      mapping.id, mapping.hostname, mapping.path ?? null, mapping.targetType, mapping.protocol, mapping.targetHost,
      mapping.targetPort, mapping.service, mapping.tunnelId, mapping.zoneId, mapping.zoneName, mapping.dnsRecordId,
      Number(mapping.enabled), options, JSON.stringify(mapping.rawRule), mapping.ruleOrder, mapping.syncStatus,
      mapping.createdAt, mapping.updatedAt,
    );
  }

  replaceTunnelMappings(tunnelId: string, mappings: MappingRecord[]): void {
    this.sqlite.transaction(() => {
      this.sqlite.query("DELETE FROM mappings").run();
      for (const mapping of mappings) this.saveMapping(mapping);
    })();
  }

  deleteMapping(id: string): void { this.sqlite.query("DELETE FROM mappings WHERE id=?").run(id); }

  createOperation(action: string, mappingId?: string, requestedId?: string): string {
    const id = requestedId && /^[0-9a-f-]{36}$/i.test(requestedId) ? requestedId : crypto.randomUUID(); const now = new Date().toISOString();
    this.sqlite.query("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)").run(id, action, mappingId ?? null, "running", "validate", null, null, now, now);
    this.pruneOperations();
    return id;
  }

  updateOperation(id: string, stage: string, status = "running", message?: string, details?: unknown): void {
    this.sqlite.query("UPDATE operations SET stage=?,status=?,message=?,details_json=?,updated_at=? WHERE id=?")
      .run(stage, status, boundedText(message, 4096), boundedDetails(details), new Date().toISOString(), id);
    this.pruneOperations();
  }

  operations(limit = 50): unknown[] {
    return this.sqlite.query("SELECT id,action,mapping_id AS mappingId,status,stage,message,details_json AS details,created_at AS createdAt,updated_at AS updatedAt FROM operations ORDER BY created_at DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 200));
  }

  operation(id: string): unknown | null {
    return this.sqlite.query("SELECT id,action,mapping_id AS mappingId,status,stage,message,details_json AS details,created_at AS createdAt,updated_at AS updatedAt FROM operations WHERE id=?").get(id);
  }

  private pruneOperations(): void {
    this.sqlite.exec(`
      DELETE FROM operations WHERE id IN (
        SELECT id FROM operations ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 500
      );
      WITH sized AS (
        SELECT id, SUM(
          length(CAST(id AS BLOB)) + length(CAST(action AS BLOB)) +
          length(CAST(COALESCE(mapping_id,'') AS BLOB)) + length(CAST(status AS BLOB)) +
          length(CAST(stage AS BLOB)) + length(CAST(COALESCE(message,'') AS BLOB)) +
          length(CAST(COALESCE(details_json,'') AS BLOB)) + length(CAST(created_at AS BLOB)) +
          length(CAST(updated_at AS BLOB))
        ) OVER (ORDER BY created_at DESC, rowid DESC) AS bytes
        FROM operations
      )
      DELETE FROM operations WHERE id IN (SELECT id FROM sized WHERE bytes > 524288);
    `);
  }
}

function boundedText(value: string | undefined, maxBytes: number): string | null {
  if (value === undefined) return null;
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  const suffix = "…[已截断]"; let prefix = new TextDecoder().decode(bytes.slice(0, maxBytes - 16));
  while (prefix && new TextEncoder().encode(prefix + suffix).byteLength > maxBytes) prefix = prefix.slice(0, -1);
  return prefix + suffix;
}
function boundedDetails(value: unknown): string | null {
  if (value === undefined) return null;
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).byteLength <= 32768 ? json : '{"truncated":true}';
}

function rowToMapping(row: Record<string, unknown>): MappingRecord {
  const options = JSON.parse(String(row.options_json ?? "{}")) as Partial<MappingRecord>;
  return {
    id: String(row.id), hostname: String(row.hostname), path: row.path === null ? null : String(row.path),
    targetType: row.target_type as "host" | "lan", protocol: row.protocol as "http" | "https",
    targetHost: String(row.target_host), targetPort: Number(row.target_port), service: String(row.service),
    tunnelId: String(row.tunnel_id), zoneId: String(row.zone_id), zoneName: String(row.zone_name), dnsRecordId: row.dns_record_id ? String(row.dns_record_id) : null,
    rawRule: JSON.parse(String(row.raw_rule_json ?? "{}")) as Record<string, unknown>, ruleOrder: Number(row.rule_order),
    syncStatus: row.sync_status as MappingRecord["syncStatus"], enabled: Boolean(row.enabled),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...options,
  };
}
