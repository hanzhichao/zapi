"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Send, Unplug, Plug, ChevronDown, Gauge, Info, ListFilter, SlidersHorizontal, FileJson, CheckCircle2, XCircle, Clock, Database } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { VisualTestBuilder } from "@/components/VisualTestBuilder";
import { ResponseExtractor } from "@/components/ResponseExtractor";
import type { BodyType, ConsoleLog, HttpMethod, KeyValue, Protocol } from "@/lib/types";
import { cn } from "@/lib/utils";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-green-600 dark:text-green-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-yellow-600 dark:text-yellow-400",
  PATCH: "text-orange-600 dark:text-orange-400",
  DELETE: "text-red-600 dark:text-red-400",
  HEAD: "text-purple-600 dark:text-purple-400",
  OPTIONS: "text-gray-600 dark:text-gray-400",
};

const PROTOCOL_META: Record<Protocol, { label: string; color: string; urlPrefix: string }> = {
  http: { label: "HTTP", color: "text-sky-600 dark:text-sky-400", urlPrefix: "https://" },
  graphql: { label: "GQL", color: "text-pink-600 dark:text-pink-400", urlPrefix: "https://" },
  soap: { label: "SOAP", color: "text-yellow-600 dark:text-yellow-400", urlPrefix: "https://" },
  websocket: { label: "WS", color: "text-orange-600 dark:text-orange-400", urlPrefix: "ws://" },
  grpc: { label: "gRPC", color: "text-purple-600 dark:text-purple-400", urlPrefix: "grpc://" },
};

// ── Protocol selector badge ────────────────────────────────────────────────

