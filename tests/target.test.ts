import { describe, expect, test } from "bun:test";
import { validateMapping } from "../src/mappings/target.ts";

describe("mapping target validation", () => {
  test("forces host mappings to loopback", () => {
    const target = validateMapping({ zoneId: "zone", hostname: "app.example.com", targetType: "host", protocol: "http", targetHost: "evil.test", targetPort: 8080 }, "example.com");
    expect(target.service).toBe("http://127.0.0.1:8080");
  });

  test("formats IPv6 LAN services", () => {
    const target = validateMapping({ zoneId: "zone", hostname: "nas.example.com", targetType: "lan", protocol: "https", targetHost: "2001:db8::1", targetPort: 443 }, "example.com");
    expect(target.service).toBe("https://[2001:db8::1]:443");
  });

  test("rejects hostnames outside the selected zone", () => {
    expect(() => validateMapping({ zoneId: "zone", hostname: "app.other.com", targetType: "host", protocol: "http", targetPort: 80 }, "example.com")).toThrow("必须属于所选区域");
  });

  test("supports root and left-most wildcard hostnames", () => {
    expect(validateMapping({ zoneId: "zone", hostname: "example.com", targetType: "host", protocol: "http", targetPort: 80 }, "example.com").rule.hostname).toBe("example.com");
    expect(validateMapping({ zoneId: "zone", hostname: "*.example.com", targetType: "host", protocol: "https", targetPort: 443 }, "example.com").rule.hostname).toBe("*.example.com");
  });
});
