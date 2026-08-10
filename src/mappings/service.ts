import type { AppDatabase } from "../db.ts";
import { CloudflareClient } from "../cloudflare/client.ts";
import { TunnelConfigService } from "../cloudflare/tunnel-config.ts";
import type { JsonObject, MappingInput, MappingRecord } from "../types.ts";
import { validateMapping } from "./target.ts";

interface Zone { id: string; name: string }

export class MappingService {
  constructor(private readonly db: AppDatabase, private readonly cloudflare: () => CloudflareClient) {}

  async create(input: MappingInput): Promise<{ mapping: MappingRecord; operationId: string }> {
    return this.apply(input);
  }

  async update(id: string, input: MappingInput): Promise<{ mapping: MappingRecord; operationId: string }> {
    const existing = this.db.mapping(id);
    if (!existing) throw new Error("映射不存在");
    return this.apply(input, existing);
  }

  async sync(): Promise<{ mappings: MappingRecord[]; imported: number; skipped: number; dnsLinked: number }> {
    const settings = requireCloudflareSettings(this.db);
    const result = await this.readRemote(settings.accountId, settings.tunnelId);
    this.db.replaceTunnelMappings(settings.tunnelId, result.mappings);
    return result;
  }

  async readRemote(accountId: string, tunnelId: string): Promise<{ mappings: MappingRecord[]; imported: number; skipped: number; dnsLinked: number }> {
    const cf = this.cloudflare();
    const [configuration, zones] = await Promise.all([cf.tunnelConfig(accountId, tunnelId), this.accountZones(cf, accountId)]);
    const ingress = configuration.config?.ingress ?? [];
    const previous = new Map(this.db.listMappings().filter((item) => item.tunnelId === tunnelId).map((item) => [mappingKey(item.hostname, item.path), item]));
    const now = new Date().toISOString();
    const mappings: MappingRecord[] = [];
    const dnsByZone = new Map<string, JsonObject[]>();
    let skipped = 0;

    for (const [ruleOrder, value] of ingress.entries()) {
      const rule = structuredClone(value);
      const hostname = typeof rule.hostname === "string" ? normalizeHostname(rule.hostname) : "";
      const service = typeof rule.service === "string" ? rule.service : "";
      const parsed = parseHttpService(service);
      const zone = hostname && parsed ? longestZoneMatch(hostname, zones) : undefined;
      if (!hostname || !parsed || !zone) { skipped++; continue; }
      const path = typeof rule.path === "string" ? rule.path : null;
      let records = dnsByZone.get(zone.id);
      if (!records) { records = await cf.dnsRecords(zone.id, { type: "CNAME" }); dnsByZone.set(zone.id, records); }
      const dns = records.find((record) => dnsPointsToTunnel(record, hostname, tunnelId));
      const old = previous.get(mappingKey(hostname, path));
      const origin = rule.originRequest && typeof rule.originRequest === "object" && !Array.isArray(rule.originRequest) ? rule.originRequest as JsonObject : {};
      mappings.push({
        id: old?.id ?? crypto.randomUUID(), zoneId: zone.id, zoneName: zone.name, hostname, path,
        targetType: isLoopback(parsed.host) ? "host" : "lan", protocol: parsed.protocol, targetHost: parsed.host,
        targetPort: parsed.port, noTLSVerify: origin.noTLSVerify === true,
        originServerName: typeof origin.originServerName === "string" ? origin.originServerName : undefined,
        httpHostHeader: typeof origin.httpHostHeader === "string" ? origin.httpHostHeader : undefined,
        service, tunnelId, dnsRecordId: dns ? String(dns.id) : null,
        rawRule: rule, ruleOrder, syncStatus: dns ? "synced" : "error", enabled: true,
        createdAt: old?.createdAt ?? now, updatedAt: now,
      });
    }
    return { mappings, imported: mappings.length, skipped, dnsLinked: mappings.filter((item) => item.dnsRecordId).length };
  }

