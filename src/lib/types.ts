export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type BodyType = "none" | "json" | "form" | "formdata" | "xml" | "text";

export type AuthType = "none" | "basic" | "bearer" | "api-key";

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface RequestBody {
  type: BodyType;
  content: string;
  formData: KeyValue[];
}

export interface AuthConfig {
  type: AuthType;
  basic?: { username: string; password: string };
  bearer?: { token: string };
  apiKey?: { key: string; value: string; addTo: "header" | "query" };
}

export interface ApiRequest {
  id: string;
  collectionId: string;
  folderId?: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  seq: number;
  description?: string;
  preScript?: string;
  tests?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  collectionId: string;
  parentId?: string;
  name: string;
  seq: number;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  variables: CollectionVariable[];
  createdAt: number;
  updatedAt: number;
}

export interface CollectionVariable {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: CollectionVariable[];
  createdAt: number;
  updatedAt: number;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  time: number;
  contentType: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface HistoryItem {
  id: string;
  requestId?: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  response?: ResponseData;
  timestamp: number;
}

// ── Runner ──────────────────────────────────────────────────────────────────

export type RunnerMode = "functional" | "performance";

export interface RunnerItem {
  requestId: string;
  enabled: boolean;
}

export interface PerfTestConfig {
  connections: number;
  duration: number;
  rateLimit: number;
  timeout: number;
}

export interface RequestRunResult {
  requestId: string;
  name: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  time?: number;
  size?: number;
  error?: string;
  response?: ResponseData;
  passed: boolean;
  testResults?: TestResult[];
}

export interface FunctionalRunReport {
  id: string;
  collectionId: string;
  collectionName: string;
  mode: "functional";
  startTime: number;
  endTime: number;
  results: RequestRunResult[];
  runnerItems: RunnerItem[];
}

export interface PerfStats {
  requestsTotal: number;
  requestsPerSec: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50Ms: number;
  p75Ms: number;
  p90Ms: number;
  p99Ms: number;
  p999Ms: number;
  bytesTotal: number;
  bytesPerSec: number;
  errors: number;
  durationMs: number;
  statusCodes: Record<string, number>;
  perRequest: PerRequestStats[];
}

export interface PerRequestStats {
  name: string;
  url: string;
  requestsTotal: number;
  errors: number;
  avgLatencyMs: number;
  p99Ms: number;
  statusCodes: Record<string, number>;
}

export interface PerfProgress {
  elapsedMs: number;
  requestsTotal: number;
  errors: number;
  requestsPerSec: number;
  avgLatencyMs: number;
  bytesPerSec: number;
}

export interface PerformanceRunReport {
  id: string;
  mode: "performance";
  startTime: number;
  stats: PerfStats;
  runnerItems: RunnerItem[];
}

export type RunReport = FunctionalRunReport | PerformanceRunReport;

export type LayoutMode = "vertical" | "horizontal";

export interface ConsoleLog {
  id: string;
  level: "log" | "info" | "warn" | "error" | "request" | "response";
  message: string;
  timestamp: number;
}
