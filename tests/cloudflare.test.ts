import { describe, expect, test } from "bun:test";
import { CloudflareClient, CloudflareError } from "../src/cloudflare/client.ts";

describe("Cloudflare API errors", () => {
  test("returns a Chinese permission message and preserves original details", async () => {
    const mock = Bun.serve({ port: 0, fetch: () => Response.json({ success: false, result: null, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 403 }) });
    try {
      const client = new CloudflareClient("token", `${mock.url}client/v4`);
      const error = await client.verify().catch((caught) => caught as CloudflareError);
      expect(error.message).toBe("Cloudflare API Token 权限不足");
      expect(error.errors).toEqual([{ code: 10000, message: "Authentication error" }]);
    } finally { mock.stop(true); }
  });
});
