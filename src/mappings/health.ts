import type { MappingInput } from "../types.ts";
import { validateMapping } from "./target.ts";

export async function testOrigin(input: MappingInput, zoneName: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
  const target = validateMapping(input, zoneName);
  const started = performance.now();
  try {
    let timedOut = false;
    const connection = Bun.connect({ hostname: target.targetHost, port: input.targetPort, socket: { data() {}, open(socket) { socket.end(); }, error() {} } });
    const timeout = Bun.sleep(timeoutMs).then(() => { timedOut = true; throw new Error("TCP 连接超时"); });
    const socket = await Promise.race([connection, timeout]);
    socket.end();
    if (timedOut) socket.terminate();
  } catch (error) {
    return { ok: false, tcp: false, http: false, category: classify(error), message: errorMessage(error), durationMs: Math.round(performance.now() - started) };
  }
  try {
    const response = await fetch(target.service, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs), tls: input.noTLSVerify ? { rejectUnauthorized: false } : undefined });
    await response.body?.cancel();
    return { ok: true, tcp: true, http: true, status: response.status, category: "responded", durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, tcp: true, http: false, category: classify(error), message: errorMessage(error), durationMs: Math.round(performance.now() - started) };
  }
}

function classify(error: unknown): string {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("timeout") || message.includes("超时")) return "timeout";
  if (message.includes("certificate") || message.includes("tls")) return "tls_error";
  if (message.includes("dns") || message.includes("resolve") || message.includes("name")) return "dns_error";
  return "unreachable";
}
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return "连接目标服务超时";
  if (/certificate|tls/i.test(message)) return "目标服务的 HTTPS 证书验证失败";
  if (/dns|resolve|name not known|getaddrinfo/i.test(message)) return "无法解析目标服务地址";
  if (/refused|econnrefused/i.test(message)) return "目标服务拒绝连接";
  return message || "无法连接目标服务";
}
