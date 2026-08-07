export type JsonObject = Record<string, unknown>;

export interface AppSettings {
  cloudflare_api_token?: string;
  account_id?: string;
  zone_id?: string;
  zone_name?: string;
  tunnel_id?: string;
  tunnel_name?: string;
  tunnel_token?: string;
  setup_completed?: string;
  connector_auto_start?: string;
  connector_protocol?: ConnectorProtocol;
  connector_edge_ip_version?: ConnectorEdgeIpVersion;
}

export type ConnectorProtocol = "auto" | "quic" | "http2";
export type ConnectorEdgeIpVersion = "auto" | "4" | "6";
export type MappingSyncStatus = "synced" | "pending" | "error";

export interface MappingInput {
  operationId?: string;
  zoneId: string;
  zoneName?: string;
  hostname: string;
  path?: string | null;
  targetType: "host" | "lan";
  protocol: "http" | "https";
  targetHost?: string;
  targetPort: number;
  noTLSVerify?: boolean;
  originServerName?: string;
  httpHostHeader?: string;
  enabled?: boolean;
  rawRule?: JsonObject;
  ruleOrder?: number;
  syncStatus?: MappingSyncStatus;
}

export interface MappingRecord extends MappingInput {
  id: string;
  targetHost: string;
  service: string;
  tunnelId: string;
  zoneId: string;
  zoneName: string;
  dnsRecordId: string | null;
  rawRule: JsonObject;
  ruleOrder: number;
  syncStatus: MappingSyncStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
