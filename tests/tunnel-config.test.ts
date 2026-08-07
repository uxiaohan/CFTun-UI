import { describe, expect, test } from "bun:test";
import { mergeConfiguration } from "../src/cloudflare/tunnel-config.ts";

describe("tunnel configuration merge", () => {
  test("preserves unknown fields and places specific paths before catch-all", () => {
    const result = mergeConfiguration({
      version: 4,
      config: {
        "warp-routing": { enabled: true },
        ingress: [
          { hostname: "app.example.com", service: "http://old:80", originRequest: { connectTimeout: 10 } },
          { hostname: "other.example.com", service: "http://other:80" },
          { service: "http_status:404" },
        ],
      },
    }, { type: "upsert", rule: { hostname: "app.example.com", path: "^/api/.*", service: "http://new:80" } });
    expect(result["warp-routing"]).toEqual({ enabled: true });
    expect(result.ingress).toEqual([
      { hostname: "app.example.com", path: "^/api/.*", service: "http://new:80" },
      { hostname: "app.example.com", service: "http://old:80", originRequest: { connectTimeout: 10 } },
      { hostname: "other.example.com", service: "http://other:80" },
      { service: "http_status:404" },
    ]);
  });

  test("deletes only the exact hostname and path", () => {
    const result = mergeConfiguration({ config: { ingress: [
      { hostname: "app.example.com", service: "http://root" },
      { hostname: "app.example.com", path: "/admin", service: "http://admin" },
      { service: "http_status:404" },
    ] } }, { type: "delete", hostname: "app.example.com", path: "/admin" });
    expect(result.ingress).toEqual([{ hostname: "app.example.com", service: "http://root" }, { service: "http_status:404" }]);
  });

  test("moves an existing rule without changing unknown or catch-all rules", () => {
    const result = mergeConfiguration({ config: { ingress: [
      { hostname: "first.example.com", service: "http://first" },
      { hostname: "app.example.com", service: "http://old", custom: true },
      { service: "tcp://localhost:22", custom: "catch-all" },
    ] } }, { type: "upsert", ruleOrder: 0, rule: { hostname: "app.example.com", service: "http://new", custom: true } });
    expect(result.ingress).toEqual([
      { hostname: "app.example.com", service: "http://new", custom: true },
      { hostname: "first.example.com", service: "http://first" },
      { service: "tcp://localhost:22", custom: "catch-all" },
    ]);
  });
});
