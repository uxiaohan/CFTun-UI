import { afterEach, describe, expect, test } from "bun:test";
import { AppDatabase } from "../src/db.ts";
import { createApp } from "../src/server.ts";

let db: AppDatabase | undefined;
afterEach(() => db?.close());

describe("authentication API", () => {
  test("enforces a minimum password length of 6 characters", async () => {
    db = new AppDatabase(":memory:");
    const app = createApp({ database: db });
    expect((await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "12345" }))).status).toBe(400);
    expect((await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "123456" }))).status).toBe(201);
  });

  test("accepts a one-character username", async () => {
    db = new AppDatabase(":memory:");
    const app = createApp({ database: db });
    expect((await app.fetch(jsonRequest("/api/auth/setup", { username: "a", password: "123456" }))).status).toBe(201);
    expect((await app.fetch(jsonRequest("/api/auth/login", { username: "a", password: "123456" }))).status).toBe(200);
  });

  test("allows the same external host across an HTTPS reverse proxy", async () => {
    db = new AppDatabase(":memory:");
    const app = createApp({ database: db });
    const body = { username: "admin", password: "correct-horse-battery" };

    const crossHost = await app.fetch(externalRequest("POST", "https://evil.example", body));
    expect(crossHost.status).toBe(403);
    expect(await crossHost.json()).toMatchObject({ error: { message: "已拒绝跨域请求" } });

    const malformed = await app.fetch(externalRequest("POST", "not-an-origin", body));
    expect(malformed.status).toBe(403);

    const preflight = await app.fetch(externalRequest("OPTIONS", "https://panel.example.com"));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://panel.example.com");

    const setup = await app.fetch(externalRequest("POST", "https://panel.example.com", body));
    expect(setup.status).toBe(201);
  });

  test("initializes once, issues HttpOnly cookie, and protects API", async () => {
    db = new AppDatabase(":memory:");
    const app = createApp({ database: db });
    const unauthenticated = await app.fetch(new Request("http://localhost/api/setup"));
    expect(unauthenticated.status).toBe(401);

    const setup = await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
    expect(setup.status).toBe(201);
    expect(db.getSetting("admin_password_hash")).not.toContain("correct-horse-battery");

    const repeated = await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "another-long-password" }));
    expect(repeated.status).toBe(400);

    const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const setupStatus = await app.fetch(new Request("http://localhost/api/setup", { headers: { Cookie: cookie.split(";")[0] ?? "" } }));
    expect(setupStatus.headers.get("cache-control")).toBe("no-store");
    expect(await setupStatus.json()).toMatchObject({ tokenConfigured: false, apiToken: null, completed: false });
    const me = await app.fetch(new Request("http://localhost/api/auth/me", { headers: { Cookie: cookie.split(";")[0] ?? "" } }));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ authenticated: true, username: "admin" });

    const updated = await app.fetch(jsonRequest("/api/settings/credentials", {
      username: "new-admin",
      currentPassword: "correct-horse-battery",
      password: "another-long-password",
    }, "PUT", cookie));
    expect(updated.status).toBe(200);
    expect(updated.headers.get("set-cookie")).toContain("Max-Age=0");

    const oldSession = await app.fetch(new Request("http://localhost/api/auth/me", { headers: { Cookie: cookie.split(";")[0] ?? "" } }));
    expect(oldSession.status).toBe(401);
    const newLogin = await app.fetch(jsonRequest("/api/auth/login", { username: "new-admin", password: "another-long-password" }));
    expect(newLogin.status).toBe(200);
  });

  test("validates and saves account id with the Cloudflare API token", async () => {
    db = new AppDatabase(":memory:");
    const accountId = "0123456789abcdef0123456789abcdef";
    const zoneId = "fedcba9876543210fedcba9876543210";
    const mock = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const result = path === "/client/v4/user/tokens/verify" ? { status: "active" }
        : path.endsWith("/tunnels") ? []
        : path === "/client/v4/zones" ? [{ id: zoneId, name: "example.com" }]
        : path.endsWith("/dns_records") ? []
        : null;
      return Response.json({ success: result !== null, result, errors: result === null ? [{ message: "Not found" }] : [], result_info: { page: 1, total_pages: 1 } }, { status: result === null ? 404 : 200 });
    } });
    try {
      const app = createApp({ database: db, cloudflareBaseUrl: `${mock.url}client/v4` });
      await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
      const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
      const cookie = login.headers.get("set-cookie") ?? "";
      const token = await app.fetch(jsonRequest("/api/setup/token", { accountId, token: "cloudflare-api-token" }, "POST", cookie));
      expect(token.status).toBe(200);
      expect(await token.json()).toMatchObject({ verified: true, accountId, zoneCount: 1, checks: { tunnelRead: true, zoneRead: true, dnsRead: true } });
      expect(db.getSetting("account_id")).toBe(accountId);
      expect(db.getSetting("cloudflare_api_token")).toBe("cloudflare-api-token");

      const setupStatus = await app.fetch(new Request("http://localhost/api/setup", { headers: { Cookie: cookie.split(";")[0] ?? "" } }));
      expect(setupStatus.headers.get("cache-control")).toBe("no-store");
      expect(await setupStatus.json()).toMatchObject({ tokenConfigured: true, accountId, apiToken: "cloudflare-api-token" });

      const zones = await app.fetch(new Request("http://localhost/api/cloudflare/zones", { headers: { Cookie: cookie.split(";")[0] ?? "" } }));
      expect(zones.status).toBe(200);
      expect(await zones.json()).toMatchObject({ zones: [{ id: zoneId, name: "example.com" }] });
    } finally { mock.stop(true); }
  });

  test("validates connector settings", async () => {
    db = new AppDatabase(":memory:");
    const app = createApp({ database: db });
    await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
    const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
    const cookie = login.headers.get("set-cookie") ?? "";

    const invalid = await app.fetch(jsonRequest("/api/settings", { connector_auto_start: true, connector_protocol: "udp", connector_edge_ip_version: "4" }, "PUT", cookie));
    expect(invalid.status).toBe(400);
    const saved = await app.fetch(jsonRequest("/api/settings", { connector_auto_start: false, connector_protocol: "http2", connector_edge_ip_version: "6" }, "PUT", cookie));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ connector_auto_start: false, connector_protocol: "http2", connector_edge_ip_version: "6" });
  });

  test("refreshes the connector token when API credentials change in the same account", async () => {
    db = new AppDatabase(":memory:");
    const accountId = "0123456789abcdef0123456789abcdef";
    const tunnelId = "11111111-1111-4111-8111-111111111111";
    const zoneId = "fedcba9876543210fedcba9876543210";
    db.setSettings({ account_id: accountId, tunnel_id: tunnelId, tunnel_name: "old", tunnel_token: "old-token", setup_completed: "true" });
    const mock = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const result = path === "/client/v4/user/tokens/verify" ? { status: "active" }
        : path.endsWith("/tunnels") ? [{ id: tunnelId, name: "current", config_src: "cloudflare" }]
        : path.endsWith(`/cfd_tunnel/${tunnelId}/token`) ? "fresh-token"
        : path === "/client/v4/zones" ? [{ id: zoneId, name: "example.com" }]
        : path.endsWith("/dns_records") ? []
        : null;
      return Response.json({ success: result !== null, result, errors: result === null ? [{ message: "Not found" }] : [], result_info: { page: 1, total_pages: 1 } }, { status: result === null ? 404 : 200 });
    } });
    try {
      const app = createApp({ database: db, cloudflareBaseUrl: `${mock.url}client/v4` });
      await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
      const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
      const response = await app.fetch(jsonRequest("/api/settings/token", { accountId, token: "new-api-token" }, "PUT", login.headers.get("set-cookie") ?? ""));
      expect(response.status).toBe(200);
      expect(db.getSetting("tunnel_token")).toBe("fresh-token");
      expect(db.getSetting("tunnel_name")).toBe("current");
      expect(db.getSetting("setup_completed")).toBe("true");
    } finally { mock.stop(true); }
  });

  test("returns to tunnel setup when the bound tunnel has been deleted", async () => {
    db = new AppDatabase(":memory:");
    const accountId = "0123456789abcdef0123456789abcdef";
    const zoneId = "fedcba9876543210fedcba9876543210";
    db.setSettings({ account_id: accountId, tunnel_id: "deleted-tunnel", tunnel_name: "deleted", tunnel_token: "stale-token", setup_completed: "true" });
    const mock = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const result = path === "/client/v4/user/tokens/verify" ? { status: "active" }
        : path.endsWith("/tunnels") ? []
        : path === "/client/v4/zones" ? [{ id: zoneId, name: "example.com" }]
        : path.endsWith("/dns_records") ? []
        : null;
      return Response.json({ success: result !== null, result, errors: [], result_info: { page: 1, total_pages: 1 } }, { status: result === null ? 404 : 200 });
    } });
    try {
      const app = createApp({ database: db, cloudflareBaseUrl: `${mock.url}client/v4` });
      await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
      const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
      const response = await app.fetch(jsonRequest("/api/settings/token", { accountId, token: "new-api-token" }, "PUT", login.headers.get("set-cookie") ?? ""));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ tunnelInvalidated: true });
      expect(db.getSetting("tunnel_id")).toBeUndefined();
      expect(db.getSetting("tunnel_token")).toBeUndefined();
      expect(db.getSetting("setup_completed")).toBe("false");
    } finally { mock.stop(true); }
  });

  test("protects the current tunnel from deletion", async () => {
    db = new AppDatabase(":memory:");
    const tunnelId = "11111111-1111-4111-8111-111111111111";
    db.setSettings({ account_id: "0123456789abcdef0123456789abcdef", tunnel_id: tunnelId, tunnel_token: "token", setup_completed: "true" });
    const app = createApp({ database: db });
    await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
    const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
    const response = await app.fetch(new Request(`http://localhost/api/cloudflare/tunnels/${tunnelId}`, { method: "DELETE", headers: { Cookie: login.headers.get("set-cookie") ?? "", Origin: "http://localhost" } }));
    expect(response.status).toBe(409);
    expect(db.getSetting("tunnel_id")).toBe(tunnelId);
  });

  test("creates a tunnel without changing the current binding", async () => {
    db = new AppDatabase(":memory:");
    const accountId = "0123456789abcdef0123456789abcdef";
    const currentId = "11111111-1111-4111-8111-111111111111";
    const createdId = "22222222-2222-4222-8222-222222222222";
    db.setSettings({ account_id: accountId, cloudflare_api_token: "api-token", tunnel_id: currentId, tunnel_token: "token", setup_completed: "true" });
    const mock = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const result = path.endsWith("/cfd_tunnel") && request.method === "POST" ? { id: createdId, name: "new-tunnel", config_src: "cloudflare", status: "inactive" } : null;
      return Response.json({ success: result !== null, result, errors: [], result_info: { page: 1, total_pages: 1 } }, { status: result === null ? 404 : 200 });
    } });
    try {
      const app = createApp({ database: db, cloudflareBaseUrl: `${mock.url}client/v4` });
      await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
      const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
      const response = await app.fetch(jsonRequest("/api/cloudflare/tunnels", { name: "new-tunnel" }, "POST", login.headers.get("set-cookie") ?? ""));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ tunnel: { id: createdId, name: "new-tunnel" } });
      expect(db.getSetting("tunnel_id")).toBe(currentId);
    } finally { mock.stop(true); }
  });

  test("deletes a non-current remotely-managed tunnel", async () => {
    db = new AppDatabase(":memory:");
    const accountId = "0123456789abcdef0123456789abcdef";
    const currentId = "11111111-1111-4111-8111-111111111111";
    const deleteId = "22222222-2222-4222-8222-222222222222";
    db.setSettings({ account_id: accountId, cloudflare_api_token: "api-token", tunnel_id: currentId, tunnel_token: "token", setup_completed: "true" });
    let deleted = false;
    const mock = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const result = path.endsWith("/tunnels") ? [{ id: currentId, name: "current", config_src: "cloudflare" }, { id: deleteId, name: "unused", config_src: "cloudflare", status: "down" }]
        : path.endsWith(`/cfd_tunnel/${deleteId}`) && request.method === "DELETE" ? (deleted = true, { id: deleteId }) : null;
      return Response.json({ success: result !== null, result, errors: [], result_info: { page: 1, total_pages: 1 } }, { status: result === null ? 404 : 200 });
    } });
    try {
      const app = createApp({ database: db, cloudflareBaseUrl: `${mock.url}client/v4` });
      await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
      const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
      const response = await app.fetch(new Request(`http://localhost/api/cloudflare/tunnels/${deleteId}`, { method: "DELETE", headers: { Cookie: login.headers.get("set-cookie") ?? "", Origin: "http://localhost" } }));
      expect(response.status).toBe(200); expect(deleted).toBe(true); expect(db.getSetting("tunnel_id")).toBe(currentId);
    } finally { mock.stop(true); }
  });

  test("switches tunnels only after remote preflight succeeds", async () => {
    db = new AppDatabase(":memory:");
    const accountId = "0123456789abcdef0123456789abcdef";
    const currentId = "11111111-1111-4111-8111-111111111111";
    const targetId = "22222222-2222-4222-8222-222222222222";
    db.setSettings({ account_id: accountId, cloudflare_api_token: "api-token", tunnel_id: currentId, tunnel_name: "current", tunnel_token: "old-token", setup_completed: "true" });
    const mock = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const result = path.endsWith("/tunnels") ? [{ id: currentId, name: "current", config_src: "cloudflare" }, { id: targetId, name: "target", config_src: "cloudflare" }]
        : path.endsWith(`/cfd_tunnel/${targetId}/token`) ? "new-token"
        : path.endsWith(`/cfd_tunnel/${targetId}/configurations`) ? { version: 1, config: { ingress: [{ service: "http_status:404" }] } }
        : path === "/client/v4/zones" ? [] : null;
      return Response.json({ success: result !== null, result, errors: [], result_info: { page: 1, total_pages: 1 } }, { status: result === null ? 404 : 200 });
    } });
    try {
      const app = createApp({ database: db, cloudflareBaseUrl: `${mock.url}client/v4` });
      await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
      const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
      const response = await app.fetch(jsonRequest("/api/settings/tunnel", { tunnelId: targetId }, "POST", login.headers.get("set-cookie") ?? ""));
      expect(response.status).toBe(200);
      expect(db.settings()).toMatchObject({ tunnel_id: targetId, tunnel_name: "target", tunnel_token: "new-token", setup_completed: "true" });
      expect(await response.json()).toMatchObject({ tunnel: { id: targetId, name: "target" }, sync: { imported: 0, skipped: 1 }, connector: { state: "stopped", desired: false } });
    } finally { mock.stop(true); }
  });

  test("keeps the current tunnel when target preflight fails", async () => {
    db = new AppDatabase(":memory:");
    const accountId = "0123456789abcdef0123456789abcdef";
    const currentId = "11111111-1111-4111-8111-111111111111";
    const targetId = "22222222-2222-4222-8222-222222222222";
    db.setSettings({ account_id: accountId, cloudflare_api_token: "api-token", tunnel_id: currentId, tunnel_name: "current", tunnel_token: "old-token", setup_completed: "true" });
    const mock = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const result = path.endsWith("/tunnels") ? [{ id: targetId, name: "target", config_src: "cloudflare" }]
        : path.endsWith(`/cfd_tunnel/${targetId}/token`) ? "new-token" : null;
      return Response.json({ success: result !== null, result, errors: result === null ? [{ message: "Unavailable" }] : [], result_info: { page: 1, total_pages: 1 } }, { status: result === null ? 503 : 200 });
    } });
    try {
      const app = createApp({ database: db, cloudflareBaseUrl: `${mock.url}client/v4` });
      await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
      const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
      const response = await app.fetch(jsonRequest("/api/settings/tunnel", { tunnelId: targetId }, "POST", login.headers.get("set-cookie") ?? ""));
      expect(response.status).toBe(502);
      expect(db.settings()).toMatchObject({ tunnel_id: currentId, tunnel_name: "current", tunnel_token: "old-token", setup_completed: "true" });
    } finally { mock.stop(true); }
  });

  test("releases connector event subscriptions when the SSE stream is cancelled", async () => {
    db = new AppDatabase(":memory:");
    const app = createApp({ database: db });
    await app.fetch(jsonRequest("/api/auth/setup", { username: "admin", password: "correct-horse-battery" }));
    const login = await app.fetch(jsonRequest("/api/auth/login", { username: "admin", password: "correct-horse-battery" }));
    const response = await app.fetch(new Request("http://localhost/api/connector/events", { headers: { Cookie: (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "" } }));
    const subscribers = (app.connector as unknown as { subscribers: Set<unknown> }).subscribers;
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(subscribers.size).toBe(1);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(subscribers.size).toBe(0);
  });
});

function jsonRequest(path: string, body: unknown, method = "POST", cookie = ""): Request {
  return new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", Origin: "http://localhost", ...(cookie ? { Cookie: cookie.split(";")[0] ?? "" } : {}) }, body: JSON.stringify(body) });
}

function externalRequest(method: string, origin: string, body?: unknown): Request {
  return new Request("http://panel.example.com/api/auth/setup", {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
