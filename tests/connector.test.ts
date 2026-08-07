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
});
