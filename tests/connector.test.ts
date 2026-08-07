import { describe, expect, test } from "bun:test";
import { connectorCommand } from "../src/connector/manager.ts";

describe("connector command", () => {
  test("places tunnel flags before run and token after run", () => {
    expect(connectorCommand("cloudflared", "secret", "quic", "6")).toEqual([
      "cloudflared", "tunnel", "--no-autoupdate", "--protocol", "quic", "--edge-ip-version", "6", "run", "--token", "secret",
    ]);
  });
});
