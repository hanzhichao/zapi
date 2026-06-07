"use client";

import { useCallback } from "react";
import { Loader2, Send } from "lucide-react";
import { getActiveEnvVars, useAppStore } from "@/lib/store";
import { executeRequest } from "@/lib/http-client";
import { buildPm, runScript } from "@/lib/pm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import type { BodyType, ConsoleLog, HttpMethod, KeyValue } from "@/lib/types";
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

export function RequestUrlBar() {
  const store = useAppStore();
  const {
    activeRequestId,
    requests,
    collections,
    environments,
    activeEnvironmentId,
    updateRequest,
    setResponse,
    setLoading,
    setTestResults,
    isLoading,
    addHistory,
    setEnvironmentVariable,
    addConsoleLogs,
  } = store;

  const request = requests.find((r) => r.id === activeRequestId);
  const envVars = getActiveEnvVars({ environments, activeEnvironmentId });

  const handleSend = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    setResponse(null);
    setTestResults([]);

    const capturedLogs: ConsoleLog[] = [];

    try {
      const collection = collections.find((c) => c.id === request.collectionId);
      const colVars = collection?.variables ?? [];

      const preCtx = {
        testResults: [] as import("@/lib/types").TestResult[],
        headerOverrides: {} as Record<string, string>,
        variableOverrides: {} as Record<string, string>,
      };

      const activeEnv = activeEnvironmentId
        ? environments.find((e) => e.id === activeEnvironmentId)
        : null;

      // Pre-script execution
      if (request.preScript?.trim()) {
        const preZapi = buildPm(
          preCtx,
          {
            getVar: (key) => envVars.find((v) => v.name === key)?.value,
            setVar: (key, value) => {
              if (activeEnv) setEnvironmentVariable(activeEnv.id, key, value);
            },
          },
          Object.fromEntries(colVars.map((v) => [v.name, v.value])),
          undefined
        );
        const err = runScript(request.preScript, preZapi, capturedLogs);
        if (err) {
          capturedLogs.push({ id: crypto.randomUUID(), level: "error", message: `Pre-script error: ${err}`, timestamp: Date.now() });
        }
      }

      // Merge variable overrides from pre-script
      const mergedEnvVars = [
        ...envVars,
        ...Object.entries(preCtx.variableOverrides).map(([name, value]) => ({
          id: name,
          name,
          value,
          enabled: true,
        })),
      ];

      // Log outgoing request
      capturedLogs.push({
        id: crypto.randomUUID(),
        level: "request",
        message: `${request.method} ${request.url}`,
        timestamp: Date.now(),
      });

      const result = await executeRequest(request, colVars, mergedEnvVars, preCtx.headerOverrides);
      setResponse(result);

      // Log response
      capturedLogs.push({
        id: crypto.randomUUID(),
        level: "response",
        message: `${result.status} ${result.statusText}  ${result.time}ms  ${result.size < 1024 ? result.size + " B" : (result.size / 1024).toFixed(1) + " KB"}`,
        timestamp: Date.now(),
      });

      // Test execution
      const testCtx = {
        testResults: [] as import("@/lib/types").TestResult[],
        headerOverrides: {} as Record<string, string>,
        variableOverrides: {} as Record<string, string>,
      };

      if (request.tests?.trim()) {
        const testZapi = buildPm(
          testCtx,
          {
            getVar: (key) => mergedEnvVars.find((v) => v.name === key)?.value,
            setVar: (key, value) => {
              if (activeEnv) setEnvironmentVariable(activeEnv.id, key, value);
            },
          },
          Object.fromEntries(colVars.map((v) => [v.name, v.value])),
          result
        );
        const err = runScript(request.tests, testZapi, capturedLogs);
        if (err) {
          capturedLogs.push({ id: crypto.randomUUID(), level: "error", message: `Tests error: ${err}`, timestamp: Date.now() });
        }
      }

      setTestResults(testCtx.testResults);
      addHistory({ ...request, response: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      capturedLogs.push({ id: crypto.randomUUID(), level: "error", message: msg, timestamp: Date.now() });
      setResponse({
        status: 0,
        statusText: "Error",
        headers: {},
        body: msg,
        size: 0,
        time: 0,
        contentType: "text/plain",
      });
    } finally {
      setLoading(false);
      if (capturedLogs.length > 0) addConsoleLogs(capturedLogs);
    }
  }, [request, collections, environments, activeEnvironmentId, envVars, setLoading, setResponse, setTestResults, addHistory, setEnvironmentVariable, addConsoleLogs]);

  if (!request) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-background shrink-0">
      <Select
        value={request.method}
        onValueChange={(v) => updateRequest(request.id, { method: v as HttpMethod })}
      >
        <SelectTrigger className={cn("w-28 font-bold text-sm h-8 border-0 bg-muted/50 hover:bg-muted", METHOD_COLORS[request.method])}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HTTP_METHODS.map((m) => (
            <SelectItem key={m} value={m} className={cn("font-bold", METHOD_COLORS[m])}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={request.url}
        onChange={(e) => updateRequest(request.id, { url: e.target.value })}
        placeholder="Enter URL  ·  Use {{variable}} for substitution"
        className="flex-1 font-mono text-sm h-8 bg-muted/30 border-muted focus:bg-background transition-colors"
        onKeyDown={(e) => e.key === "Enter" && handleSend()}
      />
      <Button
        onClick={handleSend}
        disabled={isLoading || !request.url}
        className="gap-1.5 h-8 px-4 text-sm font-medium"
        size="sm"
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
        Send
      </Button>
    </div>
  );
}

export function RequestConfigTabs() {
  const { activeRequestId, requests, activeTab, setActiveTab, updateRequest } = useAppStore();
  const request = requests.find((r) => r.id === activeRequestId);

  if (!request) return null;

  const activeParams = request.params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = request.headers.filter((h) => h.enabled && h.key).length;
  const hasBody = request.body.type !== "none";
  const hasPreScript = Boolean(request.preScript?.trim());
  const hasTests = Boolean(request.tests?.trim());

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
      <div className="px-3 border-b bg-muted/10 shrink-0">
        <TabsList className="h-9 bg-transparent p-0 gap-0">
          {[
            { value: "params", label: "Params", count: activeParams },
            { value: "headers", label: "Headers", count: activeHeaders },
            { value: "body", label: "Body", dot: hasBody },
            { value: "auth", label: "Auth", dot: request.auth.type !== "none" },
            { value: "pre-script", label: "Pre-Script", dot: hasPreScript },
            { value: "tests", label: "Tests", dot: hasTests },
            { value: "docs", label: "Docs" },
          ].map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="relative h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground transition-colors"
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1 text-[9px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-semibold">
                  {tab.count}
                </span>
              )}
              {tab.dot && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="flex-1 overflow-auto">
        <TabsContent value="params" className="p-4 mt-0">
          <KeyValueEditor
            items={request.params}
            onChange={(params) => updateRequest(request.id, { params })}
            keyPlaceholder="Parameter"
          />
        </TabsContent>
        <TabsContent value="headers" className="p-4 mt-0">
          <KeyValueEditor
            items={request.headers}
            onChange={(headers) => updateRequest(request.id, { headers })}
            keyPlaceholder="Header"
          />
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
          <AuthEditor
            auth={request.auth}
            onAuthChange={(auth) => updateRequest(request.id, { auth })}
          />
        </TabsContent>
        <TabsContent value="pre-script" className="p-0 mt-0 h-full">
          <ScriptTab
            value={request.preScript ?? ""}
            onChange={(v) => updateRequest(request.id, { preScript: v })}
            placeholder={`// Runs before the request is sent\n// Access and modify variables:\nzapi.environment.set("token", "my-value");\nzapi.request.headers.add({ key: "X-Custom", value: "data" });\n\n// Get collection/environment variables:\nconst base = zapi.environment.get("baseUrl");\nconsole.log("baseUrl:", base);`}
            label="Pre-request Script"
          />
        </TabsContent>
        <TabsContent value="tests" className="p-0 mt-0 h-full">
          <ScriptTab
            value={request.tests ?? ""}
            onChange={(v) => updateRequest(request.id, { tests: v })}
            placeholder={`// Runs after the response is received\nzapi.test("Status is 200", () => {\n  zapi.response.to.have.status(200);\n});\n\nzapi.test("Has data", () => {\n  const json = zapi.response.json();\n  zapi.expect(json).to.have.property("id");\n});\n\n// Save response value to environment:\nzapi.environment.set("userId", zapi.response.json().id);`}
            label="Tests"
          />
        </TabsContent>
        <TabsContent value="docs" className="p-4 mt-0">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Documentation</Label>
            <Textarea
              value={request.description ?? ""}
              onChange={(e) => updateRequest(request.id, { description: e.target.value })}
              placeholder="Add notes or documentation for this request..."
              className="min-h-[200px] font-mono text-sm resize-none bg-muted/20"
            />
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}

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
      <div className="flex-1 overflow-hidden">
        <RequestConfigTabs />
      </div>
    </div>
  );
}