function ProtocolSelector({
  value,
  onChange,
}: {
  value: Protocol;
  onChange: (p: Protocol) => void;
}) {
  const meta = PROTOCOL_META[value];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Protocol)}>
      <SelectTrigger className={cn("w-[72px] font-bold text-xs h-8 border-0 bg-muted/50 hover:bg-muted shrink-0", meta.color)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PROTOCOL_META) as Protocol[]).map((p) => (
          <SelectItem key={p} value={p} className={cn("font-bold text-xs", PROTOCOL_META[p].color)}>
            {PROTOCOL_META[p].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── URL bar ────────────────────────────────────────────────────────────────

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
      if (wsConnected) {
        disconnectWs(request.id);
        setWsConnected(false);
        return;
      }
      clearWsMessages();
      connectWs(
        request.id,
        request.url,
        (msg) => addWsMessage(msg),
        (connected) => setWsConnected(connected),
      );
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

      // ── Plugin beforeRequest hooks ─────────────────────────────────────
      const enabledPlugins = store.plugins;
      const variablesMap = Object.fromEntries([...colVars, ...mergedEnvVars].map((v) => [v.name, v.value]));

      let result;
      if (proto === "grpc") {
        // gRPC-Web invocation
        const grpcUrl = request.url.replace(/^grpc:\/\//, "http://").replace(/^grpcs:\/\//, "https://");
        const extraHeaders: Record<string, string> = {};
        for (const h of (request.grpcMetadata ?? []).filter((h) => h.enabled && h.key)) {
          extraHeaders[h.key] = h.value;
        }
        result = await invokeGrpc(grpcUrl, request.body.content || "{}", extraHeaders);
      } else {
        // Build initial plugin request context from the resolved request
        const pluginReqCtx = await runBeforeRequest(
          {
            method: request.method,
            url: request.url,
            headers: preCtx.headerOverrides,
            body: request.body?.content ?? null,
            config: {},
            variables: variablesMap,
          },
          enabledPlugins
        );

        // Merge plugin-modified headers back into extraHeaders
        const mergedExtraHeaders = {
          ...preCtx.headerOverrides,
          ...pluginReqCtx.headers,
        };

        result = await executeRequest(request, colVars, mergedEnvVars, mergedExtraHeaders);

        // ── Plugin afterResponse hooks ───────────────────────────────────
        await runAfterResponse(
          {
            request: { method: pluginReqCtx.method, url: pluginReqCtx.url, headers: pluginReqCtx.headers, body: pluginReqCtx.body, config: {}, variables: variablesMap },
            status: result.status,
            statusText: result.statusText,
            headers: result.headers as Record<string, string>,
            body: result.body,
            durationMs: result.time,
            config: {},
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

      // ── Visual assertions ───────────────────────────────────────────────
      const visualResults = request.visualAssertions?.length
        ? runVisualAssertions(request.visualAssertions.filter((a) => a.enabled), result)
        : [];

      // ── Variable extractors ─────────────────────────────────────────────
      if (request.extractors?.length) {
        const extracted = runExtractors(request.extractors.filter((r) => r.enabled), result);
        for (const ev of extracted) {
          if (!ev.error) {
            if (ev.scope === "environment" && activeEnv) {
              setEnvironmentVariable(activeEnv.id, ev.varName, ev.value);
            } else {
              // Set on collection variable (update or add)
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

  // Listen for global send event (⌘+Enter)
  useEffect(() => {
    const handler = () => { handleSend(); };
    window.addEventListener("zapi:send", handler);
    return () => window.removeEventListener("zapi:send", handler);
  }, [handleSend]);

  const [stressOpen, setStressOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  if (!request) return null;

  const isWs = proto === "websocket";

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-background shrink-0">
        <ProtocolSelector
          value={proto}
          onChange={(p) => updateRequest(request.id, { protocol: p })}
        />

        {/* Method selector — hidden for WebSocket/gRPC/GraphQL/SOAP */}
        {proto === "http" && (
          <Select
            value={request.method}
            onValueChange={(v) => updateRequest(request.id, { method: v as HttpMethod })}
          >
            <SelectTrigger className={cn("w-24 font-bold text-sm h-8 border-0 bg-muted/50 hover:bg-muted shrink-0", METHOD_COLORS[request.method])}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m} className={cn("font-bold", METHOD_COLORS[m])}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Input
          value={request.url}
          onChange={(e) => updateRequest(request.id, { url: e.target.value })}
          placeholder={
            isWs ? "ws://example.com/socket" :
            proto === "grpc" ? "grpc://host:port/package.Service/Method" :
            proto === "graphql" ? "https://api.example.com/graphql" :
            proto === "soap" ? "https://service.example.com/endpoint" :
            "Enter URL  ·  Use {{variable}} for substitution"
          }
          className="flex-1 font-mono text-sm h-8 bg-muted/30 border-muted focus:bg-background transition-colors"
          onKeyDown={(e) => !isWs && e.key === "Enter" && handleSend()}
        />

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
          /* Send + dropdown group */
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
            {/* Dropdown caret */}
            <button
              onClick={() => setDropOpen((o) => !o)}
              onBlur={() => setTimeout(() => setDropOpen(false), 150)}
              className={cn(
                "h-8 w-7 flex items-center justify-center rounded-r-md bg-primary hover:brightness-90 transition-all shrink-0",
                "text-primary-foreground"
              )}
              title="More send options"
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

// ── Config tabs ────────────────────────────────────────────────────────────

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
  const hasDocsContent = Boolean(
    request.description?.trim() ||
    request.requestSchema?.trim() ||
    request.responseSchema?.trim()
  );

  // Build tabs based on protocol
  const tabs = buildTabs(proto, activeParams, activeHeaders, hasBody, request.auth.type !== "none", hasPreScript, hasTests, hasDocsContent, hasExtractors, hasAssertions, request);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
      <div className="px-3 border-b bg-muted/10 shrink-0">
        <TabsList className="h-9 bg-transparent p-0 gap-0 flex-wrap">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="relative h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground transition-colors"
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1 text-[9px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-semibold">{tab.count}</span>
              )}
              {tab.dot && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="flex-1 overflow-auto">
        {/* HTTP / Universal tabs */}
        <TabsContent value="params" className="p-4 mt-0">
          <KeyValueEditor items={request.params} onChange={(params) => updateRequest(request.id, { params })} keyPlaceholder="Parameter" />
        </TabsContent>
        <TabsContent value="headers" className="p-4 mt-0">
          <KeyValueEditor items={request.headers} onChange={(headers) => updateRequest(request.id, { headers })} keyPlaceholder="Header" />
        </TabsContent>
        <TabsContent value="body" className="p-4 mt-0">
          <BodyEditor
            bodyType={request.body.type}
            content={request.body.content}
            formData={request.body.formData}
            onTypeChange={(type) => updateRequest(request.id, { body: { ...request.body, type } })}
            onContentChange={(content) => updateRequest(request.id, { body: { ...request.body, content } })}
            onFormDataChange={(formData) => updateRequest(request.id, { body: { ...request.body, formData } })}
          />
        </TabsContent>
        <TabsContent value="auth" className="p-4 mt-0">
          <AuthEditor auth={request.auth} onAuthChange={(auth) => updateRequest(request.id, { auth })} />
        </TabsContent>
        <TabsContent value="pre-script" className="p-0 mt-0 h-full">
          <ScriptTab value={request.preScript ?? ""} onChange={(v) => updateRequest(request.id, { preScript: v })}
            placeholder={`// Runs before the request\nzapi.environment.set("token", "value");\nzapi.request.headers.add({ key: "X-Custom", value: "data" });`}
            label="Pre-request Script" />
        </TabsContent>
        <TabsContent value="tests" className="p-0 mt-0 h-full">
          <ScriptTab value={request.tests ?? ""} onChange={(v) => updateRequest(request.id, { tests: v })}
            placeholder={`// Runs after the response\nzapi.test("Status is 200", () => {\n  zapi.response.to.have.status(200);\n});\nzapi.environment.set("userId", zapi.response.json().id);`}
            label="Tests" />
        </TabsContent>

        {/* GraphQL */}
        <TabsContent value="query" className="p-0 mt-0 h-full">
          <GraphQLQueryTab
            query={request.body.content ?? ""}
            variables={request.graphqlVariables ?? ""}
            operationName={request.graphqlOperationName ?? ""}
            onQueryChange={(q) => updateRequest(request.id, { body: { ...request.body, content: q } })}
            onVariablesChange={(v) => updateRequest(request.id, { graphqlVariables: v })}
            onOperationNameChange={(n) => updateRequest(request.id, { graphqlOperationName: n })}
          />
        </TabsContent>

        {/* SOAP */}
        <TabsContent value="soap-body" className="p-4 mt-0">
          <SoapBodyTab
            content={request.body.content ?? ""}
            soapAction={request.soapAction ?? ""}
            soapVersion={request.soapVersion ?? "1.1"}
            onContentChange={(c) => updateRequest(request.id, { body: { ...request.body, content: c } })}
            onSoapActionChange={(a) => updateRequest(request.id, { soapAction: a })}
            onSoapVersionChange={(v) => updateRequest(request.id, { soapVersion: v })}
          />
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

        {/* Docs — unified multi-section page */}
        <TabsContent value="docs" className="mt-0 h-full overflow-hidden">
          <RequestDocsTab
            request={request}
            onUpdate={(patch) => updateRequest(request.id, patch)}
          />
        </TabsContent>

        {/* Phase 2: Visual Assertions */}
        <TabsContent value="assertions" className="p-0 mt-0 h-full">
          <VisualTestBuilder requestId={request.id} />
        </TabsContent>

        {/* Phase 2: Variable Extractor */}
        <TabsContent value="extract" className="p-0 mt-0 h-full">
          <ResponseExtractor requestId={request.id} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ── Tab definitions ────────────────────────────────────────────────────────

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
  hasTests: boolean,
  hasDocsContent: boolean,
  hasExtractors: boolean,
  hasAssertions: boolean,
  request: import("@/lib/types").ApiRequest
): TabDef[] {
  const scripting: TabDef[] = [
    t("pre-script", "Pre-Script", { dot: hasPreScript }),
    t("tests",      "Tests",      { dot: hasTests }),
    t("assertions", "Assertions", { dot: hasAssertions }),
    t("extract",    "Extract",    { dot: hasExtractors }),
  ];
  const docTab = t("docs", "Docs", { dot: hasDocsContent });
  const common: TabDef[] = [
    t("headers", "Headers", { count: activeHeaders }),
    t("auth",    "Auth",    { dot: hasAuth }),
  ];

  if (proto === "websocket") return [...common, docTab];
  if (proto === "grpc") return [
    t("grpc-request", "Request", { dot: Boolean(request.body.content?.trim()) }),
    ...common, docTab,
  ];
  if (proto === "graphql") return [
    t("query", "Query", { dot: Boolean(request.body.content?.trim()) }),
    ...common, ...scripting, docTab,
  ];
  if (proto === "soap") return [
    t("soap-body", "Body", { dot: Boolean(request.body.content?.trim()) }),
    ...common, docTab,
  ];
  // http (default)
  return [
    t("params",  "Params",  { count: activeParams }),
    t("headers", "Headers", { count: activeHeaders }),
    t("body",    "Body",    { dot: hasBody }),
    t("auth",    "Auth",    { dot: hasAuth }),
    ...scripting, docTab,
  ];
}

// ── Sub-editors ────────────────────────────────────────────────────────────

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

function ScriptTab({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="flex flex-col h-full p-4 gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-0.5">JavaScript</span>
      </div>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 font-mono text-xs resize-none bg-muted/20 leading-relaxed min-h-[180px]" spellCheck={false} />
    </div>
  );
}

function BodyEditor({ bodyType, content, formData, onTypeChange, onContentChange, onFormDataChange }: {
  bodyType: BodyType; content: string; formData: KeyValue[];
  onTypeChange: (type: BodyType) => void; onContentChange: (content: string) => void; onFormDataChange: (data: KeyValue[]) => void;
}) {
  const BODY_TYPES: { value: BodyType; label: string }[] = [
    { value: "none", label: "None" }, { value: "json", label: "JSON" }, { value: "form", label: "Form URL" },
    { value: "formdata", label: "Multipart" }, { value: "xml", label: "XML" }, { value: "text", label: "Text" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {BODY_TYPES.map((t) => (
          <button key={t.value} onClick={() => onTypeChange(t.value)}
            className={cn("text-xs px-3 py-1 rounded-full border transition-all",
              bodyType === t.value ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border hover:bg-accent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {bodyType === "none" && <p className="text-xs text-muted-foreground py-6 text-center">This request has no body.</p>}
      {(bodyType === "json" || bodyType === "xml" || bodyType === "text") && (
        <Textarea value={content} onChange={(e) => onContentChange(e.target.value)}
          placeholder={bodyType === "json" ? '{\n  "key": "value"\n}' : bodyType === "xml" ? "<root>\n  <element>value</element>\n</root>" : "Enter text content..."}
          className="min-h-[200px] font-mono text-sm resize-none bg-muted/20" />
      )}
      {(bodyType === "form" || bodyType === "formdata") && (
        <KeyValueEditor items={formData} onChange={onFormDataChange} keyPlaceholder="Field name" valuePlaceholder="Value" />
      )}
    </div>
  );
}

function GraphQLQueryTab({ query, variables, operationName, onQueryChange, onVariablesChange, onOperationNameChange }: {
  query: string; variables: string; operationName: string;
  onQueryChange: (v: string) => void; onVariablesChange: (v: string) => void; onOperationNameChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 h-full">
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
            className="flex-1 font-mono text-xs resize-none bg-muted/20 min-h-[140px]" spellCheck={false} />
        </div>
        <div className="flex flex-col" style={{ minHeight: 100 }}>
          <Label className="text-xs text-muted-foreground mb-1">Variables <span className="opacity-50">(JSON)</span></Label>
          <Textarea value={variables} onChange={(e) => onVariablesChange(e.target.value)}
            placeholder={'{\n  "id": 1\n}'}
            className="flex-1 font-mono text-xs resize-none bg-muted/20 min-h-[80px]" spellCheck={false} />
        </div>
      </div>
    </div>
  );
}

function SoapBodyTab({ content, soapAction, soapVersion, onContentChange, onSoapActionChange, onSoapVersionChange }: {
  content: string; soapAction: string; soapVersion: "1.1" | "1.2";
  onContentChange: (v: string) => void; onSoapActionChange: (v: string) => void; onSoapVersionChange: (v: "1.1" | "1.2") => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">SOAP Version</Label>
          <div className="flex gap-1.5">
            {(["1.1", "1.2"] as const).map((v) => (
              <button key={v} onClick={() => onSoapVersionChange(v)}
                className={cn("text-xs px-3 py-1 rounded-full border transition-all",
                  soapVersion === v ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent text-muted-foreground")}>
                SOAP {v}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">SOAPAction</Label>
          <Input value={soapAction} onChange={(e) => onSoapActionChange(e.target.value)}
            placeholder="http://tempuri.org/GetUser" className="h-8 text-xs font-mono bg-muted/20" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Request Body XML <span className="opacity-50">(inside Body element — envelope is added automatically)</span></Label>
        <Textarea value={content} onChange={(e) => onContentChange(e.target.value)}
          placeholder={"<GetUser xmlns=\"http://tempuri.org/\">\n  <userId>1</userId>\n</GetUser>"}
          className="min-h-[200px] font-mono text-sm resize-none bg-muted/20" spellCheck={false} />
      </div>
    </div>
  );
}

function GrpcRequestTab({ content, metadata, onContentChange, onMetadataChange }: {
  content: string; metadata: KeyValue[];
  onContentChange: (v: string) => void; onMetadataChange: (v: KeyValue[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-3 rounded-md bg-purple-500/8 border border-purple-500/20 text-xs text-muted-foreground leading-relaxed">
        <strong className="text-purple-600 dark:text-purple-400">gRPC-Web (JSON)</strong> — URL format:{" "}
        <code className="font-mono bg-muted px-1 rounded">grpc://host:port/package.Service/Method</code>.
        Request body is JSON-encoded (requires server-side JSON transcoding or gRPC-Web+JSON support).
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

// ── Request Docs Tab ───────────────────────────────────────────────────────

const SCHEMA_PLACEHOLDER = `{
  "type": "object",
  "properties": {
    "id": { "type": "integer" },
    "name": { "type": "string" }
  },
  "required": ["id"]
}`;

const METHOD_COLORS_BADGE: Record<string, string> = {
  GET: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  POST: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  PUT: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  PATCH: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  HEAD: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  OPTIONS: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
  WS: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  GQL: "bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/30",
  gRPC: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  SOAP: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
};

function DocSection({ icon, title, badge, children }: {
  icon: React.ReactNode; title: string; badge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

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

function RequestDocsTab({
  request,
  onUpdate,
}: {
  request: import("@/lib/types").ApiRequest;
  onUpdate: (patch: Partial<import("@/lib/types").ApiRequest>) => void;
}) {
  const response = useAppStore((s) => s.response);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [respBodyExpanded, setRespBodyExpanded] = useState(false);

  const proto = request.protocol ?? "http";
  const badge =
    proto === "websocket" ? "WS" :
    proto === "graphql" ? "GQL" :
    proto === "grpc" ? "gRPC" :
    proto === "soap" ? "SOAP" :
    request.method;
  const badgeClass = METHOD_COLORS_BADGE[badge] ?? METHOD_COLORS_BADGE["OPTIONS"];

  const enabledParams = request.params.filter((p) => p.enabled && p.key);
  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 space-y-8 max-w-3xl">

        {/* ── 1. Interface Info ─────────────────────────────────────────── */}
        <DocSection icon={<Info className="h-4 w-4" />} title="接口信息">
          <div className="space-y-3">
            {/* Name */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">接口名称</Label>
              <Input
                value={request.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                placeholder="My API endpoint"
                className="h-8 text-sm bg-muted/20"
              />
            </div>

            {/* Method + URL read-only display */}
            <div className="flex items-center gap-2 rounded-md bg-muted/30 border border-border px-3 py-2">
              <span className={cn("text-[11px] font-bold font-mono px-2 py-0.5 rounded border shrink-0", badgeClass)}>
                {badge}
              </span>
              <code className="text-xs text-muted-foreground truncate flex-1 font-mono">
                {request.url || <span className="opacity-40">—</span>}
              </code>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">接口描述</Label>
              <Textarea
                value={request.description ?? ""}
                onChange={(e) => onUpdate({ description: e.target.value })}
                placeholder="描述该接口的用途、使用场景及注意事项…"
                className="min-h-[80px] text-sm resize-none bg-muted/20 leading-relaxed"
              />
            </div>
          </div>
        </DocSection>

        {/* ── 2. Request Params ─────────────────────────────────────────── */}
        <DocSection
          icon={<ListFilter className="h-4 w-4" />}
          title="请求参数"
          badge={
            enabledParams.length > 0 ? (
              <span className="text-[10px] bg-primary/15 text-primary rounded-full px-2 py-0.5 font-semibold">
                {enabledParams.length}
              </span>
            ) : null
          }
        >
          {enabledParams.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">暂无启用的 Query 参数</p>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/3">参数名</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/3">值</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">描述</th>
                  </tr>
                </thead>
                <tbody>
                  {enabledParams.map((p, i) => (
                    <tr key={p.id} className={cn("border-b border-border last:border-0", i % 2 === 1 && "bg-muted/10")}>
                      <td className="px-3 py-2 font-mono text-foreground">{p.key}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{p.value || <span className="opacity-30">—</span>}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.description || <span className="opacity-30">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            在 <strong>Params</strong> 标签页编辑参数
          </p>
        </DocSection>

        {/* ── 3. Request Headers ───────────────────────────────────────── */}
        <DocSection
          icon={<SlidersHorizontal className="h-4 w-4" />}
          title="请求头"
          badge={
            enabledHeaders.length > 0 ? (
              <span className="text-[10px] bg-primary/15 text-primary rounded-full px-2 py-0.5 font-semibold">
                {enabledHeaders.length}
              </span>
            ) : null
          }
        >
          {enabledHeaders.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">暂无启用的请求头</p>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-2/5">Header</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">值</th>
                  </tr>
                </thead>
                <tbody>
                  {enabledHeaders.map((h, i) => (
                    <tr key={h.id} className={cn("border-b border-border last:border-0", i % 2 === 1 && "bg-muted/10")}>
                      <td className="px-3 py-2 font-mono text-foreground">{h.key}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground break-all">{h.value || <span className="opacity-30">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            在 <strong>Headers</strong> 标签页编辑请求头
          </p>
        </DocSection>

        {/* ── 4. Schema ────────────────────────────────────────────────── */}
        <DocSection icon={<FileJson className="h-4 w-4" />} title="Schema 定义">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                请求体 Schema <span className="opacity-50">(JSON Schema)</span>
              </Label>
              <Textarea
                value={request.requestSchema ?? ""}
                onChange={(e) => onUpdate({ requestSchema: e.target.value })}
                placeholder={SCHEMA_PLACEHOLDER}
                className="min-h-[140px] font-mono text-xs resize-none bg-muted/20"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                响应体 Schema <span className="opacity-50">(JSON Schema)</span>
              </Label>
              <Textarea
                value={request.responseSchema ?? ""}
                onChange={(e) => onUpdate({ responseSchema: e.target.value })}
                placeholder={SCHEMA_PLACEHOLDER}
                className="min-h-[140px] font-mono text-xs resize-none bg-muted/20"
                spellCheck={false}
              />
            </div>
          </div>
        </DocSection>

        {/* ── 5. Response ──────────────────────────────────────────────── */}
        <DocSection
          icon={<Database className="h-4 w-4" />}
          title="最近响应"
          badge={
            response ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={response.status} />
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />{response.time}ms
                </span>
                <span className="text-xs text-muted-foreground">
                  {response.size < 1024 ? `${response.size} B` : `${(response.size / 1024).toFixed(1)} KB`}
                </span>
              </div>
            ) : null
          }
        >
          {!response ? (
            <p className="text-xs text-muted-foreground py-2">发送请求后在此查看响应摘要</p>
          ) : (
            <div className="space-y-3">
              {/* Status line */}
              <div className="flex items-center gap-2 rounded-md bg-muted/30 border border-border px-3 py-2 text-xs">
                {response.status >= 200 && response.status < 300
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                <StatusBadge status={response.status} />
                <span className="text-muted-foreground">{response.statusText}</span>
                <span className="ml-auto text-muted-foreground font-mono">{response.contentType}</span>
              </div>

              {/* Response headers */}
              {Object.keys(response.headers).length > 0 && (
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border">
                        <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-2/5">响应头</th>
                        <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(response.headers).map(([k, v], i) => (
                        <tr key={k} className={cn("border-b border-border last:border-0", i % 2 === 1 && "bg-muted/10")}>
                          <td className="px-3 py-1.5 font-mono text-foreground">{k}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground break-all">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Response body */}
              {response.body && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">响应体</Label>
                    {response.body.length > 500 && (
                      <button
                        onClick={() => setRespBodyExpanded((v) => !v)}
                        className="text-[10px] text-primary hover:underline"
                      >
                        {respBodyExpanded ? "收起" : "展开全部"}
                      </button>
                    )}
                  </div>
                  <pre className="rounded-md bg-muted/30 border border-border p-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                    {respBodyExpanded || response.body.length <= 500
                      ? response.body
                      : response.body.slice(0, 500) + "\n…"}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DocSection>

      </div>
    </div>
  );
}

function AuthEditor({ auth, onAuthChange }: {
  auth: NonNullable<import("@/lib/types").ApiRequest["auth"]>;
  onAuthChange: (auth: NonNullable<import("@/lib/types").ApiRequest["auth"]>) => void;
}) {
  const AUTH_TYPES = [
    { value: "none", label: "No Auth" }, { value: "bearer", label: "Bearer" },
    { value: "basic", label: "Basic" }, { value: "api-key", label: "API Key" },
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {AUTH_TYPES.map((t) => (
          <button key={t.value} onClick={() => onAuthChange({ ...auth, type: t.value })}
            className={cn("text-xs px-3 py-1 rounded-full border transition-all",
              auth.type === t.value ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border hover:bg-accent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {auth.type === "bearer" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Token</Label>
          <Input value={auth.bearer?.token ?? ""} onChange={(e) => onAuthChange({ ...auth, bearer: { token: e.target.value } })}
            placeholder="Bearer token" className="font-mono text-sm bg-muted/20" />
        </div>
      )}
      {auth.type === "basic" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input value={auth.basic?.username ?? ""} onChange={(e) => onAuthChange({ ...auth, basic: { ...(auth.basic ?? { username: "", password: "" }), username: e.target.value } })}
              placeholder="Username" className="bg-muted/20" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input type="password" value={auth.basic?.password ?? ""} onChange={(e) => onAuthChange({ ...auth, basic: { ...(auth.basic ?? { username: "", password: "" }), password: e.target.value } })}
              placeholder="Password" className="bg-muted/20" />
          </div>
        </div>
      )}
      {auth.type === "api-key" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Key</Label>
              <Input value={auth.apiKey?.key ?? ""} onChange={(e) => onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), key: e.target.value } })}
                placeholder="X-API-Key" className="bg-muted/20" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Value</Label>
              <Input value={auth.apiKey?.value ?? ""} onChange={(e) => onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), value: e.target.value } })}
                placeholder="API key value" className="bg-muted/20" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Add To</Label>
            <Select value={auth.apiKey?.addTo ?? "header"} onValueChange={(v) => onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), addTo: v as "header" | "query" } })}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query Param</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
