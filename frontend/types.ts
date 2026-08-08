export type Id = string;
export type ConnectorState = "stopped" | "starting" | "running" | "stopping" | "backoff" | "failed";
export type ToastKind = "success" | "error" | "info";

export interface PublicStatus {
  ok: boolean;
  authConfigured: boolean;
  setupCompleted: boolean;
  connector: ConnectorSnapshot;
}

export interface AuthUser { authenticated: true; username: string }
export interface LoginCredentials { username: string; password: string }

export interface SetupStatus {
  tokenConfigured: boolean;
  accountId: string | null;
  tunnelId: string | null;
  tunnelName: string | null;
  tunnelTokenConfigured: boolean;
  completed: boolean;
  connectorAutoStart: boolean;
  connectorProtocol: ConnectorProtocol;
  connectorEdgeIpVersion: EdgeIpVersion;
}

export interface CloudflareChoice {
  id: string;
  name: string;
  status?: string;
  config_src?: string;
}

export interface ConnectorSnapshot {
  state: ConnectorState;
  pid: number | null;
  desired: boolean;
  attempts: number;
  lastExitCode: number | null;
  nextRestartAt: string | null;
  startedAt: string | null;
}

export interface ConnectorLog {
  id: number;
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

export interface MappingInput {
  operationId?: string;
  zoneId: string;
  zoneName: string;
  hostname: string;
  path?: string;
  targetType: "host" | "lan";
  protocol: "http" | "https";
  targetHost?: string;
  targetPort: number;
  noTLSVerify?: boolean;
  enabled?: boolean;
}

export interface Mapping extends MappingInput {
  id: Id;
  targetHost: string;
  service: string;
  tunnelId: string;
  dnsRecordId: string | null;
  zoneName: string;
  rawRule: Record<string, unknown>;
  ruleOrder: number;
  syncStatus: "synced" | "pending" | "error";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MappingTestResult {
  ok: boolean;
  tcp: boolean;
  http: boolean;
  category: "responded" | "timeout" | "tls_error" | "dns_error" | "unreachable";
  message?: string;
  durationMs: number;
  status?: number;
}

export type OperationStage = "validate" | "old_ingress" | "ingress" | "dns" | "database" | "complete" | "failed";
export interface Operation {
  id: Id;
  action: "create_mapping" | "update_mapping" | "delete_mapping";
  mappingId: Id | null;
  status: "running" | "succeeded" | "failed";
  stage: OperationStage;
  message: string | null;
  details: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MappingMutation { mapping: Mapping; operationId: string }
export interface DeleteMutation { operationId: string }
export interface MappingSyncResult { imported: number; skipped: number; dnsLinked: number; mappings?: Mapping[] }
export interface CloudflareSettingsResult { updated: true; accountChanged: boolean; accountId: string; zoneCount: number; tunnelCount: number }
export type ConnectorProtocol = "auto" | "quic" | "http2";
export type EdgeIpVersion = "auto" | "4" | "6";
export interface ConnectorSettingsInput { autoStart: boolean; protocol: ConnectorProtocol; edgeIpVersion: EdgeIpVersion }
export interface Toast { id: number; message: string; kind: ToastKind }
