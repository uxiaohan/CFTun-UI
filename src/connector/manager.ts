export type ConnectorState = "stopped" | "starting" | "running" | "stopping" | "backoff" | "failed";

export interface ConnectorSnapshot {
  state: ConnectorState;
  pid: number | null;
  desired: boolean;
  attempts: number;
  lastExitCode: number | null;
  nextRestartAt: string | null;
  startedAt: string | null;
}

export interface ConnectorLog { id: number; timestamp: string; stream: "stdout" | "stderr" | "system"; message: string }

export class ConnectorManager {
  private process: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  private state: ConnectorState = "stopped";
  private desired = false;
  private attempts = 0;
  private lastExitCode: number | null = null;
  private nextRestartAt: string | null = null;
  private startedAt: string | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private fatalError: string | null = null;
  private logs: ConnectorLog[] = [];
  private logSizes: number[] = [];
  private logBytes = 0;
  private logId = 0;
  private subscribers = new Set<(event: string, data: unknown) => void>();

  constructor(
    private readonly settings: () => AppSettings,
    private readonly maxLogs = 500,
    private readonly command = process.env.CLOUDFLARED_PATH ?? "cloudflared",
    private readonly maxLogBytes = 1024 * 1024,
    private readonly maxLineBytes = 8 * 1024,
  ) {}

  snapshot(): ConnectorSnapshot {
    return { state: this.state, pid: this.process?.pid ?? null, desired: this.desired, attempts: this.attempts, lastExitCode: this.lastExitCode, nextRestartAt: this.nextRestartAt, startedAt: this.startedAt };
  }

  recentLogs(limit = 200): ConnectorLog[] { return this.logs.slice(-Math.min(Math.max(limit, 1), this.maxLogs)); }

  notice(message: string): void { this.addLog("system", message); }

  async start(): Promise<ConnectorSnapshot> {
    this.desired = true;
    if (this.process || this.state === "starting") return this.snapshot();
    const settings = this.settings();
    const token = settings.tunnel_token;
    if (!token) throw new Error("Tunnel Token 尚未配置");
    const protocol = connectorProtocol(settings.connector_protocol);
    const edgeIpVersion = connectorEdgeIpVersion(settings.connector_edge_ip_version);
    this.fatalError = null;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.nextRestartAt = null; this.state = "starting"; this.emit("status", this.snapshot());
    try {
      const child = Bun.spawn({
        cmd: connectorCommand(this.command, token, protocol, edgeIpVersion),
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      this.process = child;
      this.state = "running"; this.startedAt = new Date().toISOString();
      this.addLog("system", `cloudflared 已启动（PID ${child.pid}）`);
      void this.consume(child.stdout, "stdout"); void this.consume(child.stderr, "stderr"); void this.watch(child);
      this.emit("status", this.snapshot());
    } catch (error) {
      this.process = null; this.state = "failed"; this.addLog("system", errorMessage(error)); this.scheduleRestart();
    }
    return this.snapshot();
  }

  async stop(): Promise<ConnectorSnapshot> {
    this.desired = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.nextRestartAt = null;
    const child = this.process;
    if (child) {
      this.state = "stopping"; this.emit("status", this.snapshot()); child.kill("SIGTERM");
      await Promise.race([child.exited, Bun.sleep(10_000)]);
      if (this.process === child) { try { child.kill("SIGKILL"); } catch {} }
    }
    this.process = null; this.state = "stopped"; this.attempts = 0; this.emit("status", this.snapshot());
    return this.snapshot();
  }

  async restart(): Promise<ConnectorSnapshot> { await this.stop(); this.desired = true; return this.start(); }

  subscribe(listener: (event: string, data: unknown) => void): () => void {
    this.subscribers.add(listener); listener("status", this.snapshot());
    return () => this.subscribers.delete(listener);
  }

  private async watch(child: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
    const exitCode = await child.exited;
    if (this.process !== child) return;
    this.process = null; this.lastExitCode = exitCode; this.startedAt = null;
    this.addLog("system", `cloudflared 已退出（退出码 ${exitCode}）`);
    if (this.fatalError) {
      if (this.state !== "failed") { this.state = "failed"; this.emit("status", this.snapshot()); }
    }
    else if (this.desired) this.scheduleRestart();
    else { this.state = "stopped"; this.emit("status", this.snapshot()); }
  }

  private scheduleRestart(): void {
    if (!this.desired || this.restartTimer) return;
    const delays = [1000, 2000, 5000, 10_000, 30_000];
    const delay = delays[Math.min(this.attempts, delays.length - 1)] ?? 30_000;
    this.attempts++; this.state = "backoff"; this.nextRestartAt = new Date(Date.now() + delay).toISOString();
    this.emit("status", this.snapshot());
    this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.start(); }, delay);
  }

