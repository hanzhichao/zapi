"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Send, Unplug, Plug, ChevronDown, Gauge,
  Info, SlidersHorizontal, FileJson, CheckCircle2, XCircle,
  Clock, Database, Plus, Trash2, Lock, Key, Shield,
  Globe, User, Check, X, AlertTriangle,
} from "lucide-react";
import { StressTestDialog } from "@/components/StressTestDialog";
import { getActiveEnvVars, useAppStore } from "@/lib/store";
import { executeRequest } from "@/lib/http-client";
import { runBeforeRequest, runAfterResponse } from "@/lib/plugin-runtime";
import { buildPm, runScript } from "@/lib/pm";
import { invokeGrpc } from "@/lib/grpc-client";
import { connectWs, disconnectWs, sendWsMessage } from "@/lib/websocket-client";
import { runExtractors } from "@/lib/extractor";
import { runVisualAssertions } from "@/lib/visual-assertions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectGroup, SelectItem,
  SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { VisualTestBuilder } from "@/components/VisualTestBuilder";
import { ResponseExtractor } from "@/components/ResponseExtractor";
import type {
  BodyType, ConsoleLog, HttpMethod, KeyValue, Protocol,
  ResponseExample,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLORS: Record<string, string> = {
  GET:     "text-green-600 dark:text-green-400",
  POST:    "text-blue-600 dark:text-blue-400",
  PUT:     "text-yellow-600 dark:text-yellow-400",
  PATCH:   "text-orange-600 dark:text-orange-400",
  DELETE:  "text-red-600 dark:text-red-400",
  HEAD:    "text-purple-600 dark:text-purple-400",
  OPTIONS: "text-gray-600 dark:text-gray-400",
};

// Method color for non-standard methods
function methodColor(method: string): string {
  return METHOD_COLORS[method] ?? "text-primary";
}

// ── Method combobox (standard + custom) ───────────────────────────────────────

function MethodSelector({
  value,
  onChange,
}: {
  value: HttpMethod;
  onChange: (m: HttpMethod) => void;
}) {
  const isCustom = !HTTP_METHODS.includes(value as string);
  const [editing, setEditing] = useState(isCustom);
  const [customVal, setCustomVal] = useState(isCustom ? value : "");

  if (editing) {
    return (
      <Input
        autoFocus
        value={customVal}
        onChange={(e) => setCustomVal(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (customVal.trim()) onChange(customVal.trim());
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => {
          if (customVal.trim()) onChange(customVal.trim());
          setEditing(false);
        }}
        placeholder="METHOD"
        className={cn(
          "w-24 h-8 font-bold text-sm border-0 bg-muted/50 shrink-0 focus:bg-background px-2",
          methodColor(customVal || value)
        )}
      />
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === "__custom__") { setCustomVal(""); setEditing(true); return; }
        onChange(v as HttpMethod);
      }}
    >
      <SelectTrigger
        className={cn(
          "w-24 font-bold text-sm h-8 border-0 bg-muted/50 hover:bg-muted shrink-0",
          methodColor(value)
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HTTP_METHODS.map((m) => (
          <SelectItem key={m} value={m} className={cn("font-bold text-sm", methodColor(m))}>
            {m}
          </SelectItem>
        ))}
        <SelectItem value="__custom__" className="text-muted-foreground italic">
          Custom…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// ── Protocol badge (WS / gRPC only) ──────────────────────────────────────────

function ProtoBadge({ proto }: { proto: Protocol }) {
  const map: Record<string, string> = {
    websocket: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
    grpc:      "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  };
  const labels: Record<string, string> = { websocket: "WS", grpc: "gRPC" };
  if (proto !== "websocket" && proto !== "grpc") return null;
  return (
    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded border shrink-0 h-8 flex items-center", map[proto])}>
      {labels[proto]}
    </span>
  );
}

// ── URL bar ────────────────────────────────────────────────────────────────────

export function RequestUrlBar() {
  const store = useAppStore();
  const {
    activeRequestId, requests, collections, environments, activeEnvironmentId,
    updateRequest, setResponse, setLoading, setTestResults, isLoading,
    addHistory, setEnvironmentVariable, addConsoleLogs,
    wsConnected, setWsConnected, addWsMessage, clearWsMessages,
  } = store;

  const request = requests.find((r) => r.id === activeRequestId);
  const envVars = getActiveEnvVars({ environments, activeEnvironmentId });
  const proto = request?.protocol ?? "http";

  const handleSend = useCallback(async () => {
    if (!request) return;
    const capturedLogs: ConsoleLog[] = [];

    // ── WebSocket ──────────────────────────────────────────────────────────
    if (proto === "websocket") {
      if (wsConnected) { disconnectWs(request.id); setWsConnected(false); return; }
      clearWsMessages();
      connectWs(request.id, request.url, (msg) => addWsMessage(msg), (c) => setWsConnected(c));
      return;
    }

    setLoading(true);
    setResponse(null);
    setTestResults([]);

    try {
      const collection = collections.find((c) => c.id === request.collectionId);
      const colVars = collection?.variables ?? [];
      const activeEnv = activeEnvironmentId ? environments.find((e) => e.id === activeEnvironmentId) : null;

      const preCtx = {
        testResults: [] as import("@/lib/types").TestResult[],
        headerOverrides: {} as Record<string, string>,
        variableOverrides: {} as Record<string, string>,
      };

      if (request.preScript?.trim()) {
        const preZapi = buildPm(preCtx,
          { getVar: (k) => envVars.find((v) => v.name === k)?.value, setVar: (k, v) => { if (activeEnv) setEnvironmentVariable(activeEnv.id, k, v); } },
          Object.fromEntries(colVars.map((v) => [v.name, v.value])),
          undefined);
        const err = runScript(request.preScript, preZapi, capturedLogs);
        if (err) capturedLogs.push({ id: crypto.randomUUID(), level: "error", message: `Pre-script error: ${err}`, timestamp: Date.now() });
      }

      const mergedEnvVars = [
        ...envVars,
        ...Object.entries(preCtx.variableOverrides).map(([name, value]) => ({ id: name, name, value, enabled: true })),
      ];

      capturedLogs.push({ id: crypto.randomUUID(), level: "request", message: `${proto.toUpperCase()} ${request.url}`, timestamp: Date.now() });

      const enabledPlugins = store.plugins;
      const variablesMap = Object.fromEntries([...colVars, ...mergedEnvVars].map((v) => [v.name, v.value]));

      let result;
      if (proto === "grpc") {
        const grpcUrl = request.url.replace(/^grpc:\/\//, "http://").replace(/^grpcs:\/\//, "https://");
        const extraHeaders: Record<string, string> = {};
        for (const h of (request.grpcMetadata ?? []).filter((h) => h.enabled && h.key)) {
          extraHeaders[h.key] = h.value;
        }
        result = await invokeGrpc(grpcUrl, request.body.content || "{}", extraHeaders);
      } else {
        const pluginReqCtx = await runBeforeRequest(
          { method: request.method, url: request.url, headers: preCtx.headerOverrides, body: request.body?.content ?? null, config: {}, variables: variablesMap },
          enabledPlugins
        );
        const mergedExtraHeaders = { ...preCtx.headerOverrides, ...pluginReqCtx.headers };
        result = await executeRequest(request, colVars, mergedEnvVars, mergedExtraHeaders);
        await runAfterResponse(
          {
            request: { method: pluginReqCtx.method, url: pluginReqCtx.url, headers: pluginReqCtx.headers, body: pluginReqCtx.body, config: {}, variables: variablesMap },
            status: result.status, statusText: result.statusText, headers: result.headers as Record<string, string>,
            body: result.body, durationMs: result.time, config: {},
          },
          enabledPlugins
        );
      }
      setResponse(result);

      capturedLogs.push({
        id: crypto.randomUUID(), level: "response",
        message: `${result.status} ${result.statusText}  ${result.time}ms  ${result.size < 1024 ? result.size + " B" : (result.size / 1024).toFixed(1) + " KB"}`,
        timestamp: Date.now(),
      });

      const testCtx = { testResults: [] as import("@/lib/types").TestResult[], headerOverrides: {} as Record<string, string>, variableOverrides: {} as Record<string, string> };
      if (request.tests?.trim()) {
        const testZapi = buildPm(testCtx,
          { getVar: (k) => mergedEnvVars.find((v) => v.name === k)?.value, setVar: (k, v) => { if (activeEnv) setEnvironmentVariable(activeEnv.id, k, v); } },
          Object.fromEntries(colVars.map((v) => [v.name, v.value])),
          result);
        const err = runScript(request.tests, testZapi, capturedLogs);
        if (err) capturedLogs.push({ id: crypto.randomUUID(), level: "error", message: `Tests error: ${err}`, timestamp: Date.now() });
      }

      const visualResults = request.visualAssertions?.length
        ? runVisualAssertions(request.visualAssertions.filter((a) => a.enabled), result)
        : [];

      if (request.extractors?.length) {
        const extracted = runExtractors(request.extractors.filter((r) => r.enabled), result);
        for (const ev of extracted) {
          if (!ev.error) {
            if (ev.scope === "environment" && activeEnv) {
              setEnvironmentVariable(activeEnv.id, ev.varName, ev.value);
            } else {
              const col2 = collections.find((c) => c.id === request.collectionId);
              if (col2) {
                const existing = col2.variables.find((v) => v.name === ev.varName);
                if (existing) {
                  useAppStore.getState().updateVariable(col2.id, existing.id, { value: ev.value });
                } else {
                  useAppStore.getState().addVariable(col2.id, { name: ev.varName, value: ev.value, enabled: true });
                }
              }
            }
            capturedLogs.push({ id: crypto.randomUUID(), level: "info", message: `Extracted {{${ev.varName}}} = ${ev.value.slice(0, 60)}`, timestamp: Date.now() });
          } else {
            capturedLogs.push({ id: crypto.randomUUID(), level: "warn", message: `Extractor "${ev.varName}" failed: ${ev.error}`, timestamp: Date.now() });
          }
        }
      }

      const allTestResults = [...testCtx.testResults, ...visualResults];
      setTestResults(allTestResults);
      addHistory({ ...request, response: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      capturedLogs.push({ id: crypto.randomUUID(), level: "error", message: msg, timestamp: Date.now() });
      setResponse({ status: 0, statusText: "Error", headers: {}, body: msg, size: 0, time: 0, contentType: "text/plain" });
    } finally {
      setLoading(false);
      if (capturedLogs.length > 0) addConsoleLogs(capturedLogs);
    }
  }, [request, collections, environments, activeEnvironmentId, envVars, proto,
    wsConnected, setLoading, setResponse, setTestResults, addHistory,
    setEnvironmentVariable, addConsoleLogs, setWsConnected, addWsMessage, clearWsMessages]);

  useEffect(() => {
    const handler = () => { handleSend(); };
    window.addEventListener("zapi:send", handler);
    return () => window.removeEventListener("zapi:send", handler);
  }, [handleSend]);

  const [stressOpen, setStressOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  if (!request) return null;

  const isWs = proto === "websocket";
  // HTTP-like protocols show method selector; WS/gRPC show badge
  const showMethodSelector = proto !== "websocket" && proto !== "grpc";

  return (
    <>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-background shrink-0">
        {/* WS / gRPC badge (non-interactive indicator) */}
        <ProtoBadge proto={proto as Protocol} />

        {/* Method combobox — HTTP / GraphQL / SOAP only */}
        {showMethodSelector && (
          <MethodSelector
            value={request.method}
            onChange={(m) => updateRequest(request.id, { method: m })}
          />
        )}

        {/* URL input */}
        <Input
          value={request.url}
          onChange={(e) => updateRequest(request.id, { url: e.target.value })}
          placeholder={
            isWs ? "ws://example.com/socket" :
            proto === "grpc" ? "grpc://host:port/package.Service/Method" :
            "Enter URL  ·  Use {{variable}} for substitution"
          }
          className="flex-1 font-mono text-sm h-8 bg-muted/30 border-muted focus:bg-background transition-colors"
          onKeyDown={(e) => !isWs && e.key === "Enter" && handleSend()}
        />

        {/* Send / Connect button */}
        {isWs ? (
          <Button
            onClick={handleSend}
            variant={wsConnected ? "destructive" : "default"}
            className="gap-1.5 h-8 px-3 text-sm font-medium shrink-0"
            size="sm"
          >
            {wsConnected ? <Unplug className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
            {wsConnected ? "Disconnect" : "Connect"}
          </Button>
        ) : (
          <div className="relative flex shrink-0">
            <Button
              onClick={handleSend}
              disabled={isLoading || !request.url}
              className="gap-1.5 h-8 px-4 text-sm font-medium rounded-r-none border-r border-primary-foreground/20"
              size="sm"
            >
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {proto === "grpc" ? "Invoke" : "Send"}
            </Button>
            <button
              onClick={() => setDropOpen((o) => !o)}
              onBlur={() => setTimeout(() => setDropOpen(false), 150)}
              className="h-8 w-7 flex items-center justify-center rounded-r-md bg-primary hover:brightness-90 transition-all shrink-0 text-primary-foreground"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            {dropOpen && (
              <div className="absolute right-0 top-9 z-50 bg-popover border rounded-md shadow-lg py-1 w-44">
                <button
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                  onMouseDown={(e) => { e.preventDefault(); setDropOpen(false); setStressOpen(true); }}
                >
                  <Gauge className="h-3.5 w-3.5 text-orange-500" />
                  <div>
                    <div className="font-medium">Stress Test</div>
                    <div className="text-[10px] text-muted-foreground">Single-request load test</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {stressOpen && <StressTestDialog onClose={() => setStressOpen(false)} />}
    </>
  );
}

// ── Config tabs ────────────────────────────────────────────────────────────────

export function RequestConfigTabs() {
  const { activeRequestId, requests, activeTab, setActiveTab, updateRequest } = useAppStore();
  const request = requests.find((r) => r.id === activeRequestId);

  if (!request) return null;

  const proto = request.protocol ?? "http";
  const activeParams = request.params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = request.headers.filter((h) => h.enabled && h.key).length;
  const hasBody = request.body.type !== "none";
  const hasPreScript = Boolean(request.preScript?.trim());
  const hasTests = Boolean(request.tests?.trim());
  const hasExtractors = (request.extractors?.filter((e) => e.enabled).length ?? 0) > 0;
  const hasAssertions = (request.visualAssertions?.filter((a) => a.enabled).length ?? 0) > 0;
  const hasDocsContent = Boolean(request.description?.trim() || request.requestSchema?.trim() || request.responseSchema?.trim());
  const assertionCount = (request.visualAssertions?.filter((a) => a.enabled).length ?? 0)
    + (request.extractors?.filter((e) => e.enabled).length ?? 0)
    + (hasTests ? 1 : 0);

  const tabs = buildTabs(proto, activeParams, activeHeaders, hasBody, request.auth.type !== "none",
    hasPreScript, hasDocsContent, assertionCount, request);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
      <div className="px-3 border-b bg-muted/10 shrink-0 flex items-center h-9 gap-0">
        {tabs.map((tab) => {
          if (tab.value === "body") {
            return (
              <BodyTabTrigger
                key="body"
                request={request}
                isActive={activeTab === "body"}
                onActivate={() => setActiveTab("body")}
                onUpdate={(patch) => updateRequest(request.id, patch)}
              />
            );
          }
          if (tab.value === "auth") {
            return (
              <AuthTabTrigger
                key="auth"
                request={request}
                isActive={activeTab === "auth"}
                onActivate={() => setActiveTab("auth")}
                onUpdate={(patch) => updateRequest(request.id, patch)}
              />
            );
          }
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "relative h-9 rounded-none border-b-2 border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground flex items-center shrink-0",
                activeTab === tab.value && "border-primary text-foreground"
              )}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1 text-[9px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-semibold">{tab.count}</span>
              )}
              {tab.dot && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-auto">
        {/* Universal tabs */}
        <TabsContent value="params" className="p-4 mt-0">
          <KeyValueEditor items={request.params} onChange={(params) => updateRequest(request.id, { params })} keyPlaceholder="Parameter" />
        </TabsContent>
        <TabsContent value="headers" className="p-4 mt-0">
          <KeyValueEditor items={request.headers} onChange={(headers) => updateRequest(request.id, { headers })} keyPlaceholder="Header" />
        </TabsContent>
        <TabsContent value="body" className="p-4 mt-0">
          <BodyEditor request={request} onUpdate={(patch) => updateRequest(request.id, patch)} />
        </TabsContent>
        <TabsContent value="auth" className="p-4 mt-0">
          <AuthEditor auth={request.auth} onAuthChange={(auth) => updateRequest(request.id, { auth })} />
        </TabsContent>
        <TabsContent value="pre-script" className="p-0 mt-0 h-full">
          <ScriptTab
            value={request.preScript ?? ""}
            onChange={(v) => updateRequest(request.id, { preScript: v })}
            placeholder={`// Runs before the request\nzapi.environment.set("token", "value");\nzapi.request.headers.add({ key: "X-Custom", value: "data" });`}
            label="Pre-request Script"
          />
        </TabsContent>

        {/* Merged Assertions tab */}
        <TabsContent value="assertions" className="p-0 mt-0 h-full">
          <AssertionsTab request={request} onUpdate={(patch) => updateRequest(request.id, patch)} />
        </TabsContent>

        {/* gRPC */}
        <TabsContent value="grpc-request" className="p-4 mt-0">
          <GrpcRequestTab
            content={request.body.content ?? ""}
            metadata={request.grpcMetadata ?? []}
            onContentChange={(c) => updateRequest(request.id, { body: { ...request.body, content: c } })}
            onMetadataChange={(m) => updateRequest(request.id, { grpcMetadata: m })}
          />
        </TabsContent>

        {/* Info tab (previously Docs) */}
        <TabsContent value="info" className="mt-0 h-full overflow-hidden">
          <InfoTab request={request} onUpdate={(patch) => updateRequest(request.id, patch)} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ── Tab definitions ────────────────────────────────────────────────────────────

interface TabDef { value: string; label: string; dot?: boolean; count?: number }

function t(value: string, label: string, opts?: { dot?: boolean; count?: number }): TabDef {
  return { value, label, ...opts };
}

function buildTabs(
  proto: Protocol,
  activeParams: number,
  activeHeaders: number,
  hasBody: boolean,
  hasAuth: boolean,
  hasPreScript: boolean,
  hasInfo: boolean,
  assertionCount: number,
  request: import("@/lib/types").ApiRequest
): TabDef[] {
  const infoTab = t("info", "Info", { dot: hasInfo || Boolean(request.priority != null || request.requestStatus) });
  const commonLower: TabDef[] = [
    t("headers", "Headers", { count: activeHeaders }),
    t("auth",    "Auth",    { dot: hasAuth }),
  ];

  if (proto === "websocket") return [...commonLower, infoTab];

  if (proto === "grpc") return [
    t("grpc-request", "Request", { dot: Boolean(request.body.content?.trim()) }),
    ...commonLower, infoTab,
  ];

  // HTTP / GraphQL / SOAP — all unified
  return [
    t("params",     "Params",     { count: activeParams }),
    t("headers",    "Headers",    { count: activeHeaders }),
    t("body",       "Body",       { dot: hasBody }),
    t("auth",       "Auth",       { dot: hasAuth }),
    t("pre-script", "Pre-Script", { dot: hasPreScript }),
    t("assertions", "Assertions", { count: assertionCount > 0 ? assertionCount : undefined }),
    infoTab,
  ];
}

// ── Shared body-type change logic ────────────────────────────────────────────

function applyBodyTypeChange(
  val: string,
  request: import("@/lib/types").ApiRequest,
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void
) {
  if (val === "soap-1.1" || val === "soap-1.2") {
    onUpdate({ body: { ...request.body, type: "soap" }, soapVersion: val === "soap-1.2" ? "1.2" : "1.1", protocol: "soap", method: "POST" });
  } else if (val === "graphql") {
    onUpdate({ body: { ...request.body, type: "graphql" }, protocol: "graphql", method: "POST" });
  } else {
    const patch: Partial<import("@/lib/types").ApiRequest> = { body: { ...request.body, type: val as BodyType } };
    if (request.protocol === "soap" || request.protocol === "graphql") patch.protocol = "http";
    onUpdate(patch);
  }
}

// ── Tab-label dropdown for Body type ─────────────────────────────────────────

const BODY_SHORT_LABELS: Record<string, string> = {
  none: "Body", json: "JSON", xml: "XML", form: "Form",
  formdata: "Multipart", text: "Text", graphql: "GraphQL",
  "soap-1.1": "SOAP 1.1", "soap-1.2": "SOAP 1.2",
};

function getBodyTabLabel(request: import("@/lib/types").ApiRequest): string {
  const { body, soapVersion } = request;
  if (body.type === "none") return "Body";
  const key = body.type === "soap" ? (soapVersion === "1.2" ? "soap-1.2" : "soap-1.1") : body.type;
  return BODY_SHORT_LABELS[key] ?? "Body";
}

const TAB_BTN_BASE =
  "relative h-9 rounded-none border-b-2 border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground flex items-center gap-1 shrink-0";
const TAB_BTN_ACTIVE = "border-primary text-foreground";

function BodyTabTrigger({
  request, isActive, onActivate, onUpdate,
}: {
  request: import("@/lib/types").ApiRequest;
  isActive: boolean;
  onActivate: () => void;
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasBody = request.body.type !== "none";
  const label = getBodyTabLabel(request);
  return (
    <DropdownMenu open={open} onOpenChange={(v) => {
      if (v && !isActive) { onActivate(); return; }
      setOpen(v);
    }}>
      <DropdownMenuTrigger asChild>
        <button onClick={() => { if (!isActive) onActivate(); }} className={cn(TAB_BTN_BASE, isActive && TAB_BTN_ACTIVE)}>
          {label}
          {hasBody && <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />}
          <ChevronDown className="h-3 w-3 opacity-40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-[10px] py-1">Form Data</DropdownMenuLabel>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("form", request, onUpdate)}>URL Encoded</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("formdata", request, onUpdate)}>Multi-Part</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] py-1">Text Content</DropdownMenuLabel>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("graphql", request, onUpdate)}>GraphQL</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("json", request, onUpdate)}>JSON</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("xml", request, onUpdate)}>XML</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("soap-1.1", request, onUpdate)}>SOAP 1.1</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("soap-1.2", request, onUpdate)}>SOAP 1.2</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("text", request, onUpdate)}>Text</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onClick={() => applyBodyTypeChange("none", request, onUpdate)}>No Body</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Tab-label dropdown for Auth type ─────────────────────────────────────────

const AUTH_TAB_LABELS: Record<string, string> = {
  none: "Auth", bearer: "Bearer", basic: "Basic", "api-key": "API Key", oauth2: "OAuth2",
};

function AuthTabTrigger({
  request, isActive, onActivate, onUpdate,
}: {
  request: import("@/lib/types").ApiRequest;
  isActive: boolean;
  onActivate: () => void;
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasAuth = request.auth.type !== "none";
  const label = AUTH_TAB_LABELS[request.auth.type] ?? "Auth";
  return (
    <DropdownMenu open={open} onOpenChange={(v) => {
      if (v && !isActive) { onActivate(); return; }
      setOpen(v);
    }}>
      <DropdownMenuTrigger asChild>
        <button onClick={() => { if (!isActive) onActivate(); }} className={cn(TAB_BTN_BASE, isActive && TAB_BTN_ACTIVE)}>
          {label}
          {hasAuth && <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />}
          <ChevronDown className="h-3 w-3 opacity-40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem className="text-xs" onClick={() => onUpdate({ auth: { ...request.auth, type: "none" } })}>No Auth</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => onUpdate({ auth: { ...request.auth, type: "bearer" } })}>Bearer Token</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => onUpdate({ auth: { ...request.auth, type: "basic" } })}>Basic Auth</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => onUpdate({ auth: { ...request.auth, type: "api-key" } })}>API Key</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => onUpdate({ auth: { ...request.auth, type: "oauth2" } })}>OAuth 2.0</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Body type dropdown with groups ────────────────────────────────────────────

// Virtual dropdown value for SOAP variants
function getBodyDropdownValue(bodyType: BodyType, soapVersion?: "1.1" | "1.2"): string {
  if (bodyType === "soap") return soapVersion === "1.2" ? "soap-1.2" : "soap-1.1";
  return bodyType;
}

function BodyTypeSelector({
  request,
  onUpdate,
}: {
  request: import("@/lib/types").ApiRequest;
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void;
}) {
  const dropdownValue = getBodyDropdownValue(request.body.type, request.soapVersion);

  const handleChange = (val: string) => {
    if (val === "soap-1.1" || val === "soap-1.2") {
      onUpdate({
        body: { ...request.body, type: "soap" },
        soapVersion: val === "soap-1.2" ? "1.2" : "1.1",
        protocol: "soap",
        method: "POST",
      });
    } else if (val === "graphql") {
      onUpdate({
        body: { ...request.body, type: "graphql" },
        protocol: "graphql",
        method: "POST",
      });
    } else {
      const patch: Partial<import("@/lib/types").ApiRequest> = {
        body: { ...request.body, type: val as BodyType },
      };
      if (request.protocol === "graphql" || request.protocol === "soap") {
        patch.protocol = "http";
      }
      onUpdate(patch);
    }
  };

  const LABEL: Record<string, string> = {
    form: "URL Encoded", formdata: "Multi-Part",
    graphql: "GraphQL", json: "JSON", xml: "XML", "soap-1.1": "SOAP 1.1", "soap-1.2": "SOAP 1.2", text: "Other",
    none: "No Body",
  };

  return (
    <Select value={dropdownValue} onValueChange={handleChange}>
      <SelectTrigger className="h-7 text-xs w-44 bg-muted/30 border-muted">
        <SelectValue placeholder="Body type" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel className="text-[10px] text-muted-foreground px-2 pb-0.5">Form Data</SelectLabel>
          <SelectItem value="form">URL Encoded</SelectItem>
          <SelectItem value="formdata">Multi-Part</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel className="text-[10px] text-muted-foreground px-2 pb-0.5">Text Content</SelectLabel>
          <SelectItem value="graphql">GraphQL</SelectItem>
          <SelectItem value="json">JSON</SelectItem>
          <SelectItem value="xml">XML</SelectItem>
          <SelectItem value="soap-1.1">SOAP 1.1</SelectItem>
          <SelectItem value="soap-1.2">SOAP 1.2</SelectItem>
          <SelectItem value="text">Other</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel className="text-[10px] text-muted-foreground px-2 pb-0.5">Other</SelectLabel>
          <SelectItem value="none">No Body</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// ── Body editor (unified for all body types) ─────────────────────────────────

function BodyEditor({
  request,
  onUpdate,
}: {
  request: import("@/lib/types").ApiRequest;
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void;
}) {
  const { body, soapVersion } = request;

  return (
    <div className="space-y-3">
      {body.type === "none" && (
        <p className="text-xs text-muted-foreground py-6 text-center">This request has no body.</p>
      )}

      {(body.type === "json" || body.type === "xml" || body.type === "text") && (
        <Textarea
          value={body.content}
          onChange={(e) => onUpdate({ body: { ...body, content: e.target.value } })}
          placeholder={
            body.type === "json" ? '{\n  "key": "value"\n}' :
            body.type === "xml" ? "<root>\n  <element>value</element>\n</root>" :
            "Enter text content..."
          }
          className="min-h-[200px] font-mono text-sm resize-none bg-muted/20"
        />
      )}

      {(body.type === "form" || body.type === "formdata") && (
        <KeyValueEditor
          items={body.formData}
          onChange={(formData) => onUpdate({ body: { ...body, formData } })}
          keyPlaceholder="Field name"
          valuePlaceholder="Value"
        />
      )}

      {body.type === "graphql" && (
        <GraphQLQueryTab
          query={body.content ?? ""}
          variables={request.graphqlVariables ?? ""}
          operationName={request.graphqlOperationName ?? ""}
          onQueryChange={(q) => onUpdate({ body: { ...body, content: q } })}
          onVariablesChange={(v) => onUpdate({ graphqlVariables: v })}
          onOperationNameChange={(n) => onUpdate({ graphqlOperationName: n })}
        />
      )}

      {body.type === "soap" && (
        <SoapBodyEditor
          content={body.content ?? ""}
          soapAction={request.soapAction ?? ""}
          onContentChange={(c) => onUpdate({ body: { ...body, content: c } })}
          onSoapActionChange={(a) => onUpdate({ soapAction: a })}
        />
      )}
    </div>
  );
}

// ── Merged Assertions tab ─────────────────────────────────────────────────────

type AssertSubTab = "assertions" | "tests" | "extract";

function AssertionsTab({
  request,
  onUpdate,
}: {
  request: import("@/lib/types").ApiRequest;
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void;
}) {
  const [sub, setSub] = useState<AssertSubTab>("assertions");

  const assertCount = request.visualAssertions?.filter((a) => a.enabled).length ?? 0;
  const extractCount = request.extractors?.filter((e) => e.enabled).length ?? 0;
  const hasTests = Boolean(request.tests?.trim());

  const subTabs: { id: AssertSubTab; label: string; badge?: number | boolean }[] = [
    { id: "assertions", label: "Assertions", badge: assertCount },
    { id: "tests",      label: "Tests Script", badge: hasTests },
    { id: "extract",    label: "Extract",    badge: extractCount },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab switcher */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-muted/5 shrink-0">
        {subTabs.map((st) => (
          <button
            key={st.id}
            onClick={() => setSub(st.id)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1 rounded-md transition-colors font-medium",
              sub === st.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {st.label}
            {typeof st.badge === "number" && st.badge > 0 && (
              <span className="bg-primary/20 text-primary rounded-full px-1.5 text-[9px] font-semibold">{st.badge}</span>
            )}
            {st.badge === true && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {sub === "assertions" && <VisualTestBuilder requestId={request.id} />}
        {sub === "tests" && (
          <ScriptTab
            value={request.tests ?? ""}
            onChange={(v) => onUpdate({ tests: v })}
            placeholder={`// Runs after the response\nzapi.test("Status is 200", () => {\n  zapi.response.to.have.status(200);\n});\nzapi.environment.set("userId", zapi.response.json().id);`}
            label="Tests"
          />
        )}
        {sub === "extract" && <ResponseExtractor requestId={request.id} />}
      </div>
    </div>
  );
}

// ── Info tab (formerly Docs) — editable ──────────────────────────────────────

const PRIORITY_CONFIG: Record<number, { label: string; cls: string }> = {
  0: { label: "P0", cls: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40" },
  1: { label: "P1", cls: "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/40" },
  2: { label: "P2", cls: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/40" },
  3: { label: "P3", cls: "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/40" },
  4: { label: "P4", cls: "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40" },
  5: { label: "P5", cls: "bg-muted text-muted-foreground border-border" },
};

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  todo:  { label: "Todo",  cls: "bg-muted text-muted-foreground border-border" },
  doing: { label: "Doing", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  done:  { label: "Done",  cls: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30" },
};

function StatusBadge({ status }: { status: number }) {
  const color =
    status >= 500 ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" :
    status >= 400 ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30" :
    status >= 300 ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" :
    status >= 200 ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30" :
    "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-xs font-bold font-mono px-2 py-0.5 rounded border", color)}>
      {status}
    </span>
  );
}

function InfoTab({
  request,
  onUpdate,
}: {
  request: import("@/lib/types").ApiRequest;
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void;
}) {
  const response = useAppStore((s) => s.response);

  const addResponseExample = () => {
    const examples = request.responseExamples ?? [];
    onUpdate({
      responseExamples: [
        ...examples,
        { id: crypto.randomUUID(), statusCode: 200, name: "Success", description: "", body: "" },
      ],
    });
  };

  const updateExample = (id: string, patch: Partial<ResponseExample>) => {
    onUpdate({
      responseExamples: (request.responseExamples ?? []).map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    });
  };

  const deleteExample = (id: string) => {
    onUpdate({ responseExamples: (request.responseExamples ?? []).filter((e) => e.id !== id) });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 space-y-7 max-w-3xl">

        {/* ── 1. Meta ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <SectionHeader icon={<Info className="h-4 w-4" />} title="接口信息" />
          <div className="grid grid-cols-2 gap-3">
            {/* Name */}
            <div className="col-span-2 space-y-1">
              <Label className="text-xs text-muted-foreground">接口名称</Label>
              <Input
                value={request.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className="h-8 text-sm bg-muted/20"
              />
            </div>
            {/* Description */}
            <div className="col-span-2 space-y-1">
              <Label className="text-xs text-muted-foreground">接口描述</Label>
              <Textarea
                value={request.description ?? ""}
                onChange={(e) => onUpdate({ description: e.target.value })}
                placeholder="描述该接口的用途、使用场景及注意事项…"
                className="min-h-[60px] text-sm resize-none bg-muted/20 leading-relaxed"
              />
            </div>
            {/* Priority */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">优先级</Label>
              <Select
                value={request.priority != null ? String(request.priority) : "_unset"}
                onValueChange={(v) => onUpdate({ priority: v === "_unset" ? undefined : (Number(v) as 0|1|2|3|4|5) })}
              >
                <SelectTrigger className="h-8 text-xs w-36 bg-muted/20">
                  {request.priority != null ? (
                    <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded border", PRIORITY_CONFIG[request.priority].cls)}>
                      {PRIORITY_CONFIG[request.priority].label}
                    </span>
                  ) : <span className="text-muted-foreground text-xs">未设置</span>}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_unset">未设置</SelectItem>
                  {([0, 1, 2, 3, 4, 5] as const).map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded border", PRIORITY_CONFIG[p].cls)}>
                        {PRIORITY_CONFIG[p].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Status */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">状态</Label>
              <Select
                value={request.requestStatus ?? "_unset"}
                onValueChange={(v) => onUpdate({ requestStatus: v === "_unset" ? undefined : v as "todo"|"doing"|"done" })}
              >
                <SelectTrigger className="h-8 text-xs w-36 bg-muted/20">
                  {request.requestStatus ? (
                    <span className={cn("text-xs px-1.5 py-0.5 rounded border", STATUS_CONFIG[request.requestStatus].cls)}>
                      {STATUS_CONFIG[request.requestStatus].label}
                    </span>
                  ) : <span className="text-muted-foreground text-xs">未设置</span>}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_unset">未设置</SelectItem>
                  {(["todo", "doing", "done"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className={cn("text-xs px-1.5 py-0.5 rounded border", STATUS_CONFIG[s].cls)}>
                        {STATUS_CONFIG[s].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Auth */}
            <div className="col-span-2 space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />认证</Label>
              <AuthDropdownInline auth={request.auth} onAuthChange={(auth) => onUpdate({ auth })} />
            </div>
          </div>
        </section>

        {/* ── 2. Params ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <SectionHeader
            icon={<SlidersHorizontal className="h-4 w-4" />}
            title="请求参数"
            badge={request.params.filter((p) => p.enabled && p.key).length}
          />
          <KeyValueEditor
            items={request.params}
            onChange={(params) => onUpdate({ params })}
            keyPlaceholder="Parameter"
          />
        </section>

        {/* ── 3. Headers ──────────────────────────────────────────────── */}
        <section className="space-y-2">
          <SectionHeader
            icon={<SlidersHorizontal className="h-4 w-4" />}
            title="请求头"
            badge={request.headers.filter((h) => h.enabled && h.key).length}
          />
          <KeyValueEditor
            items={request.headers}
            onChange={(headers) => onUpdate({ headers })}
            keyPlaceholder="Header"
          />
        </section>

        {/* ── 4. Response Examples ────────────────────────────────────── */}
        <section className="space-y-2">
          <SectionHeader icon={<Database className="h-4 w-4" />} title="响应示例" />
          {(request.responseExamples ?? []).map((ex) => (
            <ResponseExampleRow
              key={ex.id}
              example={ex}
              onUpdate={(p) => updateExample(ex.id, p)}
              onDelete={() => deleteExample(ex.id)}
            />
          ))}
          <button
            onClick={addResponseExample}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 px-2 rounded hover:bg-muted/40 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> 添加响应场景
          </button>
          {response && <LatestResponseSummary response={response} />}
        </section>

        {/* ── 5. Schema ────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <SectionHeader icon={<FileJson className="h-4 w-4" />} title="Schema 定义" />
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">请求体 Schema <span className="opacity-50">(JSON Schema)</span></Label>
              <Textarea
                value={request.requestSchema ?? ""}
                onChange={(e) => onUpdate({ requestSchema: e.target.value })}
                placeholder={'{\n  "type": "object",\n  "properties": { "id": { "type": "integer" } }\n}'}
                className="min-h-[100px] font-mono text-xs resize-none bg-muted/20"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">响应体 Schema <span className="opacity-50">(JSON Schema)</span></Label>
              <Textarea
                value={request.responseSchema ?? ""}
                onChange={(e) => onUpdate({ responseSchema: e.target.value })}
                placeholder={'{\n  "type": "object",\n  "properties": { "data": { "type": "array" } }\n}'}
                className="min-h-[100px] font-mono text-xs resize-none bg-muted/20"
                spellCheck={false}
              />
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

function SectionHeader({ icon, title, badge }: { icon: React.ReactNode; title: string; badge?: number }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-border">
      <span className="text-muted-foreground">{icon}</span>
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {badge != null && badge > 0 && (
        <span className="text-[10px] bg-primary/15 text-primary rounded-full px-2 py-0.5 font-semibold">{badge}</span>
      )}
    </div>
  );
}

function ResponseExampleRow({
  example,
  onUpdate,
  onDelete,
}: {
  example: ResponseExample;
  onUpdate: (p: Partial<ResponseExample>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 flex-1 text-left">
          <StatusBadge status={example.statusCode} />
          <span className="font-medium">{example.name || "(unnamed)"}</span>
          {example.description && <span className="text-muted-foreground truncate">{example.description}</span>}
        </button>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Status Code</Label>
              <Input
                type="number"
                value={example.statusCode}
                onChange={(e) => onUpdate({ statusCode: Number(e.target.value) })}
                className="h-6 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Scenario Name</Label>
              <Input
                value={example.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className="h-6 text-xs"
                placeholder="成功 / 参数错误 …"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">描述</Label>
            <Input
              value={example.description ?? ""}
              onChange={(e) => onUpdate({ description: e.target.value })}
              className="h-6 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">响应体示例</Label>
            <Textarea
              value={example.body ?? ""}
              onChange={(e) => onUpdate({ body: e.target.value })}
              className="min-h-[80px] font-mono text-xs resize-none bg-muted/20"
              placeholder='{"data": [], "total": 0}'
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LatestResponseSummary({ response }: { response: import("@/lib/types").ResponseData }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border bg-muted/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {response.status >= 200 && response.status < 300
          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
          : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
        <StatusBadge status={response.status} />
        <span>{response.statusText}</span>
        <span className="ml-auto flex items-center gap-1"><Clock className="h-3 w-3" />{response.time}ms</span>
        <span>{response.size < 1024 ? `${response.size} B` : `${(response.size / 1024).toFixed(1)} KB`}</span>
      </div>
      {response.body && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">最近响应体</span>
            {response.body.length > 300 && (
              <button onClick={() => setExpanded((v) => !v)} className="text-[10px] text-primary hover:underline">
                {expanded ? "收起" : "展开"}
              </button>
            )}
          </div>
          <pre className="rounded bg-muted/30 border p-2 text-[10px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {expanded || response.body.length <= 300
              ? response.body
              : response.body.slice(0, 300) + "\n…"}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Auth inline dropdown (used in Info tab) ───────────────────────────────────

function AuthDropdownInline({
  auth,
  onAuthChange,
}: {
  auth: NonNullable<import("@/lib/types").ApiRequest["auth"]>;
  onAuthChange: (a: NonNullable<import("@/lib/types").ApiRequest["auth"]>) => void;
}) {
  const AUTH_OPTIONS = [
    { value: "none",    label: "No Auth",   icon: <Lock className="h-3.5 w-3.5" /> },
    { value: "bearer",  label: "Bearer",    icon: <Shield className="h-3.5 w-3.5" /> },
    { value: "basic",   label: "Basic",     icon: <User className="h-3.5 w-3.5" /> },
    { value: "api-key", label: "API Key",   icon: <Key className="h-3.5 w-3.5" /> },
    { value: "oauth2",  label: "OAuth 2.0", icon: <Globe className="h-3.5 w-3.5" /> },
  ] as const;

  const current = AUTH_OPTIONS.find((o) => o.value === auth.type) ?? AUTH_OPTIONS[0];

  return (
    <div className="space-y-2">
      <Select value={auth.type} onValueChange={(v) => onAuthChange({ ...auth, type: v as typeof auth.type })}>
        <SelectTrigger className="h-8 text-xs w-44 bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{current.icon}</span>
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          {AUTH_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="flex items-center gap-2">
                {o.icon} {o.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AuthFields auth={auth} onAuthChange={onAuthChange} />
    </div>
  );
}

// ── Auth tab editor (auth type as dropdown) ───────────────────────────────────

function AuthEditor({
  auth,
  onAuthChange,
}: {
  auth: NonNullable<import("@/lib/types").ApiRequest["auth"]>;
  onAuthChange: (a: NonNullable<import("@/lib/types").ApiRequest["auth"]>) => void;
}) {
  const AUTH_OPTIONS = [
    { value: "none",    label: "No Auth",   icon: <Lock className="h-3.5 w-3.5" /> },
    { value: "bearer",  label: "Bearer Token", icon: <Shield className="h-3.5 w-3.5" /> },
    { value: "basic",   label: "Basic Auth", icon: <User className="h-3.5 w-3.5" /> },
    { value: "api-key", label: "API Key",   icon: <Key className="h-3.5 w-3.5" /> },
    { value: "oauth2",  label: "OAuth 2.0", icon: <Globe className="h-3.5 w-3.5" /> },
  ] as const;

  const current = AUTH_OPTIONS.find((o) => o.value === auth.type) ?? AUTH_OPTIONS[0];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Authorization Type</Label>
        <Select value={auth.type} onValueChange={(v) => onAuthChange({ ...auth, type: v as typeof auth.type })}>
          <SelectTrigger className="h-9 text-sm w-56 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{current.icon}</span>
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            {AUTH_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <span className="flex items-center gap-2">
                  {o.icon} {o.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <AuthFields auth={auth} onAuthChange={onAuthChange} />
    </div>
  );
}

// ── Shared auth fields component ──────────────────────────────────────────────

function AuthFields({
  auth,
  onAuthChange,
}: {
  auth: NonNullable<import("@/lib/types").ApiRequest["auth"]>;
  onAuthChange: (a: NonNullable<import("@/lib/types").ApiRequest["auth"]>) => void;
}) {
  if (auth.type === "bearer") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Token</Label>
        <Input
          value={auth.bearer?.token ?? ""}
          onChange={(e) => onAuthChange({ ...auth, bearer: { token: e.target.value } })}
          placeholder="Bearer token"
          className="font-mono text-sm bg-muted/20"
        />
      </div>
    );
  }

  if (auth.type === "basic") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Username</Label>
          <Input
            value={auth.basic?.username ?? ""}
            onChange={(e) => onAuthChange({ ...auth, basic: { ...(auth.basic ?? { username: "", password: "" }), username: e.target.value } })}
            placeholder="Username"
            className="bg-muted/20"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Password</Label>
          <Input
            type="password"
            value={auth.basic?.password ?? ""}
            onChange={(e) => onAuthChange({ ...auth, basic: { ...(auth.basic ?? { username: "", password: "" }), password: e.target.value } })}
            placeholder="Password"
            className="bg-muted/20"
          />
        </div>
      </div>
    );
  }

  if (auth.type === "api-key") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Key</Label>
            <Input
              value={auth.apiKey?.key ?? ""}
              onChange={(e) => onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), key: e.target.value } })}
              placeholder="X-API-Key"
              className="bg-muted/20"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Value</Label>
            <Input
              value={auth.apiKey?.value ?? ""}
              onChange={(e) => onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), value: e.target.value } })}
              placeholder="API key value"
              className="bg-muted/20"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Add To</Label>
          <Select
            value={auth.apiKey?.addTo ?? "header"}
            onValueChange={(v) => onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), addTo: v as "header" | "query" } })}
          >
            <SelectTrigger className="w-36 h-8 text-xs bg-muted/20"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="header">Header</SelectItem>
              <SelectItem value="query">Query Param</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (auth.type === "none") {
    return (
      <p className="text-xs text-muted-foreground py-2">
        No authentication. Add an <strong>Authorization</strong> header manually if needed.
      </p>
    );
  }

  return null;
}

// ── Script tab ────────────────────────────────────────────────────────────────

function ScriptTab({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string;
}) {
  return (
    <div className="flex flex-col h-full p-4 gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-0.5">JavaScript</span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 font-mono text-xs resize-none bg-muted/20 leading-relaxed min-h-[180px]"
        spellCheck={false}
      />
    </div>
  );
}

// ── GraphQL query editor ──────────────────────────────────────────────────────

function GraphQLQueryTab({ query, variables, operationName, onQueryChange, onVariablesChange, onOperationNameChange }: {
  query: string; variables: string; operationName: string;
  onQueryChange: (v: string) => void; onVariablesChange: (v: string) => void; onOperationNameChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Operation Name <span className="opacity-50">(optional)</span></Label>
        <Input value={operationName} onChange={(e) => onOperationNameChange(e.target.value)}
          placeholder="e.g. GetUsers" className="h-7 text-xs font-mono bg-muted/20" />
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div className="flex-1 min-h-0 flex flex-col">
          <Label className="text-xs text-muted-foreground mb-1">Query / Mutation</Label>
          <Textarea value={query} onChange={(e) => onQueryChange(e.target.value)}
            placeholder={"query GetUsers {\n  users {\n    id\n    name\n    email\n  }\n}"}
            className="flex-1 font-mono text-xs resize-none bg-muted/20 min-h-[120px]" spellCheck={false} />
        </div>
        <div className="flex flex-col" style={{ minHeight: 80 }}>
          <Label className="text-xs text-muted-foreground mb-1">Variables <span className="opacity-50">(JSON)</span></Label>
          <Textarea value={variables} onChange={(e) => onVariablesChange(e.target.value)}
            placeholder={'{\n  "id": 1\n}'}
            className="flex-1 font-mono text-xs resize-none bg-muted/20 min-h-[60px]" spellCheck={false} />
        </div>
      </div>
    </div>
  );
}

// ── SOAP body editor (version moved to body type dropdown) ────────────────────

function SoapBodyEditor({ content, soapAction, onContentChange, onSoapActionChange }: {
  content: string; soapAction: string;
  onContentChange: (v: string) => void; onSoapActionChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">SOAPAction</Label>
        <Input value={soapAction} onChange={(e) => onSoapActionChange(e.target.value)}
          placeholder="http://tempuri.org/GetUser" className="h-8 text-xs font-mono bg-muted/20" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Request Body XML <span className="opacity-50">(envelope added automatically)</span>
        </Label>
        <Textarea value={content} onChange={(e) => onContentChange(e.target.value)}
          placeholder={"<GetUser xmlns=\"http://tempuri.org/\">\n  <userId>1</userId>\n</GetUser>"}
          className="min-h-[200px] font-mono text-sm resize-none bg-muted/20" spellCheck={false} />
      </div>
    </div>
  );
}

// ── gRPC request tab ──────────────────────────────────────────────────────────

function GrpcRequestTab({ content, metadata, onContentChange, onMetadataChange }: {
  content: string; metadata: KeyValue[];
  onContentChange: (v: string) => void; onMetadataChange: (v: KeyValue[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-3 rounded-md bg-purple-500/8 border border-purple-500/20 text-xs text-muted-foreground leading-relaxed">
        <strong className="text-purple-600 dark:text-purple-400">gRPC-Web (JSON)</strong> — URL:{" "}
        <code className="font-mono bg-muted px-1 rounded">grpc://host:port/package.Service/Method</code>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Request Message <span className="opacity-50">(JSON)</span></Label>
        <Textarea value={content} onChange={(e) => onContentChange(e.target.value)}
          placeholder={'{\n  "name": "World"\n}'}
          className="min-h-[160px] font-mono text-sm resize-none bg-muted/20" spellCheck={false} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Metadata (headers)</Label>
        <KeyValueEditor items={metadata} onChange={onMetadataChange} keyPlaceholder="Metadata key" valuePlaceholder="Value" />
      </div>
    </div>
  );
}

// ── Root RequestEditor ────────────────────────────────────────────────────────

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

export function RequestEditor() {
  const activeRequestId = useAppStore((s) => s.activeRequestId);
  if (!activeRequestId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <ZapIcon className="h-10 w-10 opacity-15" />
        <p className="text-sm">Select or create a request to get started</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full">
      <RequestUrlBar />
      <div className="flex-1 overflow-hidden"><RequestConfigTabs /></div>
    </div>
  );
}
