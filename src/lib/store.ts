"use client";

import { create } from "zustand";
import {
  readWorkspace, writeWorkspace, readAppConfig, writeAppConfig,
  pickDirectory, workspaceNameFromPath,
  type WorkspaceFileData,
} from "./workspace";
import type {
  ApiRequest,
  ApiSpec,
  Collection,
  CollectionVariable,
  ConsoleLog,
  Environment,
  Folder,
  HistoryItem,
  HttpMethod,
  LayoutMode,
  AiSettings,
  MockEndpoint,
  PerfProgress,
  PerfTestConfig,
  Protocol,
  ResponseData,
  RunnerItem,
  RunnerMode,
  RunReport,
  TestResult,
  WsMessage,
} from "./types";
import type { InstalledPlugin, PluginLogEntry } from "./plugin-types";
import type { WsFilterRule, WsStateMachine } from "./ws-sm-types";
import { createHeartbeatFilterRule } from "./ws-filter";

function uuid() {
  return crypto.randomUUID();
}

function newRequest(collectionId: string): ApiRequest {
  return {
    id: uuid(),
    collectionId,
    name: "New Request",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: { type: "none", content: "", formData: [] },
    auth: { type: "none" },
    seq: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

interface AppState {
  collections: Collection[];
  folders: Folder[];
  requests: ApiRequest[];
  history: HistoryItem[];
  environments: Environment[];
  activeEnvironmentId: string | null;

  activeRequestId: string | null;
  activeTab: string;
  openRequestIds: string[];
  response: ResponseData | null;
  testResults: TestResult[];
  isLoading: boolean;
  expandedCollections: Set<string>;
  expandedFolders: Set<string>;
  layoutMode: LayoutMode;
  consoleLogs: ConsoleLog[];
  consoleOpen: boolean;

  // WebSocket (session, not persisted)
  wsMessages: WsMessage[];
  wsConnected: boolean;
  addWsMessage: (msg: WsMessage) => void;
  clearWsMessages: () => void;
  setWsConnected: (v: boolean) => void;

  // WebSocket filters & state machines (persisted)
  wsFilters: WsFilterRule[];
  wsStateMachines: WsStateMachine[];
  addWsFilter: (rule: WsFilterRule) => void;
  updateWsFilter: (id: string, data: Partial<WsFilterRule>) => void;
  deleteWsFilter: (id: string) => void;
  reorderWsFilters: (rules: WsFilterRule[]) => void;
  addWsStateMachine: (sm: WsStateMachine) => void;
  updateWsStateMachine: (id: string, data: Partial<WsStateMachine>) => void;
  deleteWsStateMachine: (id: string) => void;

  // AI Settings
  aiSettings: AiSettings;
  setAiSettings: (settings: Partial<AiSettings>) => void;

  // Mock API
  mockEndpoints: MockEndpoint[];
  mockServerPort: number;
  mockServerRunning: boolean;
  addMockEndpoint: (ep: Omit<MockEndpoint, "id">) => MockEndpoint;
  updateMockEndpoint: (id: string, data: Partial<MockEndpoint>) => void;
  deleteMockEndpoint: (id: string) => void;
  setMockServerPort: (port: number) => void;
  setMockServerRunning: (v: boolean) => void;

  // Collection actions
  addCollection: (name: string) => Collection;
  updateCollection: (id: string, data: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;
  addVariable: (collectionId: string, variable: Omit<CollectionVariable, "id">) => void;
  updateVariable: (collectionId: string, varId: string, data: Partial<CollectionVariable>) => void;
  deleteVariable: (collectionId: string, varId: string) => void;

  // Folder actions
  addFolder: (collectionId: string, name: string, parentId?: string) => void;
  updateFolder: (id: string, data: Partial<Folder>) => void;
  deleteFolder: (id: string) => void;

  // Request actions
  addRequest: (collectionId: string, folderId?: string, opts?: { protocol?: Protocol; method?: HttpMethod; name?: string }) => ApiRequest;
  importRequests: (collectionId: string, requests: Omit<ApiRequest, "id" | "collectionId" | "seq" | "createdAt" | "updatedAt">[]) => void;
  updateRequest: (id: string, data: Partial<ApiRequest>) => void;
  deleteRequest: (id: string) => void;
  duplicateRequest: (id: string) => void;

  // Environment actions
  addEnvironment: (name: string) => Environment;
  updateEnvironment: (id: string, data: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  setActiveEnvironment: (id: string | null) => void;
  setEnvironmentVariable: (envId: string, name: string, value: string) => void;

  // UI actions
  setActiveRequest: (id: string | null) => void;
  setActiveTab: (tab: string) => void;
  openRequest: (id: string) => void;
  closeRequest: (id: string) => void;
  setResponse: (response: ResponseData | null) => void;
  setTestResults: (results: TestResult[]) => void;
  setLoading: (loading: boolean) => void;
  toggleCollection: (id: string) => void;
  toggleFolder: (id: string) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  addConsoleLogs: (logs: ConsoleLog[]) => void;
  clearConsoleLogs: () => void;
  setConsoleOpen: (open: boolean) => void;

  // History
  addHistory: (item: Omit<HistoryItem, "id" | "timestamp">) => void;
  clearHistory: () => void;

  // Runner
  runnerCollectionId: string | null;
  runnerMode: RunnerMode;
  runnerItems: RunnerItem[];
  runnerPerfConfig: PerfTestConfig;
  runReport: RunReport | null;
  isRunnerRunning: boolean;
  perfLiveStats: PerfProgress | null;
  pendingRerun: boolean;

  setRunnerCollectionId: (id: string | null) => void;
  setRunnerMode: (mode: RunnerMode) => void;
  setRunnerItems: (items: RunnerItem[]) => void;
  updateRunnerPerfConfig: (config: Partial<PerfTestConfig>) => void;
  setRunReport: (report: RunReport | null) => void;
  setIsRunnerRunning: (v: boolean) => void;
  setPerfLiveStats: (stats: PerfProgress | null) => void;
  setPendingRerun: (v: boolean) => void;

  // API Specs (Interface Management)
  apiSpecs: ApiSpec[];
  addApiSpec: (collectionId: string) => ApiSpec;
  updateApiSpec: (id: string, data: Partial<ApiSpec>) => void;
  deleteApiSpec: (id: string) => void;
  duplicateApiSpec: (id: string) => void;
  activeApiSpecId: string | null;
  setActiveApiSpecId: (id: string | null) => void;

  // Workspace
  workspacePath: string | null;
  recentWorkspaces: Array<{ path: string; name: string }>;
  loadWorkspace: (dirPath: string) => Promise<void>;
  createWorkspace: (dirPath: string) => Promise<void>;
  openWorkspacePicker: () => Promise<void>;
  addRecentWorkspace: (path: string, name: string) => void;
  saveWorkspaceNow: () => Promise<void>;

  // Plugin System
  /** Loaded plugin list (refreshed from disk) */
  plugins: InstalledPlugin[];
  setPlugins: (plugins: InstalledPlugin[]) => void;
  setPluginEnabled: (id: string, enabled: boolean) => void;
  setPluginConfig: (id: string, config: Record<string, string>) => void;
  /** Persisted per-plugin state (enabled flag + config) */
  pluginPersistedState: Record<string, { enabled: boolean; config: Record<string, string> }>;
  /** Plugin console logs */
  pluginLogs: PluginLogEntry[];
  addPluginLog: (entry: PluginLogEntry) => void;
  clearPluginLogs: () => void;
}

export const useAppStore = create<AppState>()(
  (set, get) => ({
      collections: [
        {
          id: "sample-collection",
          name: "Sample API Collection",
          variables: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "stusdt-collection",
          name: "stusdt",
          variables: [
            { id: uuid(), name: "stusdt", value: "https://api.stusdt.io", enabled: true },
            { id: uuid(), name: "address", value: "0x1234567890abcdef", enabled: true },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "cls-demo",
          name: "实时课堂 Demo API",
          description: "基于 demo-ws-api，覆盖 HTTP Session / GraphQL / SOAP / JSON-RPC / XML-RPC / gRPC / WebSocket / tRPC / MQTT / CAN Bus 等 12 套协议",
          variables: [
            { id: "cdv-1", name: "base_url",         value: "http://localhost:8000", enabled: true },
            { id: "cdv-2", name: "grpc_addr",        value: "localhost:50052",       enabled: true },
            { id: "cdv-3", name: "teacher_id",       value: "tea001",               enabled: true },
            { id: "cdv-4", name: "teacher_pwd",      value: "teacher123",           enabled: true },
            { id: "cdv-5", name: "student_id",       value: "stu001",               enabled: true },
            { id: "cdv-6", name: "student_pwd",      value: "123456",               enabled: true },
            { id: "cdv-7", name: "classroom_id",     value: "cls001",               enabled: true },
          ],
          createdAt: 1718000000000,
          updatedAt: 1718000000000,
        },
      ],
      folders: [
        { id: "cdf-http",  collectionId: "cls-demo", name: "HTTP Session / Cookie", seq: 1 },
        { id: "cdf-gql",   collectionId: "cls-demo", name: "GraphQL",               seq: 2 },
        { id: "cdf-s11",   collectionId: "cls-demo", name: "SOAP 1.1",              seq: 3 },
        { id: "cdf-s12",   collectionId: "cls-demo", name: "SOAP 1.2",              seq: 4 },
        { id: "cdf-jrpc",  collectionId: "cls-demo", name: "JSON-RPC 2.0",          seq: 5 },
        { id: "cdf-xrpc",  collectionId: "cls-demo", name: "XML-RPC",               seq: 6 },
        { id: "cdf-grpc",  collectionId: "cls-demo", name: "gRPC",                  seq: 7 },
        { id: "cdf-ws",    collectionId: "cls-demo", name: "WebSocket",             seq: 8 },
        { id: "cdf-trpc",  collectionId: "cls-demo", name: "tRPC",                  seq: 9 },
        { id: "cdf-mqtt",  collectionId: "cls-demo", name: "MQTT",                  seq: 10 },
        { id: "cdf-can",   collectionId: "cls-demo", name: "CAN Bus",               seq: 11 },
      ],
      requests: [
        {
          id: "req-get-users",
          collectionId: "sample-collection",
          name: "Get Users",
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/users",
          params: [],
          headers: [],
          body: { type: "none", content: "", formData: [] },
          auth: { type: "none" },
          seq: 1,
          description: "This request retrieves a list of users from the JSONPlaceholder API.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "req-stusdt-dashboard",
          collectionId: "stusdt-collection",
          name: "stUSDT Dashboard",
          method: "GET",
          url: "{{stusdt}}/stusdt/dashboard",
          params: [],
          headers: [],
          body: { type: "none", content: "", formData: [] },
          auth: { type: "none" },
          seq: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "req-stusdt-eth-dashboard",
          collectionId: "stusdt-collection",
          name: "stUSDT Ethereum Dashboard",
          method: "GET",
          url: "{{stusdt}}/ethereum/stusdt/dashboard",
          params: [],
          headers: [],
          body: { type: "none", content: "", formData: [] },
          auth: { type: "none" },
          seq: 2,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "req-address-overview",
          collectionId: "stusdt-collection",
          name: "Address Overview",
          method: "GET",
          url: "{{stusdt}}/stusdt/dashboard/{{address}}/earning/export",
          params: [],
          headers: [],
          body: { type: "none", content: "", formData: [] },
          auth: { type: "none" },
          seq: 3,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },

        // ── 实时课堂 Demo：HTTP Session / Cookie ──────────────────────────────
        {
          id: "cdr-h01", collectionId: "cls-demo", folderId: "cdf-http",
          name: "教师登录", protocol: "http", method: "POST",
          url: "{{base_url}}/api/teacher/login",
          params: [], headers: [{ id: "ch01-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "teacher_id": "{{teacher_id}}",\n  "password": "{{teacher_pwd}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 1,
          description: "教师登录，响应中自动设置 session Cookie",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h02", collectionId: "cls-demo", folderId: "cdf-http",
          name: "学生登录", protocol: "http", method: "POST",
          url: "{{base_url}}/api/student/login",
          params: [], headers: [{ id: "ch02-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "student_id": "{{student_id}}",\n  "password": "{{student_pwd}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 2,
          description: "学生登录，响应中自动设置 session Cookie",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h03", collectionId: "cls-demo", folderId: "cdf-http",
          name: "当前 Session 信息", protocol: "http", method: "GET",
          url: "{{base_url}}/api/session/info",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 3,
          description: "查看当前登录用户信息（需先登录）",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h04", collectionId: "cls-demo", folderId: "cdf-http",
          name: "教室列表", protocol: "http", method: "GET",
          url: "{{base_url}}/api/classrooms",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h05", collectionId: "cls-demo", folderId: "cdf-http",
          name: "教室详情", protocol: "http", method: "GET",
          url: "{{base_url}}/api/classrooms/{{classroom_id}}",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 5,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h06", collectionId: "cls-demo", folderId: "cdf-http",
          name: "开始上课（教师）", protocol: "http", method: "POST",
          url: "{{base_url}}/api/lesson/start",
          params: [], headers: [{ id: "ch06-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 6,
          description: "需要教师 Session Cookie；课程开始后学生才能进入",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h07", collectionId: "cls-demo", folderId: "cdf-http",
          name: "学生进入教室", protocol: "http", method: "POST",
          url: "{{base_url}}/api/classroom/enter",
          params: [], headers: [{ id: "ch07-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 7,
          description: "需要学生 Session Cookie；需先开课",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h08", collectionId: "cls-demo", folderId: "cdf-http",
          name: "学生签到", protocol: "http", method: "POST",
          url: "{{base_url}}/api/classroom/check-in",
          params: [], headers: [{ id: "ch08-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 8,
          description: "需要学生 Session Cookie；需先进入教室",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h09", collectionId: "cls-demo", folderId: "cdf-http",
          name: "签到记录", protocol: "http", method: "GET",
          url: "{{base_url}}/api/classrooms/{{classroom_id}}/attendance",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 9,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-h10", collectionId: "cls-demo", folderId: "cdf-http",
          name: "结束上课（教师）", protocol: "http", method: "POST",
          url: "{{base_url}}/api/lesson/end",
          params: [], headers: [{ id: "ch10-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 10,
          description: "需要教师 Session Cookie；返回签到汇总",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：GraphQL ─────────────────────────────────────────────
        {
          id: "cdr-g01", collectionId: "cls-demo", folderId: "cdf-gql",
          name: "查询教室列表", protocol: "graphql", method: "POST",
          url: "{{base_url}}/graphql",
          params: [], headers: [],
          body: {
            type: "graphql",
            content: `query {
  classrooms {
    id
    name
    teacherName
    location
    capacity
    inSession
    studentsPresentCount
  }
}`,
            formData: [],
          },
          graphqlVariables: "{}",
          auth: { type: "none" }, seq: 1,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-g02", collectionId: "cls-demo", folderId: "cdf-gql",
          name: "查询教室详情", protocol: "graphql", method: "POST",
          url: "{{base_url}}/graphql",
          params: [], headers: [],
          body: {
            type: "graphql",
            content: `query GetClassroom($id: String!) {
  classroom(classroomId: $id) {
    name
    teacherName
    location
    capacity
    inSession
    lessonStartTime
    studentsPresent {
      id
      name
      checkedIn
      checkInTime
    }
    attendanceCount
  }
}`,
            formData: [],
          },
          graphqlVariables: '{\n  "id": "{{classroom_id}}"\n}',
          auth: { type: "none" }, seq: 2,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-g03", collectionId: "cls-demo", folderId: "cdf-gql",
          name: "查询签到记录", protocol: "graphql", method: "POST",
          url: "{{base_url}}/graphql",
          params: [], headers: [],
          body: {
            type: "graphql",
            content: `query {
  attendance(classroomId: "{{classroom_id}}") {
    total
    attendance {
      studentId
      studentName
      checkInTime
    }
  }
}`,
            formData: [],
          },
          graphqlVariables: "{}",
          auth: { type: "none" }, seq: 3,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-g04", collectionId: "cls-demo", folderId: "cdf-gql",
          name: "开始上课 (mutation)", protocol: "graphql", method: "POST",
          url: "{{base_url}}/graphql",
          params: [], headers: [],
          body: {
            type: "graphql",
            content: `mutation {
  startLesson(teacherId: "{{teacher_id}}", classroomId: "{{classroom_id}}") {
    success
    message
    lessonStartTime
  }
}`,
            formData: [],
          },
          graphqlVariables: "{}",
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-g05", collectionId: "cls-demo", folderId: "cdf-gql",
          name: "学生进入教室 (mutation)", protocol: "graphql", method: "POST",
          url: "{{base_url}}/graphql",
          params: [], headers: [],
          body: {
            type: "graphql",
            content: `mutation {
  enterClassroom(studentId: "{{student_id}}", classroomId: "{{classroom_id}}") {
    success
    message
    studentsCount
  }
}`,
            formData: [],
          },
          graphqlVariables: "{}",
          auth: { type: "none" }, seq: 5,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-g06", collectionId: "cls-demo", folderId: "cdf-gql",
          name: "学生签到 (mutation)", protocol: "graphql", method: "POST",
          url: "{{base_url}}/graphql",
          params: [], headers: [],
          body: {
            type: "graphql",
            content: `mutation {
  checkIn(studentId: "{{student_id}}", classroomId: "{{classroom_id}}") {
    success
    message
    checkInTime
  }
}`,
            formData: [],
          },
          graphqlVariables: "{}",
          auth: { type: "none" }, seq: 6,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-g07", collectionId: "cls-demo", folderId: "cdf-gql",
          name: "结束上课 (mutation)", protocol: "graphql", method: "POST",
          url: "{{base_url}}/graphql",
          params: [], headers: [],
          body: {
            type: "graphql",
            content: `mutation {
  endLesson(teacherId: "{{teacher_id}}", classroomId: "{{classroom_id}}") {
    success
    message
    studentsCount
  }
}`,
            formData: [],
          },
          graphqlVariables: "{}",
          auth: { type: "none" }, seq: 7,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：SOAP 1.1 ────────────────────────────────────────────
        {
          id: "cdr-s11-01", collectionId: "cls-demo", folderId: "cdf-s11",
          name: "TeacherLogin", protocol: "soap", method: "POST", soapVersion: "1.1", soapAction: "TeacherLogin",
          url: "{{base_url}}/soap/1.1", params: [],
          headers: [
            { id: "cs11-01a", key: "Content-Type", value: "text/xml; charset=utf-8", enabled: true },
            { id: "cs11-01b", key: "SOAPAction",   value: "TeacherLogin",            enabled: true },
          ],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <cls:TeacherLogin xmlns:cls="http://demo.classroom/service">
      <cls:teacherId>tea001</cls:teacherId>
      <cls:password>teacher123</cls:password>
    </cls:TeacherLogin>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 1,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-s11-02", collectionId: "cls-demo", folderId: "cdf-s11",
          name: "StartLesson", protocol: "soap", method: "POST", soapVersion: "1.1", soapAction: "StartLesson",
          url: "{{base_url}}/soap/1.1", params: [],
          headers: [
            { id: "cs11-02a", key: "Content-Type", value: "text/xml; charset=utf-8", enabled: true },
            { id: "cs11-02b", key: "SOAPAction",   value: "StartLesson",             enabled: true },
          ],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <cls:StartLesson xmlns:cls="http://demo.classroom/service">
      <cls:teacherId>tea001</cls:teacherId>
      <cls:classroomId>cls001</cls:classroomId>
    </cls:StartLesson>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 2,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-s11-03", collectionId: "cls-demo", folderId: "cdf-s11",
          name: "EnterClassroom", protocol: "soap", method: "POST", soapVersion: "1.1", soapAction: "EnterClassroom",
          url: "{{base_url}}/soap/1.1", params: [],
          headers: [
            { id: "cs11-03a", key: "Content-Type", value: "text/xml; charset=utf-8", enabled: true },
            { id: "cs11-03b", key: "SOAPAction",   value: "EnterClassroom",          enabled: true },
          ],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <cls:EnterClassroom xmlns:cls="http://demo.classroom/service">
      <cls:studentId>stu001</cls:studentId>
      <cls:classroomId>cls001</cls:classroomId>
    </cls:EnterClassroom>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 3,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-s11-04", collectionId: "cls-demo", folderId: "cdf-s11",
          name: "CheckIn", protocol: "soap", method: "POST", soapVersion: "1.1", soapAction: "CheckIn",
          url: "{{base_url}}/soap/1.1", params: [],
          headers: [
            { id: "cs11-04a", key: "Content-Type", value: "text/xml; charset=utf-8", enabled: true },
            { id: "cs11-04b", key: "SOAPAction",   value: "CheckIn",                 enabled: true },
          ],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <cls:CheckIn xmlns:cls="http://demo.classroom/service">
      <cls:studentId>stu001</cls:studentId>
      <cls:classroomId>cls001</cls:classroomId>
    </cls:CheckIn>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-s11-05", collectionId: "cls-demo", folderId: "cdf-s11",
          name: "ListClassrooms", protocol: "soap", method: "POST", soapVersion: "1.1", soapAction: "ListClassrooms",
          url: "{{base_url}}/soap/1.1", params: [],
          headers: [
            { id: "cs11-05a", key: "Content-Type", value: "text/xml; charset=utf-8", enabled: true },
            { id: "cs11-05b", key: "SOAPAction",   value: "ListClassrooms",          enabled: true },
          ],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <cls:ListClassrooms xmlns:cls="http://demo.classroom/service"/>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 5,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-s11-06", collectionId: "cls-demo", folderId: "cdf-s11",
          name: "GetAttendance", protocol: "soap", method: "POST", soapVersion: "1.1", soapAction: "GetAttendance",
          url: "{{base_url}}/soap/1.1", params: [],
          headers: [
            { id: "cs11-06a", key: "Content-Type", value: "text/xml; charset=utf-8", enabled: true },
            { id: "cs11-06b", key: "SOAPAction",   value: "GetAttendance",           enabled: true },
          ],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <cls:GetAttendance xmlns:cls="http://demo.classroom/service">
      <cls:classroomId>cls001</cls:classroomId>
    </cls:GetAttendance>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 6,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：SOAP 1.2 ────────────────────────────────────────────
        {
          id: "cdr-s12-01", collectionId: "cls-demo", folderId: "cdf-s12",
          name: "StartLesson (1.2)", protocol: "soap", method: "POST", soapVersion: "1.2",
          url: "{{base_url}}/soap/1.2", params: [],
          headers: [{ id: "cs12-01a", key: "Content-Type", value: "application/soap+xml; charset=utf-8", enabled: true }],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <cls:StartLesson xmlns:cls="http://demo.classroom/service">
      <cls:teacherId>tea001</cls:teacherId>
      <cls:classroomId>cls001</cls:classroomId>
    </cls:StartLesson>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 1,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-s12-02", collectionId: "cls-demo", folderId: "cdf-s12",
          name: "EnterClassroom (1.2)", protocol: "soap", method: "POST", soapVersion: "1.2",
          url: "{{base_url}}/soap/1.2", params: [],
          headers: [{ id: "cs12-02a", key: "Content-Type", value: "application/soap+xml; charset=utf-8", enabled: true }],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <cls:EnterClassroom xmlns:cls="http://demo.classroom/service">
      <cls:studentId>stu001</cls:studentId>
      <cls:classroomId>cls001</cls:classroomId>
    </cls:EnterClassroom>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 2,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-s12-03", collectionId: "cls-demo", folderId: "cdf-s12",
          name: "CheckIn (1.2)", protocol: "soap", method: "POST", soapVersion: "1.2",
          url: "{{base_url}}/soap/1.2", params: [],
          headers: [{ id: "cs12-03a", key: "Content-Type", value: "application/soap+xml; charset=utf-8", enabled: true }],
          body: {
            type: "soap",
            content: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <cls:CheckIn xmlns:cls="http://demo.classroom/service">
      <cls:studentId>stu001</cls:studentId>
      <cls:classroomId>cls001</cls:classroomId>
    </cls:CheckIn>
  </soap:Body>
</soap:Envelope>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 3,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：JSON-RPC 2.0 ───────────────────────────────────────
        {
          id: "cdr-j01", collectionId: "cls-demo", folderId: "cdf-jrpc",
          name: "lesson.start", protocol: "http", method: "POST",
          url: "{{base_url}}/jsonrpc", params: [],
          headers: [{ id: "cj01-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: '{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "lesson.start",\n  "params": {"teacher_id": "{{teacher_id}}", "classroom_id": "{{classroom_id}}"}\n}',
            formData: [],
          },
          auth: { type: "none" }, seq: 1,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-j02", collectionId: "cls-demo", folderId: "cdf-jrpc",
          name: "classroom.enter", protocol: "http", method: "POST",
          url: "{{base_url}}/jsonrpc", params: [],
          headers: [{ id: "cj02-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: '{\n  "jsonrpc": "2.0",\n  "id": 2,\n  "method": "classroom.enter",\n  "params": {"student_id": "{{student_id}}", "classroom_id": "{{classroom_id}}"}\n}',
            formData: [],
          },
          auth: { type: "none" }, seq: 2,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-j03", collectionId: "cls-demo", folderId: "cdf-jrpc",
          name: "classroom.checkIn", protocol: "http", method: "POST",
          url: "{{base_url}}/jsonrpc", params: [],
          headers: [{ id: "cj03-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: '{\n  "jsonrpc": "2.0",\n  "id": 3,\n  "method": "classroom.checkIn",\n  "params": {"student_id": "{{student_id}}", "classroom_id": "{{classroom_id}}"}\n}',
            formData: [],
          },
          auth: { type: "none" }, seq: 3,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-j04", collectionId: "cls-demo", folderId: "cdf-jrpc",
          name: "classroom.list", protocol: "http", method: "POST",
          url: "{{base_url}}/jsonrpc", params: [],
          headers: [{ id: "cj04-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: '{\n  "jsonrpc": "2.0",\n  "id": 4,\n  "method": "classroom.list",\n  "params": {}\n}',
            formData: [],
          },
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-j05", collectionId: "cls-demo", folderId: "cdf-jrpc",
          name: "classroom.attendance", protocol: "http", method: "POST",
          url: "{{base_url}}/jsonrpc", params: [],
          headers: [{ id: "cj05-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: '{\n  "jsonrpc": "2.0",\n  "id": 5,\n  "method": "classroom.attendance",\n  "params": {"classroom_id": "{{classroom_id}}"}\n}',
            formData: [],
          },
          auth: { type: "none" }, seq: 5,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-j06", collectionId: "cls-demo", folderId: "cdf-jrpc",
          name: "批量请求（enter + checkIn）", protocol: "http", method: "POST",
          url: "{{base_url}}/jsonrpc", params: [],
          headers: [{ id: "cj06-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: `[
  {
    "jsonrpc": "2.0", "id": 1,
    "method": "classroom.enter",
    "params": {"student_id": "stu002", "classroom_id": "{{classroom_id}}"}
  },
  {
    "jsonrpc": "2.0", "id": 2,
    "method": "classroom.checkIn",
    "params": {"student_id": "stu002", "classroom_id": "{{classroom_id}}"}
  }
]`,
            formData: [],
          },
          auth: { type: "none" }, seq: 6,
          description: "JSON-RPC 2.0 批量请求，stu002 一步完成进教室+签到",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：XML-RPC ────────────────────────────────────────────
        {
          id: "cdr-x01", collectionId: "cls-demo", folderId: "cdf-xrpc",
          name: "startLesson", protocol: "http", method: "POST",
          url: "{{base_url}}/xmlrpc", params: [],
          headers: [{ id: "cx01-a", key: "Content-Type", value: "text/xml", enabled: true }],
          body: {
            type: "xml",
            content: `<?xml version="1.0"?>
<methodCall>
  <methodName>classroom.startLesson</methodName>
  <params>
    <param><value><string>tea001</string></value></param>
    <param><value><string>cls001</string></value></param>
  </params>
</methodCall>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 1,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-x02", collectionId: "cls-demo", folderId: "cdf-xrpc",
          name: "enterClassroom", protocol: "http", method: "POST",
          url: "{{base_url}}/xmlrpc", params: [],
          headers: [{ id: "cx02-a", key: "Content-Type", value: "text/xml", enabled: true }],
          body: {
            type: "xml",
            content: `<?xml version="1.0"?>
<methodCall>
  <methodName>classroom.enterClassroom</methodName>
  <params>
    <param><value><string>stu001</string></value></param>
    <param><value><string>cls001</string></value></param>
  </params>
</methodCall>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 2,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-x03", collectionId: "cls-demo", folderId: "cdf-xrpc",
          name: "checkIn", protocol: "http", method: "POST",
          url: "{{base_url}}/xmlrpc", params: [],
          headers: [{ id: "cx03-a", key: "Content-Type", value: "text/xml", enabled: true }],
          body: {
            type: "xml",
            content: `<?xml version="1.0"?>
<methodCall>
  <methodName>classroom.checkIn</methodName>
  <params>
    <param><value><string>stu001</string></value></param>
    <param><value><string>cls001</string></value></param>
  </params>
</methodCall>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 3,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-x04", collectionId: "cls-demo", folderId: "cdf-xrpc",
          name: "getAttendance", protocol: "http", method: "POST",
          url: "{{base_url}}/xmlrpc", params: [],
          headers: [{ id: "cx04-a", key: "Content-Type", value: "text/xml", enabled: true }],
          body: {
            type: "xml",
            content: `<?xml version="1.0"?>
<methodCall>
  <methodName>classroom.getAttendance</methodName>
  <params>
    <param><value><string>cls001</string></value></param>
  </params>
</methodCall>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-x05", collectionId: "cls-demo", folderId: "cdf-xrpc",
          name: "listClassrooms", protocol: "http", method: "POST",
          url: "{{base_url}}/xmlrpc", params: [],
          headers: [{ id: "cx05-a", key: "Content-Type", value: "text/xml", enabled: true }],
          body: {
            type: "xml",
            content: `<?xml version="1.0"?>
<methodCall>
  <methodName>classroom.listClassrooms</methodName>
  <params/>
</methodCall>`,
            formData: [],
          },
          auth: { type: "none" }, seq: 5,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：gRPC ────────────────────────────────────────────────
        {
          id: "cdr-grpc-01", collectionId: "cls-demo", folderId: "cdf-grpc",
          name: "TeacherLogin", protocol: "grpc", method: "POST",
          url: "grpc://{{grpc_addr}}/classroom.ClassroomService/TeacherLogin",
          params: [], headers: [],
          body: { type: "json", content: '{\n  "teacher_id": "{{teacher_id}}",\n  "password": "{{teacher_pwd}}"\n}', formData: [] },
          grpcMetadata: [],
          auth: { type: "none" }, seq: 1,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-grpc-02", collectionId: "cls-demo", folderId: "cdf-grpc",
          name: "StartLesson", protocol: "grpc", method: "POST",
          url: "grpc://{{grpc_addr}}/classroom.ClassroomService/StartLesson",
          params: [], headers: [],
          body: { type: "json", content: '{\n  "teacher_id": "{{teacher_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          grpcMetadata: [],
          auth: { type: "none" }, seq: 2,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-grpc-03", collectionId: "cls-demo", folderId: "cdf-grpc",
          name: "EnterClassroom", protocol: "grpc", method: "POST",
          url: "grpc://{{grpc_addr}}/classroom.ClassroomService/EnterClassroom",
          params: [], headers: [],
          body: { type: "json", content: '{\n  "student_id": "{{student_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          grpcMetadata: [],
          auth: { type: "none" }, seq: 3,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-grpc-04", collectionId: "cls-demo", folderId: "cdf-grpc",
          name: "CheckIn", protocol: "grpc", method: "POST",
          url: "grpc://{{grpc_addr}}/classroom.ClassroomService/CheckIn",
          params: [], headers: [],
          body: { type: "json", content: '{\n  "student_id": "{{student_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          grpcMetadata: [],
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-grpc-05", collectionId: "cls-demo", folderId: "cdf-grpc",
          name: "ListClassrooms", protocol: "grpc", method: "POST",
          url: "grpc://{{grpc_addr}}/classroom.ClassroomService/ListClassrooms",
          params: [], headers: [],
          body: { type: "json", content: "{}",  formData: [] },
          grpcMetadata: [],
          auth: { type: "none" }, seq: 5,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-grpc-06", collectionId: "cls-demo", folderId: "cdf-grpc",
          name: "GetAttendance", protocol: "grpc", method: "POST",
          url: "grpc://{{grpc_addr}}/classroom.ClassroomService/GetAttendance",
          params: [], headers: [],
          body: { type: "json", content: '{\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          grpcMetadata: [],
          auth: { type: "none" }, seq: 6,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-grpc-07", collectionId: "cls-demo", folderId: "cdf-grpc",
          name: "EndLesson", protocol: "grpc", method: "POST",
          url: "grpc://{{grpc_addr}}/classroom.ClassroomService/EndLesson",
          params: [], headers: [],
          body: { type: "json", content: '{\n  "teacher_id": "{{teacher_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          grpcMetadata: [],
          auth: { type: "none" }, seq: 7,
          description: "结束上课，返回签到汇总",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：WebSocket ──────────────────────────────────────────
        {
          id: "cdr-ws-01", collectionId: "cls-demo", folderId: "cdf-ws",
          name: "课堂实时连接（学生）", protocol: "websocket", method: "GET",
          url: "ws://localhost:8000/ws/classroom",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 1,
          description: `连接后第一条消息发送认证：
{"type":"auth","data":{"token":"stu001:张三:student"}}

进入教室：
{"type":"join_classroom","data":{"classroom_id":"cls001"}}

学生签到：
{"type":"check_in","data":{}}`,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-ws-02", collectionId: "cls-demo", folderId: "cdf-ws",
          name: "课堂实时连接（教师）", protocol: "websocket", method: "GET",
          url: "ws://localhost:8000/ws/classroom",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 2,
          description: `连接后认证：
{"type":"auth","data":{"token":"tea001:王老师:teacher"}}

进入教室：
{"type":"join_classroom","data":{"classroom_id":"cls001"}}

发起签到（60秒）：
{"type":"check_in_start","data":{"duration":60}}

发起答题：
{"type":"quiz_start","data":{"question":"以下哪个是质数？","options":["A.1","B.2","C.4","D.9"],"correct_answer":1,"duration":30}}`,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-ws-03", collectionId: "cls-demo", folderId: "cdf-ws",
          name: "WebRTC 信令（教室 cls001）", protocol: "websocket", method: "GET",
          url: "ws://localhost:8000/webrtc/ws/cls001",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 3,
          description: `加入房间：
{"type":"join","user_id":"stu001","name":"张三","role":"student"}

离开：
{"type":"leave"}`,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：tRPC ───────────────────────────────────────────────
        {
          id: "cdr-t01", collectionId: "cls-demo", folderId: "cdf-trpc",
          name: "classrooms.list (query)", protocol: "http", method: "GET",
          url: "{{base_url}}/trpc/classrooms.list",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 1,
          description: "tRPC v10 query — 列出所有教室",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-t02", collectionId: "cls-demo", folderId: "cdf-trpc",
          name: "classrooms.get (query)", protocol: "http", method: "GET",
          url: "{{base_url}}/trpc/classrooms.get",
          params: [{ id: "ct02-p1", key: "input", value: '{"json":{"classroomId":"{{classroom_id}}"}}', enabled: true }],
          headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 2,
          description: "tRPC v10 query — 教室详情（input 参数 URL 编码）",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-t03", collectionId: "cls-demo", folderId: "cdf-trpc",
          name: "lesson.start (mutation)", protocol: "http", method: "POST",
          url: "{{base_url}}/trpc/lesson.start",
          params: [], headers: [{ id: "ct03-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "json": {"teacherId": "{{teacher_id}}", "classroomId": "{{classroom_id}}"}\n}', formData: [] },
          auth: { type: "none" }, seq: 3,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-t04", collectionId: "cls-demo", folderId: "cdf-trpc",
          name: "student.enter (mutation)", protocol: "http", method: "POST",
          url: "{{base_url}}/trpc/student.enter",
          params: [], headers: [{ id: "ct04-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "json": {"studentId": "{{student_id}}", "classroomId": "{{classroom_id}}"}\n}', formData: [] },
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-t05", collectionId: "cls-demo", folderId: "cdf-trpc",
          name: "student.checkIn (mutation)", protocol: "http", method: "POST",
          url: "{{base_url}}/trpc/student.checkIn",
          params: [], headers: [{ id: "ct05-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "json": {"studentId": "{{student_id}}", "classroomId": "{{classroom_id}}"}\n}', formData: [] },
          auth: { type: "none" }, seq: 5,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-t06", collectionId: "cls-demo", folderId: "cdf-trpc",
          name: "批量 enter+checkIn", protocol: "http", method: "POST",
          url: "{{base_url}}/trpc/student.enter,student.checkIn",
          params: [], headers: [{ id: "ct06-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: `{
  "0": {"json": {"studentId": "{{student_id}}", "classroomId": "{{classroom_id}}"}},
  "1": {"json": {"studentId": "{{student_id}}", "classroomId": "{{classroom_id}}"}}
}`,
            formData: [],
          },
          auth: { type: "none" }, seq: 6,
          description: "tRPC Batch — 一次请求同时发起进教室+签到",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：MQTT ────────────────────────────────────────────────
        {
          id: "cdr-m01", collectionId: "cls-demo", folderId: "cdf-mqtt",
          name: "开始上课", protocol: "http", method: "POST",
          url: "{{base_url}}/mqtt/lesson/start",
          params: [], headers: [{ id: "cm01-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "teacher_id": "{{teacher_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 1,
          description: "触发 MQTT 发布 classroom/{id}/lesson/start (retain, QoS 1)",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-m02", collectionId: "cls-demo", folderId: "cdf-mqtt",
          name: "学生进入教室", protocol: "http", method: "POST",
          url: "{{base_url}}/mqtt/student/enter",
          params: [], headers: [{ id: "cm02-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "student_id": "{{student_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 2,
          description: "发布 classroom/{id}/student/enter + presence retain",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-m03", collectionId: "cls-demo", folderId: "cdf-mqtt",
          name: "学生签到", protocol: "http", method: "POST",
          url: "{{base_url}}/mqtt/student/checkin",
          params: [], headers: [{ id: "cm03-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "student_id": "{{student_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 3,
          description: "发布 classroom/{id}/student/checkin + attendance retain (QoS 1)",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-m04", collectionId: "cls-demo", folderId: "cdf-mqtt",
          name: "发布任意消息", protocol: "http", method: "POST",
          url: "{{base_url}}/mqtt/publish",
          params: [], headers: [{ id: "cm04-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: {
            type: "json",
            content: '{\n  "topic": "classroom/cls001/notice",\n  "payload": {"text": "请安静"},\n  "qos": 1,\n  "retain": false\n}',
            formData: [],
          },
          auth: { type: "none" }, seq: 4,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-m05", collectionId: "cls-demo", folderId: "cdf-mqtt",
          name: "Retain 消息列表", protocol: "http", method: "GET",
          url: "{{base_url}}/mqtt/retained",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 5,
          description: "相当于 MQTT 客户端订阅 # 并等待所有 retained 消息",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-m06", collectionId: "cls-demo", folderId: "cdf-mqtt",
          name: "MQTT WS 订阅（全部教室）", protocol: "websocket", method: "GET",
          url: "ws://localhost:8000/mqtt/ws?topics=classroom/%23,sensor/%23",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 6,
          description: "订阅 classroom/# 和 sensor/# 所有话题；每条消息格式：{type,topic,payload,qos,retain}",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },

        // ── 实时课堂 Demo：CAN Bus ────────────────────────────────────────────
        {
          id: "cdr-c01", collectionId: "cls-demo", folderId: "cdf-can",
          name: "总线状态", protocol: "http", method: "GET",
          url: "{{base_url}}/can/bus/status",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 1,
          description: "查看 CAN 总线状态与节点列表",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-c02", collectionId: "cls-demo", folderId: "cdf-can",
          name: "教师开课（0x400）", protocol: "http", method: "POST",
          url: "{{base_url}}/can/lesson/control",
          params: [], headers: [{ id: "cc02-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "teacher_id": "{{teacher_id}}",\n  "classroom_id": "{{classroom_id}}",\n  "cmd": "start"\n}', formData: [] },
          auth: { type: "none" }, seq: 2,
          description: "通过 Teacher Console (0x400) 发送 Lesson Control 帧",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-c03", collectionId: "cls-demo", folderId: "cdf-can",
          name: "学生刷卡进教室（0x100）", protocol: "http", method: "POST",
          url: "{{base_url}}/can/badge/scan",
          params: [], headers: [{ id: "cc03-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "student_id": "{{student_id}}",\n  "classroom_id": "{{classroom_id}}",\n  "direction": "enter"\n}', formData: [] },
          auth: { type: "none" }, seq: 3,
          description: "Entry Badge Reader (0x100) 模拟 RFID 刷卡进场",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-c04", collectionId: "cls-demo", folderId: "cdf-can",
          name: "签到确认（0x300）", protocol: "http", method: "POST",
          url: "{{base_url}}/can/attendance/checkin",
          params: [], headers: [{ id: "cc04-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "student_id": "{{student_id}}",\n  "classroom_id": "{{classroom_id}}"\n}', formData: [] },
          auth: { type: "none" }, seq: 4,
          description: "考勤显示终端 (0x300) 确认签到",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-c05", collectionId: "cls-demo", folderId: "cdf-can",
          name: "门锁控制（0x200）", protocol: "http", method: "POST",
          url: "{{base_url}}/can/door/control",
          params: [], headers: [{ id: "cc05-a", key: "Content-Type", value: "application/json", enabled: true }],
          body: { type: "json", content: '{\n  "classroom_id": "{{classroom_id}}",\n  "cmd": "unlock"\n}', formData: [] },
          auth: { type: "none" }, seq: 5,
          description: "Door Lock Controller (0x200)；cmd: lock / unlock / query",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-c06", collectionId: "cls-demo", folderId: "cdf-can",
          name: "CAN 帧历史", protocol: "http", method: "GET",
          url: "{{base_url}}/can/history",
          params: [{ id: "cc06-p1", key: "limit", value: "50", enabled: true }],
          headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 6,
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
        {
          id: "cdr-c07", collectionId: "cls-demo", folderId: "cdf-can",
          name: "CAN WS 实时帧流", protocol: "websocket", method: "GET",
          url: "ws://localhost:8000/can/ws",
          params: [], headers: [], body: { type: "none", content: "", formData: [] },
          auth: { type: "none" }, seq: 7,
          description: "实时接收 CAN 总线帧流",
          createdAt: 1718000000000, updatedAt: 1718000000000,
        },
      ],
      history: [],
      environments: [],
      activeEnvironmentId: null,

      activeRequestId: null,
      activeTab: "params",
      openRequestIds: [],
      response: null,
      testResults: [],
      isLoading: false,
      expandedCollections: new Set(["sample-collection", "stusdt-collection", "cls-demo"]),
      expandedFolders: new Set(),
      layoutMode: "vertical",
      consoleLogs: [],
      consoleOpen: false,

      addCollection: (name) => {
        const col: Collection = {
          id: uuid(),
          name,
          variables: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({
          collections: [...s.collections, col],
          expandedCollections: new Set([...s.expandedCollections, col.id]),
        }));
        return col;
      },

      updateCollection: (id, data) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === id ? { ...c, ...data, updatedAt: Date.now() } : c
          ),
        })),

      deleteCollection: (id) =>
        set((s) => {
          const requestIds = s.requests.filter((r) => r.collectionId === id).map((r) => r.id);
          return {
            collections: s.collections.filter((c) => c.id !== id),
            folders: s.folders.filter((f) => f.collectionId !== id),
            requests: s.requests.filter((r) => r.collectionId !== id),
            openRequestIds: s.openRequestIds.filter((id) => !requestIds.includes(id)),
            activeRequestId: requestIds.includes(s.activeRequestId ?? "") ? null : s.activeRequestId,
          };
        }),

      addVariable: (collectionId, variable) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId
              ? { ...c, variables: [...c.variables, { ...variable, id: uuid() }] }
              : c
          ),
        })),

      updateVariable: (collectionId, varId, data) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId
              ? {
                  ...c,
                  variables: c.variables.map((v) => (v.id === varId ? { ...v, ...data } : v)),
                }
              : c
          ),
        })),

      deleteVariable: (collectionId, varId) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId
              ? { ...c, variables: c.variables.filter((v) => v.id !== varId) }
              : c
          ),
        })),

      addFolder: (collectionId, name, parentId) => {
        const folder: Folder = { id: uuid(), collectionId, parentId, name, seq: Date.now() };
        set((s) => ({ folders: [...s.folders, folder] }));
      },

      updateFolder: (id, data) =>
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...data } : f)) })),

      deleteFolder: (id) =>
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          requests: s.requests.filter((r) => r.folderId !== id),
        })),

      addRequest: (collectionId, folderId, opts) => {
        const PROTOCOL_NAMES: Record<Protocol, string> = {
          http: "New Request", graphql: "New GraphQL Request",
          soap: "New SOAP Request", websocket: "New WebSocket", grpc: "New gRPC Request",
        };
        const base = newRequest(collectionId);
        const req: ApiRequest = {
          ...base,
          folderId,
          ...(opts?.protocol ? { protocol: opts.protocol } : {}),
          ...(opts?.method ? { method: opts.method } : {}),
          name: opts?.name ?? (opts?.protocol ? PROTOCOL_NAMES[opts.protocol] : base.name),
        };
        set((s) => ({
          requests: [...s.requests, req],
          activeRequestId: req.id,
          openRequestIds: s.openRequestIds.includes(req.id) ? s.openRequestIds : [...s.openRequestIds, req.id],
          response: null, testResults: [],
        }));
        return req;
      },

      importRequests: (collectionId, items) => {
        const now = Date.now();
        const newReqs: ApiRequest[] = items.map((item, i) => ({
          ...item,
          id: uuid(),
          collectionId,
          seq: now + i,
          createdAt: now,
          updatedAt: now,
        }));
        set((s) => ({ requests: [...s.requests, ...newReqs] }));
      },

      updateRequest: (id, data) =>
        set((s) => ({
          requests: s.requests.map((r) =>
            r.id === id ? { ...r, ...data, updatedAt: Date.now() } : r
          ),
        })),

      deleteRequest: (id) =>
        set((s) => {
          const openIds = s.openRequestIds.filter((oid) => oid !== id);
          const activeId =
            s.activeRequestId === id
              ? (openIds[openIds.length - 1] ?? null)
              : s.activeRequestId;
          return {
            requests: s.requests.filter((r) => r.id !== id),
            openRequestIds: openIds,
            activeRequestId: activeId,
          };
        }),

      duplicateRequest: (id) => {
        const req = get().requests.find((r) => r.id === id);
        if (!req) return;
        const dup: ApiRequest = {
          ...req,
          id: uuid(),
          name: `${req.name} (copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({
          requests: [...s.requests, dup],
          activeRequestId: dup.id,
          openRequestIds: [...s.openRequestIds, dup.id],
        }));
      },

      // Environments
      addEnvironment: (name) => {
        const env: Environment = {
          id: uuid(),
          name,
          variables: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ environments: [...s.environments, env] }));
        return env;
      },

      updateEnvironment: (id, data) =>
        set((s) => ({
          environments: s.environments.map((e) =>
            e.id === id ? { ...e, ...data, updatedAt: Date.now() } : e
          ),
        })),

      deleteEnvironment: (id) =>
        set((s) => ({
          environments: s.environments.filter((e) => e.id !== id),
          activeEnvironmentId: s.activeEnvironmentId === id ? null : s.activeEnvironmentId,
        })),

      setActiveEnvironment: (id) => set({ activeEnvironmentId: id }),

      setEnvironmentVariable: (envId, name, value) =>
        set((s) => ({
          environments: s.environments.map((e) => {
            if (e.id !== envId) return e;
            const existing = e.variables.find((v) => v.name === name);
            if (existing) {
              return {
                ...e,
                variables: e.variables.map((v) =>
                  v.name === name ? { ...v, value } : v
                ),
              };
            }
            return {
              ...e,
              variables: [...e.variables, { id: uuid(), name, value, enabled: true }],
            };
          }),
        })),

      setActiveRequest: (id) =>
        set((s) => ({
          activeRequestId: id,
          openRequestIds:
            id && !s.openRequestIds.includes(id) ? [...s.openRequestIds, id] : s.openRequestIds,
          response: null,
          testResults: [],
        })),

      setActiveTab: (tab) => set({ activeTab: tab }),

      openRequest: (id) =>
        set((s) => ({
          activeRequestId: id,
          openRequestIds: s.openRequestIds.includes(id) ? s.openRequestIds : [...s.openRequestIds, id],
          response: null,
          testResults: [],
        })),

      closeRequest: (id) =>
        set((s) => {
          const openIds = s.openRequestIds.filter((oid) => oid !== id);
          const activeId =
            s.activeRequestId === id
              ? (openIds[openIds.length - 1] ?? null)
              : s.activeRequestId;
          return { openRequestIds: openIds, activeRequestId: activeId };
        }),

      setResponse: (response) => set({ response }),
      setTestResults: (testResults) => set({ testResults }),
      setLoading: (isLoading) => set({ isLoading }),
      setLayoutMode: (layoutMode) => set({ layoutMode }),
      addConsoleLogs: (logs) => set((s) => ({ consoleLogs: [...s.consoleLogs, ...logs].slice(-500) })),
      clearConsoleLogs: () => set({ consoleLogs: [] }),
      setConsoleOpen: (consoleOpen) => set({ consoleOpen }),

      // WebSocket
      wsMessages: [],
      wsConnected: false,
      addWsMessage: (msg) => set((s) => ({ wsMessages: [...s.wsMessages, msg].slice(-500) })),
      clearWsMessages: () => set({ wsMessages: [] }),
      setWsConnected: (wsConnected) => set({ wsConnected }),

      // WebSocket filters & state machines
      wsFilters: [createHeartbeatFilterRule()],
      wsStateMachines: [],
      addWsFilter: (rule) => set((s) => ({ wsFilters: [...s.wsFilters, rule] })),
      updateWsFilter: (id, data) =>
        set((s) => ({ wsFilters: s.wsFilters.map((r) => (r.id === id ? { ...r, ...data } : r)) })),
      deleteWsFilter: (id) => set((s) => ({ wsFilters: s.wsFilters.filter((r) => r.id !== id) })),
      reorderWsFilters: (rules) => set({ wsFilters: rules }),
      addWsStateMachine: (sm) => set((s) => ({ wsStateMachines: [...s.wsStateMachines, sm] })),
      updateWsStateMachine: (id, data) =>
        set((s) => ({
          wsStateMachines: s.wsStateMachines.map((m) => (m.id === id ? { ...m, ...data } : m)),
        })),
      deleteWsStateMachine: (id) =>
        set((s) => ({ wsStateMachines: s.wsStateMachines.filter((m) => m.id !== id) })),

      // AI Settings
      aiSettings: {
        enabled: false,
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o",
      },
      setAiSettings: (settings) =>
        set((s) => ({ aiSettings: { ...s.aiSettings, ...settings } })),

      // Mock API
      mockEndpoints: [],
      mockServerPort: 4010,
      mockServerRunning: false,
      addMockEndpoint: (ep) => {
        const endpoint = { ...ep, id: uuid() };
        set((s) => ({ mockEndpoints: [...s.mockEndpoints, endpoint] }));
        return endpoint;
      },
      updateMockEndpoint: (id, data) =>
        set((s) => ({ mockEndpoints: s.mockEndpoints.map((e) => (e.id === id ? { ...e, ...data } : e)) })),
      deleteMockEndpoint: (id) =>
        set((s) => ({ mockEndpoints: s.mockEndpoints.filter((e) => e.id !== id) })),
      setMockServerPort: (mockServerPort) => set({ mockServerPort }),
      setMockServerRunning: (mockServerRunning) => set({ mockServerRunning }),

      toggleCollection: (id) =>
        set((s) => {
          const next = new Set(s.expandedCollections);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { expandedCollections: next };
        }),

      toggleFolder: (id) =>
        set((s) => {
          const next = new Set(s.expandedFolders);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { expandedFolders: next };
        }),

      addHistory: (item) =>
        set((s) => ({
          history: [{ ...item, id: uuid(), timestamp: Date.now() }, ...s.history].slice(0, 100),
        })),

      clearHistory: () => set({ history: [] }),

      // Runner
      runnerCollectionId: null,
      runnerMode: "functional",
      runnerItems: [],
      runnerPerfConfig: { connections: 10, duration: 30, rateLimit: 0, timeout: 5000 },
      runReport: null,
      isRunnerRunning: false,
      perfLiveStats: null,
      pendingRerun: false,

      // API Specs
      apiSpecs: [],
      activeApiSpecId: null,
      setActiveApiSpecId: (id) => set({ activeApiSpecId: id }),

      addApiSpec: (collectionId) => {
        const spec: ApiSpec = {
          id: uuid(),
          collectionId,
          name: "New Interface",
          method: "GET",
          path: "/api/v1/resource",
          status: "draft",
          requiresAuth: false,
          mockUrl: "",
          description: "",
          requestParams: [],
          requestHeaders: [],
          responseScenarios: [
            {
              id: uuid(),
              name: "成功",
              statusCode: 200,
              description: "Request succeeded",
              schema: [],
            },
          ],
          tags: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ apiSpecs: [...s.apiSpecs, spec], activeApiSpecId: spec.id }));
        return spec;
      },

      updateApiSpec: (id, data) =>
        set((s) => ({
          apiSpecs: s.apiSpecs.map((spec) =>
            spec.id === id ? { ...spec, ...data, updatedAt: Date.now() } : spec
          ),
        })),

      deleteApiSpec: (id) =>
        set((s) => ({
          apiSpecs: s.apiSpecs.filter((spec) => spec.id !== id),
          activeApiSpecId: s.activeApiSpecId === id
            ? (s.apiSpecs.find((spec) => spec.id !== id)?.id ?? null)
            : s.activeApiSpecId,
        })),

      duplicateApiSpec: (id) => {
        const spec = get().apiSpecs.find((s) => s.id === id);
        if (!spec) return;
        const dup: ApiSpec = {
          ...spec,
          id: uuid(),
          name: `${spec.name} (copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ apiSpecs: [...s.apiSpecs, dup], activeApiSpecId: dup.id }));
      },

      setRunnerCollectionId: (id) =>
        set((s) => {
          const colRequests = s.requests
            .filter((r) => r.collectionId === id)
            .sort((a, b) => a.seq - b.seq);
          return {
            runnerCollectionId: id,
            runnerItems: colRequests.map((r) => ({ requestId: r.id, enabled: true })),
            runReport: null,
            perfLiveStats: null,
          };
        }),

      setRunnerMode: (mode) => set({ runnerMode: mode }),
      setRunnerItems: (items) => set({ runnerItems: items }),
      updateRunnerPerfConfig: (config) =>
        set((s) => ({ runnerPerfConfig: { ...s.runnerPerfConfig, ...config } })),
      setRunReport: (report) => set({ runReport: report }),
      setIsRunnerRunning: (v) => set({ isRunnerRunning: v }),
      setPerfLiveStats: (stats) => set({ perfLiveStats: stats }),
      setPendingRerun: (v) => set({ pendingRerun: v }),

      // ── Plugin System ──────────────────────────────────────────────────
      plugins: [],
      pluginPersistedState: {},
      pluginLogs: [],
      setPlugins: (plugins) => set({ plugins }),
      setPluginEnabled: (id, enabled) =>
        set((s) => ({
          pluginPersistedState: {
            ...s.pluginPersistedState,
            [id]: { ...s.pluginPersistedState[id], enabled },
          },
          plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled } : p)),
        })),
      setPluginConfig: (id, config) =>
        set((s) => ({
          pluginPersistedState: {
            ...s.pluginPersistedState,
            [id]: { ...s.pluginPersistedState[id], config },
          },
          plugins: s.plugins.map((p) => (p.id === id ? { ...p, config } : p)),
        })),
      addPluginLog: (entry) =>
        set((s) => ({ pluginLogs: [...s.pluginLogs.slice(-499), entry] })),
      clearPluginLogs: () => set({ pluginLogs: [] }),

      // ── Workspace ─────────────────────────────────────────────────────────
      workspacePath: null,
      recentWorkspaces: [],

      loadWorkspace: async (dirPath) => {
        const data = await readWorkspace(dirPath);
        if (!data) return;
        const name = workspaceNameFromPath(dirPath);
        const loadedRequests = (data.requests ?? []) as AppState["requests"];
        const validIds = new Set(loadedRequests.map((r) => r.id));
        const loadedOpenIds = ((data.openRequestIds ?? []) as string[]).filter((id) => validIds.has(id));
        const savedActiveId = data.activeRequestId as string | null | undefined;
        const loadedActiveId = savedActiveId && validIds.has(savedActiveId)
          ? savedActiveId
          : (loadedOpenIds[loadedOpenIds.length - 1] ?? null);
        set({
          workspacePath: dirPath,
          collections: (data.collections ?? []) as AppState["collections"],
          folders: (data.folders ?? []) as AppState["folders"],
          requests: loadedRequests,
          history: (data.history ?? []) as AppState["history"],
          environments: (data.environments ?? []) as AppState["environments"],
          activeEnvironmentId: data.activeEnvironmentId ?? null,
          layoutMode: (data.layoutMode ?? "vertical") as AppState["layoutMode"],
          mockEndpoints: (data.mockEndpoints ?? []) as AppState["mockEndpoints"],
          mockServerPort: data.mockServerPort ?? 3001,
          aiSettings: (data.aiSettings ?? get().aiSettings) as AppState["aiSettings"],
          apiSpecs: (data.apiSpecs ?? []) as AppState["apiSpecs"],
          pluginPersistedState: (data.pluginPersistedState ?? {}) as AppState["pluginPersistedState"],
          wsFilters: (data.wsFilters ?? []) as AppState["wsFilters"],
          wsStateMachines: (data.wsStateMachines ?? []) as AppState["wsStateMachines"],
          openRequestIds: loadedOpenIds,
          activeRequestId: loadedActiveId,
          response: null,
          testResults: [],
        });
        get().addRecentWorkspace(dirPath, name);
        await writeAppConfig({
          lastWorkspacePath: dirPath,
          recentWorkspaces: get().recentWorkspaces,
        });
      },

      createWorkspace: async (dirPath) => {
        const s = get();
        const emptyData: WorkspaceFileData = {
          version: 1,
          collections: [],
          folders: [],
          requests: [],
          history: [],
          environments: [],
          activeEnvironmentId: null,
          layoutMode: "vertical",
          mockEndpoints: [],
          mockServerPort: 3001,
          aiSettings: s.aiSettings,
          apiSpecs: [],
          pluginPersistedState: {},
          wsFilters: s.wsFilters.length ? s.wsFilters : [],
          wsStateMachines: [],
        };
        await writeWorkspace(dirPath, emptyData);
        await get().loadWorkspace(dirPath);
      },

      openWorkspacePicker: async () => {
        const dir = await pickDirectory();
        if (!dir) return;
        const data = await readWorkspace(dir);
        if (data) {
          await get().loadWorkspace(dir);
        } else {
          await get().createWorkspace(dir);
        }
      },

      addRecentWorkspace: (path, name) =>
        set((s) => ({
          recentWorkspaces: [
            { path, name },
            ...s.recentWorkspaces.filter((w) => w.path !== path),
          ].slice(0, 10),
        })),

      saveWorkspaceNow: async () => {
        const s = get();
        if (!s.workspacePath) return;
        const data: WorkspaceFileData = {
          version: 1,
          collections: s.collections,
          folders: s.folders,
          requests: s.requests,
          history: s.history,
          environments: s.environments,
          activeEnvironmentId: s.activeEnvironmentId,
          layoutMode: s.layoutMode,
          mockEndpoints: s.mockEndpoints,
          mockServerPort: s.mockServerPort,
          aiSettings: s.aiSettings,
          apiSpecs: s.apiSpecs,
          pluginPersistedState: s.pluginPersistedState,
          wsFilters: s.wsFilters,
          wsStateMachines: s.wsStateMachines,
          openRequestIds: s.openRequestIds,
          activeRequestId: s.activeRequestId,
        };
        await writeWorkspace(s.workspacePath, data);
      },
    })
);

// ── Auto-save subscription ───────────────────────────────────────────────────

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionTimer: ReturnType<typeof setTimeout> | null = null;
let _prevOpenIds: string[] | null = null;
let _prevActiveId: string | null | undefined = undefined;

useAppStore.subscribe((state) => {
  if (state.workspacePath) {
    // Workspace save (debounced 800ms) — covers openRequestIds + activeRequestId too
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      useAppStore.getState().saveWorkspaceNow().catch(console.error);
    }, 800);
    return;
  }
  // No workspace: save open-request session to app config when it changes
  if (state.openRequestIds !== _prevOpenIds || state.activeRequestId !== _prevActiveId) {
    _prevOpenIds = state.openRequestIds;
    _prevActiveId = state.activeRequestId;
    if (_sessionTimer) clearTimeout(_sessionTimer);
    _sessionTimer = setTimeout(async () => {
      const s = useAppStore.getState();
      try {
        const cfg = await readAppConfig();
        await writeAppConfig({ ...cfg, openRequestIds: s.openRequestIds, activeRequestId: s.activeRequestId });
      } catch { /* not in Tauri context */ }
    }, 1000);
  }
});

export function resolveVariables(
  text: string,
  variables: CollectionVariable[],
  envVars: CollectionVariable[] = []
): string {
  let resolved = text;
  // Env vars first → they take precedence over collection vars
  for (const v of [...envVars, ...variables]) {
    if (v.enabled) {
      resolved = resolved.replaceAll(`{{${v.name}}}`, v.value);
    }
  }
  return resolved;
}

export function getActiveEnvVars(state: {
  environments: Environment[];
  activeEnvironmentId: string | null;
}): CollectionVariable[] {
  if (!state.activeEnvironmentId) return [];
  return state.environments.find((e) => e.id === state.activeEnvironmentId)?.variables ?? [];
}

export function getMethodColor(method: HttpMethod): string {
  const colors: Record<HttpMethod, string> = {
    GET: "text-green-600 dark:text-green-400",
    POST: "text-blue-600 dark:text-blue-400",
    PUT: "text-yellow-600 dark:text-yellow-400",
    PATCH: "text-orange-600 dark:text-orange-400",
    DELETE: "text-red-600 dark:text-red-400",
    HEAD: "text-purple-600 dark:text-purple-400",
    OPTIONS: "text-gray-600 dark:text-gray-400",
  };
  return colors[method] ?? "text-gray-600";
}
