import { afterEach, describe, expect, test } from "bun:test";
import { CloudflareClient } from "../src/cloudflare/client.ts";
import { AppDatabase } from "../src/db.ts";
import { MappingService } from "../src/mappings/service.ts";

let db: AppDatabase | undefined;
let mock: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => { db?.close(); mock?.stop(true); });

describe("mapping synchronization", () => {
  test("imports HTTP rules using the longest active zone and preserves raw rules", async () => {
    db = new AppDatabase(":memory:");
    db.setSettings({ account_id: "account", tunnel_id: "tunnel" });
    mock = Bun.serve({ port: 0, fetch(request) {
      const url = new URL(request.url);
      let result: unknown = null;
      if (url.pathname === "/client/v4/accounts/account/cfd_tunnel/tunnel/configurations") result = { version: 1, config: { ingress: [
        { hostname: "api.dev.example.com", path: "/v1", service: "https://origin.internal:8443", originRequest: { connectTimeout: 12 }, custom: { retained: true } },
        { hostname: "ssh.example.com", service: "ssh://localhost:22", custom: "skip" },
        { service: "http_status:404", custom: "catch-all" },
      ] } };
      if (url.pathname === "/client/v4/zones") result = [{ id: "parent", name: "example.com" }, { id: "child", name: "dev.example.com" }];
      if (url.pathname === "/client/v4/zones/child/dns_records") result = [{ id: "dns", type: "CNAME", name: "api.dev.example.com", content: "tunnel.cfargotunnel.com" }];
      return Response.json({ success: result !== null, result, errors: [], result_info: { total_pages: 1 } }, { status: result === null ? 404 : 200 });
    } });
    const client = new CloudflareClient("token", `${mock.url}client/v4`);
    const service = new MappingService(db, () => client);
    const result = await service.sync();

    expect(result).toMatchObject({ imported: 1, skipped: 2 });
    expect(result.mappings[0]).toMatchObject({ zoneId: "child", zoneName: "dev.example.com", protocol: "https", targetHost: "origin.internal", targetPort: 8443, ruleOrder: 0, syncStatus: "synced" });
    expect(result.mappings[0]?.rawRule).toEqual({ hostname: "api.dev.example.com", path: "/v1", service: "https://origin.internal:8443", originRequest: { connectTimeout: 12 }, custom: { retained: true } });
  });
});
