export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | (string & {});

export type Protocol = "http" | "websocket" | "graphql" | "soap" | "grpc";

export type BodyType = "none" | "json" | "form" | "formdata" | "xml" | "text" | "graphql" | "soap";

export type AuthType = "none" | "basic" | "bearer" | "api-key" | "oauth2";

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

export interface OAuth2Config {
  grantType: "client_credentials" | "authorization_code" | "password";
  tokenUrl: string;
  authUrl?: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  username?: string;
  password?: string;
  accessToken?: string;
  tokenExpiry?: number;
  addTo?: "header" | "query";
}

export interface AuthConfig {
  type: AuthType;
  basic?: { username: string; password: string };
  bearer?: { token: string };
  apiKey?: { key: string; value: string; addTo: "header" | "query" };
  oauth2?: OAuth2Config;
}

export interface ApiRequest {
  id: string;
  collectionId: string;
  folderId?: string;
  name: string;
  protocol?: Protocol;
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
  // GraphQL
  graphqlVariables?: string;
  graphqlOperationName?: string;
  // SOAP
  soapAction?: string;
  soapVersion?: "1.1" | "1.2";
  // gRPC
  grpcMetadata?: KeyValue[];
  // API Schema / Docs
  requestSchema?: string;
  responseSchema?: string;
  // Phase 2: extractors & visual assertions
  extractors?: ExtractorRule[];
  visualAssertions?: VisualAssertion[];
  // Meta
  priority?: 0 | 1 | 2 | 3 | 4 | 5;
  requestStatus?: "todo" | "doing" | "done";
  responseExamples?: ResponseExample[];
  createdAt: number;
  updatedAt: number;
}

export interface ResponseExample {
  id: string;
  statusCode: number;
  name: string;
  description?: string;
  body?: string;
}

// ── Phase 2: Variable Extractor ──────────────────────────────────────────────

export type ExtractorSource = "body" | "header" | "status" | "responseTime";
export type ExtractorType = "jsonpath" | "regex" | "header" | "full";

export interface ExtractorRule {
  id: string;
  enabled: boolean;
  varName: string;          // variable name to set (e.g. "authToken")
  source: ExtractorSource;
  type: ExtractorType;
  expression: string;       // $.data.token  |  Bearer (.+)  |  Content-Type
  scope: "collection" | "environment";
}

// ── Phase 2: Visual Test Builder ─────────────────────────────────────────────

export type AssertionSource = "status" | "body" | "header" | "responseTime" | "bodySize";
export type AssertionOperator =
  | "eq" | "ne" | "gt" | "lt" | "gte" | "lte"
  | "contains" | "not_contains"
  | "starts_with" | "ends_with"
  | "exists" | "not_exists"
  | "matches";                // regex

export interface VisualAssertion {
  id: string;
  enabled: boolean;
  name?: string;
  source: AssertionSource;
  field?: string;             // header name, JSON path, or empty for body/status
  operator: AssertionOperator;
  value: string;
}

// ── Phase 2: AI Settings ─────────────────────────────────────────────────────

export type AiProvider = "openai" | "anthropic" | "custom";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;            // e.g. https://api.openai.com/v1  or  http://localhost:11434/v1
  apiKey: string;
  model: string;              // gpt-4o | claude-3-5-sonnet | llama3 …
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

export type LayoutMode = "vertical" | "horizontal" | "hidden" | "fullscreen";

// ── WebSocket ───────────────────────────────────────────────────────────────

export interface WsMessage {
  id: string;
  direction: "sent" | "received" | "info" | "error";
  data: string;
  timestamp: number;
}

// ── Mock API ─────────────────────────────────────────────────────────────────

export interface MockEndpoint {
  id: string;
  name: string;
  method: string;  // GET | POST | PUT | DELETE | PATCH | * (any)
  path: string;    // e.g. /api/users
  statusCode: number;
  responseHeaders: KeyValue[];
  responseBody: string;
  contentType: string;
  delay: number;   // ms
  enabled: boolean;
}

export interface ConsoleLog {
  id: string;
  level: "log" | "info" | "warn" | "error" | "request" | "response";
  message: string;
  timestamp: number;
}

// ── Phase 3: API Spec (Interface Management) ─────────────────────────────────

export type ApiParamType = "string" | "number" | "integer" | "boolean" | "object" | "array";
export type ApiSpecStatus = "draft" | "done" | "deprecated";

export interface ApiParamSchema {
  id: string;
  name: string;
  type: ApiParamType;
  required: boolean;
  defaultValue: string;   // may contain @mock notation e.g. "@username"
  description: string;
  children: ApiParamSchema[];  // nested fields for object / array<object>
}

export interface ApiResponseScenario {
  id: string;
  name: string;          // e.g. "成功", "参数错误", "未授权"
  statusCode: number;
  description: string;
  schema: ApiParamSchema[];
}

export interface ApiSpec {
  id: string;
  collectionId: string;
  name: string;
  method: HttpMethod;
  path: string;          // e.g. /api/v1/users
  status: ApiSpecStatus;
  requiresAuth: boolean;
  mockUrl: string;       // e.g. http://localhost:4010/api/v1/users
  description: string;
  requestParams: ApiParamSchema[];   // query/body params
  requestHeaders: ApiParamSchema[];
  responseScenarios: ApiResponseScenario[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// ── Phase 3: Stress Test ─────────────────────────────────────────────────────

export interface StressTestConfig {
  connections: number;    // concurrent connections
  duration: number;       // seconds (0 = use totalRequests)
  totalRequests: number;  // 0 = use duration
  rateLimit: number;      // req/s, 0 = unlimited
  timeout: number;        // ms per request
}

export interface StressTestSample {
  timestamp: number;
  latency: number;
  status: number;
  error?: string;
}

export interface StressTestResult {
  total: number;
  success: number;
  errors: number;
  rps: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50: number;
  p95: number;
  p99: number;
  durationMs: number;
  statusCodes: Record<string, number>;
  samples: StressTestSample[];  // downsampled for chart
}
