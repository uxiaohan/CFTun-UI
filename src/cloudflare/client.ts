import type { JsonObject } from "../types.ts";

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
  result_info?: { page?: number; total_pages?: number };
}

export class CloudflareError extends Error {
  constructor(message: string, readonly status: number, readonly errors: unknown[] = []) { super(message); }
}

export class CloudflareClient {
  constructor(readonly token: string, private readonly baseUrl = "https://api.cloudflare.com/client/v4") {
    if (!token) throw new Error("Cloudflare API Token 尚未配置");
  }

  async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) { throw new CloudflareError(cloudflareNetworkMessage(error), 504); }
    let envelope: CloudflareEnvelope<T>;
    try { envelope = await response.json() as CloudflareEnvelope<T>; }
    catch { throw new CloudflareError(`Cloudflare API 返回了无效响应（状态码 ${response.status}）`, response.status); }
    if (!response.ok || !envelope.success) {
      const message = cloudflareMessage(response.status, envelope.errors);
      throw new CloudflareError(message, response.status, envelope.errors);
    }
    return envelope.result;
  }

  async list<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T[]> {
    const output: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const url = new URL(`${this.baseUrl}${path}`);
      for (const [key, value] of Object.entries({ ...query, page: String(page), per_page: "100" })) if (value !== undefined) url.searchParams.set(key, value);
      let response: Response;
      try { response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
      catch (error) { throw new CloudflareError(cloudflareNetworkMessage(error), 504); }
      const envelope = await response.json() as CloudflareEnvelope<T[]>;
      if (!response.ok || !envelope.success) throw new CloudflareError(cloudflareMessage(response.status, envelope.errors), response.status, envelope.errors);
      output.push(...envelope.result);
      if (!envelope.result_info?.total_pages || page >= envelope.result_info.total_pages) return output;
    }
    throw new CloudflareError("Cloudflare 分页数据超过 100 页，请缩小查询范围", 500);
  }

  verify(): Promise<JsonObject> { return this.request("GET", "/user/tokens/verify"); }
  zones(accountId?: string): Promise<JsonObject[]> { return this.list("/zones", { ...(accountId ? { "account.id": accountId } : {}), status: "active" }); }
  tunnels(accountId: string): Promise<JsonObject[]> { return this.list(`/accounts/${id(accountId)}/tunnels`, { is_deleted: "false", tun_types: "cfd_tunnel" }); }
  createTunnel(accountId: string, name: string): Promise<JsonObject> { return this.request("POST", `/accounts/${id(accountId)}/cfd_tunnel`, { name, config_src: "cloudflare" }); }
  tunnelToken(accountId: string, tunnelId: string): Promise<string> { return this.request("GET", `/accounts/${id(accountId)}/cfd_tunnel/${id(tunnelId)}/token`); }
  tunnelConfig(accountId: string, tunnelId: string): Promise<TunnelConfiguration> { return this.request("GET", `/accounts/${id(accountId)}/cfd_tunnel/${id(tunnelId)}/configurations`); }
  updateTunnelConfig(accountId: string, tunnelId: string, config: JsonObject): Promise<TunnelConfiguration> { return this.request("PUT", `/accounts/${id(accountId)}/cfd_tunnel/${id(tunnelId)}/configurations`, { config }); }
  dnsRecords(zoneId: string, query: Record<string, string> = {}): Promise<JsonObject[]> { return this.list(`/zones/${id(zoneId)}/dns_records`, query); }
  createDns(zoneId: string, body: JsonObject): Promise<JsonObject> { return this.request("POST", `/zones/${id(zoneId)}/dns_records`, body); }
  updateDns(zoneId: string, recordId: string, body: JsonObject): Promise<JsonObject> { return this.request("PUT", `/zones/${id(zoneId)}/dns_records/${id(recordId)}`, body); }
  deleteDns(zoneId: string, recordId: string): Promise<JsonObject> { return this.request("DELETE", `/zones/${id(zoneId)}/dns_records/${id(recordId)}`); }
}

export interface TunnelConfiguration extends JsonObject {
  version?: number;
  config?: JsonObject & { ingress?: JsonObject[] };
}

function id(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Cloudflare 资源 ID 无效");
  return encodeURIComponent(value);
}

function cloudflareMessage(status: number, errors?: Array<{ code?: number; message?: string }>): string {
  if (status === 401) return "Cloudflare API Token 无效";
  if (status === 403) return "Cloudflare API Token 权限不足";
  if (status === 404) return "Cloudflare 资源不存在，或当前 Token 无权访问";
  if (status === 409) return "Cloudflare 资源发生冲突";
  if (status === 429) return "Cloudflare API 请求过于频繁，请稍后再试";
  if (status >= 500) return "Cloudflare API 暂时不可用，请稍后再试";
  const original = errors?.map((error) => error.message).filter(Boolean).join("；");
  return original ? `Cloudflare 请求失败：${original}` : `Cloudflare 请求失败（状态码 ${status}）`;
}

function cloudflareNetworkMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|abort/i.test(message) ? "连接 Cloudflare API 超时，请稍后再试" : "无法连接 Cloudflare API，请检查网络后重试";
}
