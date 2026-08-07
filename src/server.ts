import { AppDatabase } from "./db.ts";
import { AuthService } from "./auth.ts";
import { CloudflareClient, CloudflareError } from "./cloudflare/client.ts";
import { ConnectorManager } from "./connector/manager.ts";
import { testOrigin } from "./mappings/health.ts";
import { MappingService } from "./mappings/service.ts";
import type { JsonObject, MappingInput } from "./types.ts";

export interface AppOptions { database?: AppDatabase; cloudflareBaseUrl?: string; connector?: ConnectorManager }

export function createApp(options: AppOptions = {}): { fetch(request: Request): Promise<Response>; db: AppDatabase; connector: ConnectorManager } {
  const db = options.database ?? new AppDatabase();
  const auth = new AuthService(db);
  const cloudflare = (token = db.getSetting("cloudflare_api_token")) => new CloudflareClient(token ?? "", options.cloudflareBaseUrl);
  const connector = options.connector ?? new ConnectorManager(() => db.settings());
  const mappings = new MappingService(db, cloudflare);

  async function bindToken(accountId: string, token: string): Promise<JsonObject> {
    const client = cloudflare(token);
    await client.verify();
    const [tunnels, zones] = await Promise.all([client.tunnels(accountId), client.zones(accountId)]);
    if (!zones.length) throw new HttpError(400, "至少需要一个可访问的活动区域，才能验证 DNS 读取权限");
    await Promise.all(zones.map((zone) => client.dnsRecords(cloudflareId(zone.id, "Zone ID"), { per_page: "1" })));
    const previousAccountId = db.getSetting("account_id");
    const accountChanged = Boolean(previousAccountId && previousAccountId !== accountId);
    if (accountChanged) { await connector.stop(); db.clearCloudflareBinding(); }
    db.setSettings({ cloudflare_api_token: token, account_id: accountId, ...(accountChanged || !previousAccountId ? { setup_completed: "false" } : {}) });
    return { verified: true, accountId, accountChanged, zoneCount: zones.length, tunnelCount: tunnels.length, checks: { token: true, tunnelRead: true, zoneRead: true, dnsRead: true } };
  }

  async function fetchHandler(request: Request): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname; const method = request.method;
    try {
      if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
      if (path === "/api/status" && method === "GET") return json({ ok: true, authConfigured: auth.configured(), setupCompleted: db.getSetting("setup_completed") === "true", connector: connector.snapshot() });
      if (path === "/api/auth/setup" && method === "POST") {
        assertSameOrigin(request); const body = await bodyObject(request); await auth.initialize(string(body.username), string(body.password));
        return json({ configured: true }, 201);
      }
      if (path === "/api/auth/login" && method === "POST") {
        assertSameOrigin(request); const body = await bodyObject(request); const result = await auth.login(string(body.username), string(body.password));
        return json({ authenticated: true, expiresAt: result.expiresAt }, 200, { "Set-Cookie": result.cookie });
      }
      if (path === "/api/auth/logout" && method === "POST") {
        assertSameOrigin(request); return json({ authenticated: false }, 200, { "Set-Cookie": auth.logout(request) });
      }

      const session = auth.authenticate(request);
      if (!session) return json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, 401);
      if (method !== "GET" && method !== "HEAD") assertSameOrigin(request);
      if (path === "/api/auth/me" && method === "GET") return json({ authenticated: true, username: session.username });

      if (path === "/api/setup" && method === "GET") return json(publicSetup(db));
      if (path === "/api/setup/token" && method === "POST") {
        const body = await bodyObject(request); const token = string(body.token); const accountId = cloudflareId(body.accountId, "Account ID");
        return json(await bindToken(accountId, token));
      }
      if (path === "/api/setup/tunnel" && method === "POST") {
        const body = await bodyObject(request); const accountId = requiredSetting(db, "account_id"); const tunnelId = string(body.tunnelId);
        const tunnel = (await cloudflare().tunnels(accountId)).find((item) => item.id === tunnelId && item.config_src === "cloudflare");
        if (!tunnel) throw new HttpError(400, "请选择远程托管的 Tunnel");
        const token = await cloudflare().tunnelToken(accountId, tunnelId);
        db.setSettings({ tunnel_id: tunnelId, tunnel_name: string(tunnel.name), tunnel_token: token });
        const sync = await mappings.sync(); return json({ tunnel, sync });
      }
      if (path === "/api/setup/complete" && method === "POST") {
        for (const key of ["cloudflare_api_token", "account_id", "tunnel_id", "tunnel_token"]) requiredSetting(db, key);
        const body = await optionalBody(request); const autoStart = body.connectorAutoStart !== false;
        db.setSettings({ setup_completed: "true", connector_auto_start: String(autoStart) });
        if (autoStart) await connector.start(); return json({ completed: true, connector: connector.snapshot() });
      }

      if (path === "/api/cloudflare/zones" && method === "GET") return json({ zones: (await cloudflare().zones(requiredSetting(db, "account_id"))).filter((zone) => !zone.status || zone.status === "active") });
      if (path === "/api/cloudflare/tunnels" && method === "GET") return json({ tunnels: await cloudflare().tunnels(requiredSetting(db, "account_id")) });
      if (path === "/api/cloudflare/tunnels" && method === "POST") {
        const body = await bodyObject(request); const name = string(body.name).trim(); if (!/^[A-Za-z0-9_. -]{1,100}$/.test(name)) throw new HttpError(400, "Tunnel 名称格式无效");
        return json({ tunnel: await cloudflare().createTunnel(requiredSetting(db, "account_id"), name) }, 201);
      }

      if (path === "/api/settings/credentials" && method === "PUT") {
        const body = await bodyObject(request);
        await auth.update(string(body.username), string(body.currentPassword), string(body.password));
        return json({ updated: true }, 200, { "Set-Cookie": auth.logout(request) });
      }
      if (path === "/api/settings/token" && method === "PUT") {
        const body = await bodyObject(request); const token = string(body.token); const accountId = cloudflareId(body.accountId, "Account ID");
        return json({ updated: true, ...await bindToken(accountId, token) });
      }
      if (path === "/api/settings" && method === "GET") return json(connectorSettings(db));
      if (path === "/api/settings" && method === "PUT") {
        const body = await bodyObject(request);
        const autoStart = boolean(body.connector_auto_start, "connector_auto_start");
        const protocol = choice(body.connector_protocol, "connector_protocol", ["auto", "quic", "http2"]);
        const edgeIpVersion = choice(body.connector_edge_ip_version, "connector_edge_ip_version", ["auto", "4", "6"]);
        db.setSettings({ connector_auto_start: String(autoStart), connector_protocol: protocol, connector_edge_ip_version: edgeIpVersion });
        return json({ updated: true, ...connectorSettings(db), connector: connector.snapshot() });
      }

      if (path === "/api/connector" && method === "GET") return json(connector.snapshot());
      if (path === "/api/connector/start" && method === "POST") { return json(await connector.start()); }
      if (path === "/api/connector/stop" && method === "POST") { return json(await connector.stop()); }
      if (path === "/api/connector/restart" && method === "POST") { return json(await connector.restart()); }
      if (path === "/api/connector/logs" && method === "GET") return json({ logs: connector.recentLogs(numberParam(url, "limit", 200)) });
      if (path === "/api/connector/events" && method === "GET") return connectorEvents(connector, request.signal);

      if (path === "/api/mappings" && method === "GET") return json({ mappings: db.listMappings() });
      if (path === "/api/mappings/sync" && method === "POST") return json(await mappings.sync());
      if (path === "/api/mappings/test" && method === "POST") {
        const input = await mappingBody(request); const accountId = requiredSetting(db, "account_id");
        const zone = (await cloudflare().zones(accountId)).find((item) => item.id === input.zoneId);
        if (!zone) throw new HttpError(400, "当前账户无法访问所选区域");
        return json(await testOrigin(input, string(zone.name)));
      }
      if (path === "/api/mappings" && method === "POST") return json(await mappings.create(await mappingBody(request)), 201);
      const mappingMatch = path.match(/^\/api\/mappings\/([0-9a-f-]{36})$/i);
      if (mappingMatch?.[1] && method === "PUT") return json(await mappings.update(mappingMatch[1], await mappingBody(request)));
      if (mappingMatch?.[1] && method === "DELETE") {
        const body = await optionalBody(request); return json(await mappings.remove(mappingMatch[1], { ingress: booleanOption(body.ingress), dns: booleanOption(body.dns) }));
      }
      if (path === "/api/operations" && method === "GET") return json({ operations: db.operations(numberParam(url, "limit", 50)) });
      const operationMatch = path.match(/^\/api\/operations\/([0-9a-f-]{36})$/i);
      if (operationMatch?.[1] && method === "GET") {
        const operation = db.operation(operationMatch[1]);
        return operation ? json(operation) : json({ error: { code: "NOT_FOUND", message: "操作记录不存在" } }, 404);
      }
      return json({ error: { code: "NOT_FOUND", message: "请求的接口不存在" } }, 404);
    } catch (error) { return errorResponse(error); }
  }

  return { fetch: fetchHandler, db, connector };
}