  private async consume(stream: ReadableStream<Uint8Array>, source: "stdout" | "stderr"): Promise<void> {
    const reader = stream.getReader(); const decoder = new TextDecoder(); let pending = "";
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        const lines = (pending + decoder.decode(value, { stream: true })).split(/\r?\n/); pending = truncateUtf8(lines.pop() ?? "", this.maxLineBytes);
        for (const line of lines) if (line) this.handleOutput(source, redact(line, this.settings().tunnel_token));
      }
      pending += decoder.decode(); if (pending) this.handleOutput(source, redact(pending, this.settings().tunnel_token));
    } catch (error) { this.addLog("system", `读取日志流失败：${errorMessage(error)}`); }
  }

  private handleOutput(source: "stdout" | "stderr", message: string): void {
    this.addLog(source, message);
    if (!/Unauthorized:\s*Tunnel not found/i.test(message)) return;
    this.fatalError = "当前 Tunnel 已不存在或 Connector Token 已失效，请重新选择 Tunnel";
    this.desired = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.nextRestartAt = null;
    this.state = "failed";
    this.addLog("system", this.fatalError);
    this.emit("status", this.snapshot());
    try { this.process?.kill("SIGTERM"); } catch {}
  }

  private addLog(stream: ConnectorLog["stream"], message: string): void {
    const log = { id: ++this.logId, timestamp: new Date().toISOString(), stream, message: truncateUtf8(message, this.maxLineBytes) };
    const size = utf8Size(JSON.stringify(log));
    this.logs.push(log); this.logSizes.push(size); this.logBytes += size;
    while (this.logs.length > this.maxLogs || this.logBytes > this.maxLogBytes) {
      this.logs.shift(); this.logBytes -= this.logSizes.shift() ?? 0;
    }
    this.emit("log", log);
  }

  private emit(event: string, data: unknown): void { for (const listener of this.subscribers) listener(event, data); }
}

function redact(value: string, token?: string): string { return token ? value.replaceAll(token, "[REDACTED]") : value; }
function utf8Size(value: string): number { return new TextEncoder().encode(value).byteLength; }
function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  const suffix = "…[已截断]"; const suffixBytes = new TextEncoder().encode(suffix);
  let prefix = new TextDecoder().decode(bytes.slice(0, Math.max(0, maxBytes - suffixBytes.byteLength)));
  while (prefix && utf8Size(prefix + suffix) > maxBytes) prefix = prefix.slice(0, -1);
  return prefix + suffix;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function connectorProtocol(value?: string): ConnectorProtocol {
  if (value === undefined || value === "auto" || value === "quic" || value === "http2") return value ?? "auto";
  throw new Error("传输协议只能是自动、QUIC 或 HTTP/2");
}
function connectorEdgeIpVersion(value?: string): ConnectorEdgeIpVersion {
  if (value === undefined || value === "auto" || value === "4" || value === "6") return value ?? "auto";
  throw new Error("Edge IP 版本只能是自动、IPv4 或 IPv6");
}
export function connectorCommand(command: string, token: string, protocol: ConnectorProtocol = "auto", edgeIpVersion: ConnectorEdgeIpVersion = "auto"): string[] {
  return [command, "tunnel", "--no-autoupdate", "--protocol", protocol, "--edge-ip-version", edgeIpVersion, "run", "--token", token];
}
import type { AppSettings, ConnectorEdgeIpVersion, ConnectorProtocol } from "../types.ts";
