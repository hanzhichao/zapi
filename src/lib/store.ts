"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ApiRequest,
  Collection,
  CollectionVariable,
  ConsoleLog,
  Environment,
  Folder,
  HistoryItem,
  HttpMethod,
  LayoutMode,
  PerfProgress,
  PerfTestConfig,
  ResponseData,
  RunnerItem,
  RunnerMode,
  RunReport,
  TestResult,
} from "./types";

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
  addRequest: (collectionId: string, folderId?: string) => ApiRequest;
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
}

export const useAppStore = create<AppState>()(
  persist(
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
      ],
      folders: [],
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
      expandedCollections: new Set(["sample-collection", "stusdt-collection"]),
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

      addRequest: (collectionId, folderId) => {
        const req = { ...newRequest(collectionId), folderId };
        set((s) => ({
          requests: [...s.requests, req],
          activeRequestId: req.id,
          openRequestIds: s.openRequestIds.includes(req.id)
            ? s.openRequestIds
            : [...s.openRequestIds, req.id],
          response: null,
          testResults: [],
        }));
        return req;
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
    }),
    {
      name: "zapi-storage",
      partialize: (state) => ({
        collections: state.collections,
        folders: state.folders,
        requests: state.requests,
        history: state.history,
        environments: state.environments,
        activeEnvironmentId: state.activeEnvironmentId,
        layoutMode: state.layoutMode,
      }),
    }
  )
);

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
