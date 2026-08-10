import { describe, expect, test } from "bun:test";
import { consoleUrls, formatStartupTime, startupBanner } from "../src/startup.ts";

const interfaces = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  eth0: [{ address: "172.28.96.25", family: "IPv4", internal: false }],
  eth1: [{ address: "192.168.1.10", family: 4, internal: false }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  "br-abcd": [{ address: "172.18.0.1", family: "IPv4", internal: false }],
  veth123: [{ address: "10.0.0.2", family: "IPv4", internal: false }],
  utun4: [{ address: "198.18.0.1", family: "IPv4", internal: false }],
  bridge100: [{ address: "192.168.215.1", family: "IPv4", internal: false }],
};

describe("startup banner", () => {
  test("lists local and routable IPv4 URLs while filtering virtual interfaces", () => {
    expect(consoleUrls("0.0.0.0", 9911, interfaces)).toEqual([
      "http://localhost:9911", "http://127.0.0.1:9911", "http://172.28.96.25:9911", "http://192.168.1.10:9911",
    ]);
  });

  test("only exposes the explicitly bound host", () => {
    expect(consoleUrls("192.168.1.8", 9911, interfaces)).toEqual(["http://192.168.1.8:9911"]);
  });

  test("formats a concise Chinese startup banner in local time", () => {
    const now = new Date("2026-08-07T13:44:29.000Z");
    const expectedTime = formatStartupTime(now);
    const expectedTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const banner = startupBanner("0.0.0.0", 9911, now, interfaces);
    expect(banner).toContain("🚇 CFTun-UI 启动成功");
    expect(banner).toContain(`🕒 当前时间: ${expectedTime} (${expectedTz})`);
    expect(banner).toContain("🔗 GitHub: https://github.com/uxiaohan/CFTun-UI");
    expect(banner).not.toContain("172.17.0.1");
  });
});
