import { CloudflareClient, type TunnelConfiguration } from "./client.ts";
import type { JsonObject } from "../types.ts";

export type IngressMutation = { type: "upsert"; rule: JsonObject; ruleOrder?: number } | { type: "delete"; hostname: string; path?: string | null };

export class TunnelConfigService {
  constructor(private readonly client: CloudflareClient) {}

  async mutate(accountId: string, tunnelId: string, mutation: IngressMutation): Promise<TunnelConfiguration> {
    const initial = await this.client.tunnelConfig(accountId, tunnelId);
    const merged = mergeConfiguration(initial, mutation);
    const latest = await this.client.tunnelConfig(accountId, tunnelId);
    if (!sameVersion(initial, latest)) throw new Error("Tunnel 配置已被其他操作修改，请重新同步后再试");
    await this.client.updateTunnelConfig(accountId, tunnelId, merged);
    const verified = await this.client.tunnelConfig(accountId, tunnelId);
    if (!mutationApplied(verified, mutation)) throw new Error("Tunnel 配置更新后的验证失败");
    return verified;
  }
}

export function mergeConfiguration(current: TunnelConfiguration, mutation: IngressMutation): JsonObject {
  const config = structuredClone(current.config ?? {}) as JsonObject & { ingress?: JsonObject[] };
  const ingress = [...(config.ingress ?? [])];
  const matches = (rule: JsonObject) => rule.hostname === (mutation.type === "upsert" ? mutation.rule.hostname : mutation.hostname)
    && String(rule.path ?? "") === String(mutation.type === "upsert" ? mutation.rule.path ?? "" : mutation.path ?? "");
  const existingIndex = ingress.findIndex(matches);
  if (mutation.type === "delete") {
    if (existingIndex >= 0) ingress.splice(existingIndex, 1);
  } else if (existingIndex >= 0 && mutation.ruleOrder === undefined) {
    ingress.splice(existingIndex, 1, mutation.rule);
  } else {
    if (existingIndex >= 0) ingress.splice(existingIndex, 1);
    const firstCatchAll = ingress.findIndex((rule) => !rule.hostname);
    const limit = firstCatchAll < 0 ? ingress.length : firstCatchAll;
    const sameHostname = ingress.findIndex((rule, index) => index < limit && rule.hostname === mutation.rule.hostname
      && String(rule.path ?? "").length < String(mutation.rule.path ?? "").length);
    const index = mutation.ruleOrder === undefined
      ? (sameHostname < 0 ? limit : sameHostname)
      : Math.min(Math.max(mutation.ruleOrder, 0), limit);
    ingress.splice(index, 0, mutation.rule);
  }
  if (!ingress.some((rule) => !rule.hostname)) ingress.push({ service: "http_status:404" });
  config.ingress = ingress;
  return config;
}

function sameVersion(a: TunnelConfiguration, b: TunnelConfiguration): boolean {
  if (a.version !== undefined || b.version !== undefined) return a.version === b.version;
  return JSON.stringify(a.config ?? {}) === JSON.stringify(b.config ?? {});
}

function mutationApplied(config: TunnelConfiguration, mutation: IngressMutation): boolean {
  const ingress = config.config?.ingress ?? [];
  const match = ingress.find((rule) => rule.hostname === (mutation.type === "upsert" ? mutation.rule.hostname : mutation.hostname)
    && String(rule.path ?? "") === String(mutation.type === "upsert" ? mutation.rule.path ?? "" : mutation.path ?? ""));
  return mutation.type === "upsert" ? match?.service === mutation.rule.service : !match;
}
