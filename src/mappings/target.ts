import type { JsonObject, MappingInput } from "../types.ts";

export interface ValidatedTarget { input: MappingInput; targetHost: string; service: string; rule: JsonObject }

export function validateMapping(input: MappingInput, zoneName = input.zoneName ?? ""): ValidatedTarget {
  const hostname = input.hostname.trim().toLowerCase().replace(/\.$/, "");
  const zone = zoneName.toLowerCase().replace(/\.$/, "");
  if (!isIngressHostname(hostname) || (hostname !== zone && !hostname.endsWith(`.${zone}`))) throw new Error("域名必须属于所选区域");
  if (input.targetType !== "host" && input.targetType !== "lan") throw new Error("目标类型只能是宿主机或局域网设备");
  if (input.protocol !== "http" && input.protocol !== "https") throw new Error("映射协议只能是 HTTP 或 HTTPS");
  if (!Number.isInteger(input.targetPort) || input.targetPort < 1 || input.targetPort > 65535) throw new Error("端口必须是 1 至 65535 之间的整数");
  const targetHost = input.targetType === "host" ? "127.0.0.1" : input.targetHost?.trim();
  if (!targetHost || !isTargetHost(targetHost)) throw new Error("局域网目标地址或 IP 无效");
  if (input.path && (input.path.length > 512 || /[\r\n]/.test(input.path))) throw new Error("Ingress Path 格式无效");
  for (const value of [input.originServerName, input.httpHostHeader]) if (value && !isHostname(value)) throw new Error("Origin hostname 配置无效");
  const urlHost = targetHost.includes(":") && !targetHost.startsWith("[") ? `[${targetHost}]` : targetHost;
  const service = `${input.protocol}://${urlHost}:${input.targetPort}`;
  const originRequest: JsonObject = {};
  if (input.noTLSVerify) originRequest.noTLSVerify = true;
  if (input.originServerName) originRequest.originServerName = input.originServerName;
  if (input.httpHostHeader) originRequest.httpHostHeader = input.httpHostHeader;
  const raw = structuredClone(input.rawRule ?? {});
  const rawOrigin = raw.originRequest && typeof raw.originRequest === "object" && !Array.isArray(raw.originRequest) ? raw.originRequest as JsonObject : {};
  const rule: JsonObject = { ...raw, hostname, service };
  if (input.path) rule.path = input.path; else delete rule.path;
  const mergedOrigin = { ...rawOrigin, ...originRequest };
  for (const key of ["noTLSVerify", "originServerName", "httpHostHeader"]) if (!(key in originRequest)) delete mergedOrigin[key];
  if (Object.keys(mergedOrigin).length) rule.originRequest = mergedOrigin; else delete rule.originRequest;
  return { input: { ...input, hostname }, targetHost, service, rule };
}

function isHostname(value: string): boolean {
  return value.length <= 253 && /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value);
}

function isIngressHostname(value: string): boolean { return isHostname(value.startsWith("*.") ? value.slice(2) : value); }

function isTargetHost(value: string): boolean {
  return value.length <= 253 && !/[\s/?#@]/.test(value) && (/^[\d.]+$/.test(value) || /^[0-9a-fA-F:]+$/.test(value) || isHostname(value));
}