function ScriptTab({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
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

function BodyEditor({
  bodyType,
  content,
  formData,
  onTypeChange,
  onContentChange,
  onFormDataChange,
}: {
  bodyType: BodyType;
  content: string;
  formData: KeyValue[];
  onTypeChange: (type: BodyType) => void;
  onContentChange: (content: string) => void;
  onFormDataChange: (data: KeyValue[]) => void;
}) {
  const BODY_TYPES: { value: BodyType; label: string }[] = [
    { value: "none", label: "None" },
    { value: "json", label: "JSON" },
    { value: "form", label: "Form URL" },
    { value: "formdata", label: "Multipart" },
    { value: "xml", label: "XML" },
    { value: "text", label: "Text" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {BODY_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => onTypeChange(t.value)}
            className={cn(
              "text-xs px-3 py-1 rounded-full border transition-all",
              bodyType === t.value
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border hover:bg-accent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {bodyType === "none" && (
        <p className="text-xs text-muted-foreground py-6 text-center">This request has no body.</p>
      )}
      {(bodyType === "json" || bodyType === "xml" || bodyType === "text") && (
        <Textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={
            bodyType === "json"
              ? '{\n  "key": "value"\n}'
              : bodyType === "xml"
                ? "<root>\n  <element>value</element>\n</root>"
                : "Enter text content..."
          }
          className="min-h-[200px] font-mono text-sm resize-none bg-muted/20"
        />
      )}
      {(bodyType === "form" || bodyType === "formdata") && (
        <KeyValueEditor
          items={formData}
          onChange={onFormDataChange}
          keyPlaceholder="Field name"
          valuePlaceholder="Value"
        />
      )}
    </div>
  );
}

function AuthEditor({
  auth,
  onAuthChange,
}: {
  auth: NonNullable<import("@/lib/types").ApiRequest["auth"]>;
  onAuthChange: (auth: NonNullable<import("@/lib/types").ApiRequest["auth"]>) => void;
}) {
  const AUTH_TYPES = [
    { value: "none", label: "No Auth" },
    { value: "bearer", label: "Bearer" },
    { value: "basic", label: "Basic" },
    { value: "api-key", label: "API Key" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {AUTH_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => onAuthChange({ ...auth, type: t.value })}
            className={cn(
              "text-xs px-3 py-1 rounded-full border transition-all",
              auth.type === t.value
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border hover:bg-accent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {auth.type === "bearer" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Token</Label>
          <Input
            value={auth.bearer?.token ?? ""}
            onChange={(e) => onAuthChange({ ...auth, bearer: { token: e.target.value } })}
            placeholder="Bearer token"
            className="font-mono text-sm bg-muted/20"
          />
        </div>
      )}

      {auth.type === "basic" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input
              value={auth.basic?.username ?? ""}
              onChange={(e) =>
                onAuthChange({ ...auth, basic: { ...(auth.basic ?? { username: "", password: "" }), username: e.target.value } })
              }
              placeholder="Username"
              className="bg-muted/20"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input
              type="password"
              value={auth.basic?.password ?? ""}
              onChange={(e) =>
                onAuthChange({ ...auth, basic: { ...(auth.basic ?? { username: "", password: "" }), password: e.target.value } })
              }
              placeholder="Password"
              className="bg-muted/20"
            />
          </div>
        </div>
      )}

      {auth.type === "api-key" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Key</Label>
              <Input
                value={auth.apiKey?.key ?? ""}
                onChange={(e) =>
                  onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), key: e.target.value } })
                }
                placeholder="X-API-Key"
                className="bg-muted/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Value</Label>
              <Input
                value={auth.apiKey?.value ?? ""}
                onChange={(e) =>
                  onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), value: e.target.value } })
                }
                placeholder="API key value"
                className="bg-muted/20"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Add To</Label>
            <Select
              value={auth.apiKey?.addTo ?? "header"}
              onValueChange={(v) =>
                onAuthChange({ ...auth, apiKey: { ...(auth.apiKey ?? { key: "", value: "", addTo: "header" }), addTo: v as "header" | "query" } })
              }
            >
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
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