  async remove(id: string, options: { ingress?: boolean; dns?: boolean } = {}): Promise<{ operationId: string; dnsDeleted: boolean }> {
    const mapping = this.db.mapping(id);
    if (!mapping) throw new Error("映射不存在");
    if (!mapping.hostname) throw new Error("默认兜底规则不能作为普通映射管理");
    const operationId = this.db.createOperation("delete_mapping", id);
    const settings = requireCloudflareSettings(this.db); const cf = this.cloudflare();
    let dnsDeleted = false;
    try {
      if (options.ingress !== false) {
        this.db.updateOperation(operationId, "ingress");
        await new TunnelConfigService(cf).mutate(settings.accountId, mapping.tunnelId, { type: "delete", hostname: mapping.hostname, path: mapping.path });
      }
      if (options.dns !== false && mapping.dnsRecordId) {
        this.db.updateOperation(operationId, "dns");
        dnsDeleted = await this.deleteDnsIfOwned(cf, mapping);
      }
      this.db.updateOperation(operationId, "database"); this.db.deleteMapping(id);
      this.db.updateOperation(operationId, "complete", "succeeded", "Mapping deleted", { dnsDeleted });
      return { operationId, dnsDeleted };
    } catch (error) {
      this.db.updateOperation(operationId, "failed", "failed", errorMessage(error)); throw error;
    }
  }

