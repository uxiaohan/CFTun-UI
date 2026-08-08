import type {
  AuthUser, CloudflareChoice, ConnectorLog, ConnectorSnapshot,
  DeleteMutation, LoginCredentials, Mapping, MappingInput, MappingMutation,
  CloudflareSettingsResult, ConnectorProtocol, ConnectorSettingsInput, EdgeIpVersion, MappingSyncResult,
  MappingTestResult, Operation, PublicStatus, SetupStatus,
} from "./types";

type ErrorPayload = { error?: string | { message?: string }; [key: string]: unknown };
let unauthorizedHandler: (() => void) | undefined;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ApiError"; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body != null && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => null) as T | ErrorPayload | null;
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    const raw = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
    const message = typeof raw === "string" ? raw : raw?.message;
    throw new ApiError(response.status, message || `请求失败（状态码 ${response.status}）`);
  }
  if (payload === null) throw new ApiError(response.status, "服务器返回了无效响应");
  return payload as T;
}

export function onUnauthorized(handler: () => void): void { unauthorizedHandler = handler; }
const json = (body: unknown): string => JSON.stringify(body);

export const apiClient = {
  status: () => api<PublicStatus>("/api/status"),
  initializeAuth: (body: LoginCredentials) => api<{ configured: true }>("/api/auth/setup", { method: "POST", body: json(body) }),
  login: (body: LoginCredentials) => api<{ authenticated: true; expiresAt: string }>("/api/auth/login", { method: "POST", body: json(body) }),
  logout: () => api<{ authenticated: false }>("/api/auth/logout", { method: "POST" }),
  me: () => api<AuthUser>("/api/auth/me"),
  setup: () => api<SetupStatus>("/api/setup"),
  saveSetupToken: (accountId: string, token: string) => api<{ verified: true; accountId: string; zoneCount: number }>("/api/setup/token", { method: "POST", body: json({ accountId, token }) }),
  zones: async (accountId?: string) => (await api<{ zones: CloudflareChoice[] }>(`/api/cloudflare/zones${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`)).zones,
  tunnels: async (accountId: string) => (await api<{ tunnels: CloudflareChoice[] }>(`/api/cloudflare/tunnels?accountId=${encodeURIComponent(accountId)}`)).tunnels,
  createTunnel: (name: string) => api<{ tunnel: CloudflareChoice }>("/api/cloudflare/tunnels", { method: "POST", body: json({ name }) }),
  saveSetupTunnel: (tunnelId: string) => api<{ tunnel: CloudflareChoice; sync: MappingSyncResult }>("/api/setup/tunnel", { method: "POST", body: json({ tunnelId }) }),
  completeSetup: (body: { connectorAutoStart: boolean }) => api<{ completed: true; connector: ConnectorSnapshot }>("/api/setup/complete", { method: "POST", body: json(body) }),
  connector: () => api<ConnectorSnapshot>("/api/connector"),
  connectorAction: (action: "start" | "stop" | "restart") => api<ConnectorSnapshot>(`/api/connector/${action}`, { method: "POST" }),
  connectorLogs: async (limit = 300) => (await api<{ logs: ConnectorLog[] }>(`/api/connector/logs?limit=${limit}`)).logs,
  mappings: async () => (await api<{ mappings: Mapping[] }>("/api/mappings")).mappings,
  testMapping: (body: MappingInput) => api<MappingTestResult>("/api/mappings/test", { method: "POST", body: json(body) }),
  createMapping: (body: MappingInput) => api<MappingMutation>("/api/mappings", { method: "POST", body: json(body) }),
  updateMapping: (id: string, body: MappingInput) => api<MappingMutation>(`/api/mappings/${encodeURIComponent(id)}`, { method: "PUT", body: json(body) }),
  deleteMapping: (id: string, body: { ingress: boolean; dns: boolean }) => api<DeleteMutation>(`/api/mappings/${encodeURIComponent(id)}`, { method: "DELETE", body: json(body) }),
  syncMappings: () => api<MappingSyncResult>("/api/mappings/sync", { method: "POST" }),
  operations: async (limit = 50) => (await api<{ operations: Operation[] }>(`/api/operations?limit=${limit}`)).operations,
  operation: (id: string) => api<Operation>(`/api/operations/${encodeURIComponent(id)}`),
  updateCredentials: (body: { username: string; currentPassword: string; password: string }) => api<{ updated: true }>("/api/settings/credentials", { method: "PUT", body: json(body) }),
  updateCloudflare: (body: { accountId: string; token: string }) => api<CloudflareSettingsResult>("/api/settings/token", { method: "PUT", body: json(body) }),
  connectorSettings: () => api<{ connector_auto_start: boolean; connector_protocol: ConnectorProtocol; connector_edge_ip_version: EdgeIpVersion }>("/api/settings"),
  updateConnector: (body: ConnectorSettingsInput) => api<{ updated: true; connector: ConnectorSnapshot }>("/api/settings", { method: "PUT", body: json({ connector_auto_start: body.autoStart, connector_protocol: body.protocol, connector_edge_ip_version: body.edgeIpVersion }) }),
};
