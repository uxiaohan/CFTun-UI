import { networkInterfaces } from "node:os";

interface NetworkAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

type NetworkMap = Record<string, NetworkAddress[] | undefined>;

const GITHUB_URL = "https://github.com/uxiaohan/CFTun-UI";
const VIRTUAL_INTERFACE = /^(?:lo\d*|docker\d*|br-|bridge|veth|virbr|cni|flannel|podman|nerdctl|vmnet|utun|awdl|llw|anpi|gif|stf)/i;

export function startupBanner(host: string, port: number, now = new Date(), interfaces = networkInterfaces() as NetworkMap): string {
  const urls = consoleUrls(host, port, interfaces).map((url) => `   - ${url}`).join("\n");
  return [
    "============================================================",
    "🚇 CFTun-UI 启动成功",
    "",
    `🕒 当前时间: ${formatStartupTime(now)} (Asia/Shanghai)`,
    `🔗 GitHub: ${GITHUB_URL}`,
    "",
    "🌐 WEB 控制台:",
    urls,
    "============================================================",
  ].join("\n");
}

export function consoleUrls(host: string, port: number, interfaces: NetworkMap): string[] {
  const addresses = new Set<string>();
  if (host === "0.0.0.0" || host === "::") {
    addresses.add("localhost"); addresses.add("127.0.0.1");
    for (const [name, entries] of Object.entries(interfaces)) {
      if (VIRTUAL_INTERFACE.test(name)) continue;
      for (const entry of entries ?? []) {
        if (!entry.internal && isIPv4(entry) && !entry.address.startsWith("169.254.")) addresses.add(entry.address);
      }
    }
  } else if (host === "127.0.0.1" || host === "localhost") {
    addresses.add("localhost"); addresses.add("127.0.0.1");
  } else {
    addresses.add(host);
  }
  return [...addresses].slice(0, 8).map((address) => `http://${address}:${port}`);
}

export function formatStartupTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

function isIPv4(entry: NetworkAddress): boolean { return entry.family === "IPv4" || entry.family === 4; }