function connectorEvents(connector: ConnectorManager, signal: AbortSignal): Response {
  const encoder = new TextEncoder(); let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      for (const log of connector.recentLogs(100)) send("log", log);
      unsubscribe = connector.subscribe(send);
      const heartbeat = setInterval(() => send("ping", { timestamp: new Date().toISOString() }), 15_000);
      signal.addEventListener("abort", () => { clearInterval(heartbeat); unsubscribe(); try { controller.close(); } catch {} }, { once: true });
    }, cancel() { unsubscribe(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

function publicSetup(db: AppDatabase): JsonObject {
  const settings = db.settings();
  return { tokenConfigured: Boolean(settings.cloudflare_api_token), accountId: settings.account_id ?? null, tunnelId: settings.tunnel_id ?? null, tunnelName: settings.tunnel_name ?? null, tunnelTokenConfigured: Boolean(settings.tunnel_token), completed: settings.setup_completed === "true", connectorAutoStart: settings.connector_auto_start === "true", connectorProtocol: settings.connector_protocol ?? "auto", connectorEdgeIpVersion: settings.connector_edge_ip_version ?? "auto" };
}

function connectorSettings(db: AppDatabase): JsonObject {
  return { connector_auto_start: db.getSetting("connector_auto_start") === "true", connector_protocol: db.getSetting("connector_protocol") ?? "auto", connector_edge_ip_version: db.getSetting("connector_edge_ip_version") ?? "auto" };
}

async function bodyObject(request: Request): Promise<JsonObject> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new HttpError(415, "请求内容类型必须是 application/json");
  try { const body = await request.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); return body as JsonObject; }
  catch { throw new HttpError(400, "请求中的 JSON 数据格式无效"); }
}
async function optionalBody(request: Request): Promise<JsonObject> { return request.headers.get("content-length") === "0" || !request.body ? {} : bodyObject(request); }
async function mappingBody(request: Request): Promise<MappingInput> { return await bodyObject(request) as unknown as MappingInput; }
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new HttpError(400, "缺少必填字段"); return value; }
function cloudflareId(value: unknown, label: string): string { const result = string(value).trim(); if (!/^[A-Za-z0-9_-]{16,64}$/.test(result)) throw new HttpError(400, `${label} 无效`); return result; }
function requiredSetting(db: AppDatabase, key: string): string { const value = db.getSetting(key); if (!value) throw new HttpError(409, `配置项 ${key} 尚未设置`); return value; }
function booleanOption(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function boolean(value: unknown, label: string): boolean { if (typeof value !== "boolean") throw new HttpError(400, `${label} 必须是布尔值`); return value; }
function choice<T extends string>(value: unknown, label: string, choices: readonly T[]): T { if (typeof value !== "string" || !choices.includes(value as T)) throw new HttpError(400, `${label} 无效`); return value as T; }
function numberParam(url: URL, name: string, fallback: number): number { const value = Number(url.searchParams.get(name) ?? fallback); return Number.isFinite(value) ? value : fallback; }
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin"); if (!origin) return;
  const expected = new URL(request.url).origin; if (origin !== expected) throw new HttpError(403, "已拒绝跨域请求");
}
function corsHeaders(request: Request): Record<string, string> { const origin = request.headers.get("origin"); return origin === new URL(request.url).origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" } : {}; }
function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response { return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } }); }

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: { code: "BAD_REQUEST", message: error.message } }, error.status);
  if (error instanceof CloudflareError) return json({ error: { code: "CLOUDFLARE_ERROR", message: error.message, details: error.errors } }, 502);
  const message = error instanceof Error ? error.message : "服务器内部错误";
  const expected = /不存在|无效|必须|需要|尚未|已经|初始化|不能|错误|失败|冲突|修改|配置|超时|区域|域名|端口|协议|密码|用户名|Token/i.test(message);
  return json({ error: { code: expected ? "INVALID_OPERATION" : "INTERNAL_ERROR", message: expected ? message : "服务器内部错误" } }, expected ? 400 : 500);
}