  private async apply(input: MappingInput, existing?: MappingRecord): Promise<{ mapping: MappingRecord; operationId: string }> {
    const settings = requireCloudflareSettings(this.db); const cf = this.cloudflare();
    const zone = await this.requireZone(cf, settings.accountId, input.zoneId);
    const target = validateMapping({ ...input, zoneName: zone.name, rawRule: input.rawRule ?? existing?.rawRule }, zone.name);
    const operationId = this.db.createOperation(existing ? "update_mapping" : "create_mapping", existing?.id, input.operationId);
    const tunnelConfig = new TunnelConfigService(cf);
    let dnsRecordId = existing?.dnsRecordId ?? null;
    try {
      const moved = existing && (existing.zoneId !== zone.id || existing.hostname !== target.input.hostname);
      const ruleChanged = existing && (existing.hostname !== target.input.hostname || String(existing.path ?? "") !== String(target.input.path ?? ""));
      if (ruleChanged) {
        this.db.updateOperation(operationId, "old_ingress");
        await tunnelConfig.mutate(settings.accountId, existing.tunnelId, { type: "delete", hostname: existing.hostname, path: existing.path });
      }
      this.db.updateOperation(operationId, "ingress");
      if (input.enabled !== false) await tunnelConfig.mutate(settings.accountId, settings.tunnelId, { type: "upsert", rule: target.rule, ruleOrder: input.ruleOrder ?? existing?.ruleOrder });
      else if (existing && !ruleChanged) await tunnelConfig.mutate(settings.accountId, existing.tunnelId, { type: "delete", hostname: existing.hostname, path: existing.path });

      this.db.updateOperation(operationId, "dns");
      if (moved && existing) { await this.deleteDnsIfOwned(cf, existing); dnsRecordId = null; }
      if (input.enabled !== false) dnsRecordId = await this.ensureDns(cf, zone.id, target.input.hostname, settings.tunnelId, dnsRecordId);

      const now = new Date().toISOString();
      const mapping: MappingRecord = {
        ...target.input, id: existing?.id ?? crypto.randomUUID(), zoneId: zone.id, zoneName: zone.name,
        targetHost: target.targetHost, service: target.service, tunnelId: settings.tunnelId, dnsRecordId,
        rawRule: target.rule, ruleOrder: input.ruleOrder ?? existing?.ruleOrder ?? 0, syncStatus: "synced",
        enabled: input.enabled !== false, createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
      this.db.updateOperation(operationId, "database"); this.db.saveMapping(mapping);
      this.db.updateOperation(operationId, "complete", "succeeded", "Mapping applied");
      return { mapping, operationId };
    } catch (error) {
      this.db.updateOperation(operationId, "failed", "failed", errorMessage(error), { dnsRecordId }); throw error;
    }
  }

  private async accountZones(cf: CloudflareClient, accountId: string): Promise<Zone[]> {
    return (await cf.zones(accountId)).flatMap((item) => typeof item.id === "string" && typeof item.name === "string" ? [{ id: item.id, name: normalizeHostname(item.name) }] : []);
  }

  private async requireZone(cf: CloudflareClient, accountId: string, zoneId: string): Promise<Zone> {
    if (!zoneId) throw new Error("请选择 Cloudflare 区域");
    const zone = (await this.accountZones(cf, accountId)).find((item) => item.id === zoneId);
    if (!zone) throw new Error("当前账户无法访问所选区域");
    return zone;
  }

  private async ensureDns(cf: CloudflareClient, zoneId: string, hostname: string, tunnelId: string, knownId: string | null): Promise<string> {
    const body = { type: "CNAME", name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true, ttl: 1, comment: "Managed by CFTun-UI" };
    if (knownId) {
      const records = await cf.dnsRecords(zoneId, { type: "CNAME", "name.exact": hostname, match: "all" });
      if (records.some((record) => String(record.id) === knownId && dnsPointsToTunnel(record, hostname, tunnelId))) return String((await cf.updateDns(zoneId, knownId, body)).id);
      knownId = null;
    }
    const records = await cf.dnsRecords(zoneId, { "name.exact": hostname, match: "all" });
    if (records.some((record) => !dnsPointsToTunnel(record, hostname, tunnelId))) throw new Error("该域名已有 DNS 记录，并且没有指向当前 Tunnel");
    const owned = records.find((record) => dnsPointsToTunnel(record, hostname, tunnelId));
    try {
      return String(owned ? (await cf.updateDns(zoneId, String(owned.id), body)).id : (await cf.createDns(zoneId, body)).id);
    } catch (error) {
      if (owned) throw error;
      const retry = await cf.dnsRecords(zoneId, { "name.exact": hostname, match: "all" });
      const conflict = retry.find((record) => dnsPointsToTunnel(record, hostname, tunnelId));
      if (conflict) return String((await cf.updateDns(zoneId, String(conflict.id), body)).id);
      throw error;
    }
  }

  private async deleteDnsIfOwned(cf: CloudflareClient, mapping: MappingRecord): Promise<boolean> {
    if (!mapping.dnsRecordId) return false;
    const records = await cf.dnsRecords(mapping.zoneId, { type: "CNAME", "name.exact": mapping.hostname, match: "all" });
    const record = records.find((item) => String(item.id) === mapping.dnsRecordId);
    if (!record || !dnsPointsToTunnel(record, mapping.hostname, mapping.tunnelId)) return false;
    await cf.deleteDns(mapping.zoneId, mapping.dnsRecordId); return true;
  }
}

function requireCloudflareSettings(db: AppDatabase): { accountId: string; tunnelId: string } {
  const values = { accountId: db.getSetting("account_id"), tunnelId: db.getSetting("tunnel_id") };
  if (!values.accountId || !values.tunnelId) throw new Error("Cloudflare 配置尚未完成");
  return values as { accountId: string; tunnelId: string };
}
function longestZoneMatch(hostname: string, zones: Zone[]): Zone | undefined {
  return zones.filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
}
function parseHttpService(service: string): { protocol: "http" | "https"; host: string; port: number } | null {
  try {
    const url = new URL(service);
    if (url.protocol !== "http:" && url.protocol !== "https:" || !url.hostname) return null;
    return { protocol: url.protocol.slice(0, -1) as "http" | "https", host: url.hostname, port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80 };
  } catch { return null; }
}
function dnsPointsToTunnel(record: JsonObject, hostname: string, tunnelId: string): boolean {
  return record.type === "CNAME" && normalizeHostname(String(record.name ?? "")) === normalizeHostname(hostname)
    && normalizeHostname(String(record.content ?? "")) === `${tunnelId.toLowerCase()}.cfargotunnel.com`;
}
function normalizeHostname(value: string): string { return value.trim().toLowerCase().replace(/\.$/, ""); }
function mappingKey(hostname: string, path?: string | null): string { return `${normalizeHostname(hostname)}\n${path ?? ""}`; }
function isLoopback(host: string): boolean { return host === "localhost" || host === "127.0.0.1" || host === "::1"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
