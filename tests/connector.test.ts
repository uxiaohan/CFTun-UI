import { describe, expect, test } from "bun:test";
import { ConnectorManager, connectorCommand } from "../src/connector/manager.ts";

describe("connector command", () => {
  test("places tunnel flags before run and token after run", () => {
    expect(connectorCommand("cloudflared", "secret", "quic", "6")).toEqual([
      "cloudflared", "tunnel", "--no-autoupdate", "--protocol", "quic", "--edge-ip-version", "6", "run", "--token", "secret",
    ]);
  });

  test("bounds in-memory logs by line count, line bytes, and total bytes", () => {
    const manager = new ConnectorManager(() => ({}), 500, "cloudflared", 1024 * 1024, 8 * 1024);
    const writable = manager as unknown as { addLog(stream: "stdout", message: string): void };
    for (let index = 0; index < 600; index++) writable.addLog("stdout", `${index}:${"日".repeat(4000)}`);
    const logs = manager.recentLogs(1000); const encoder = new TextEncoder();
    expect(logs.length).toBeLessThanOrEqual(500);
    expect(logs.every((log) => encoder.encode(log.message).byteLength <= 8 * 1024)).toBe(true);
    expect(logs.reduce((total, log) => total + encoder.encode(JSON.stringify(log)).byteLength, 0)).toBeLessThanOrEqual(1024 * 1024);
  });

  test("stops retrying when Cloudflare reports that the tunnel no longer exists", () => {
    const manager = new ConnectorManager(() => ({ tunnel_token: "secret" }));
    const writable = manager as unknown as { handleOutput(source: "stderr", message: string): void };
    writable.handleOutput("stderr", 'ERR Register tunnel error from server side error="Unauthorized: Tunnel not found"');
    expect(manager.snapshot()).toMatchObject({ state: "failed", desired: false, nextRestartAt: null });
    expect(manager.recentLogs().at(-1)?.message).toContain("重新选择 Tunnel");
  });

  test("filters unavailable ICMP proxy warnings but keeps other warnings", () => {
    const manager = new ConnectorManager(() => ({ tunnel_token: "secret" }));
    const writable = manager as unknown as { handleOutput(source: "stderr", message: string): void };
    writable.handleOutput("stderr", "WRN The user running cloudflared process has a GID (group ID) that is not within ping_group_range error=\"Group ID 65532 is not between ping group 1 to 0\"");
    writable.handleOutput("stderr", "WRN ICMP proxy feature is disabled error=\"cannot create ICMPv4 proxy: Group ID 65532 is not between ping group 1 to 0 nor ICMPv6 proxy: socket: permission denied\"");
    writable.handleOutput("stderr", "WRN Retrying connection after temporary network failure");
    expect(manager.recentLogs().map((log) => log.message)).toEqual(["WRN Retrying connection after temporary network failure"]);
  });

  test("filters normal remote stream cancellation but keeps actual stream errors", () => {
    const manager = new ConnectorManager(() => ({ tunnel_token: "secret" }));
    const writable = manager as unknown as { handleOutput(source: "stderr", message: string): void };
    writable.handleOutput("stderr", 'ERR error="stream 105 canceled by remote with error code 0" connIndex=2 event=1');
    writable.handleOutput("stderr", 'ERR Request failed error="stream 105 canceled by remote with error code 0" dest=https://example.com/api/connector/events');
    writable.handleOutput("stderr", 'ERR Request failed error="stream 106 canceled by remote with error code 1" dest=https://example.com/file');
    writable.handleOutput("stderr", 'ERR Request failed error="connection timeout" dest=https://example.com/api');
    expect(manager.recentLogs().map((log) => log.message)).toEqual([
      'ERR Request failed error="stream 106 canceled by remote with error code 1" dest=https://example.com/file',
      'ERR Request failed error="connection timeout" dest=https://example.com/api',
    ]);
  });
});
