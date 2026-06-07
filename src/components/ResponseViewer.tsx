"use client";

import { useMemo, useState } from "react";
import { Check, CheckCircle2, Copy, Download, XCircle } from "lucide-react";
import {useAppStore} from "@/lib/store";
import {Button} from "@/components/ui/button";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {ScrollArea} from "@/components/ui/scroll-area";
import {cn} from "@/lib/utils";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({status}: { status: number }) {
  const color =
    status >= 200 && status < 300
      ? "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30"
      : status >= 300 && status < 400
        ? "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30"
        : status >= 400
          ? "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30"
          : "text-gray-600 bg-gray-100";

  return (
    <span className={cn("text-xs font-semibold px-2 py-0.5 rounded", color)}>
      {status} {status === 0 ? "Error" : ""}
    </span>
  );
}

function JsonRenderer({data}: { data: unknown; depth?: number }) {
  return <JsonNode value={data} depth={0}/>;
}

function JsonNode({value, depth}: { value: unknown; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (value === null) return <span className="text-gray-400">null</span>;
  if (typeof value === "boolean") return <span className="text-blue-500">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-amber-500">{String(value)}</span>;
  if (typeof value === "string")
    return <span className="text-green-600 dark:text-green-400">&quot;{value}&quot;</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">[]</span>;
    return (
      <span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground hover:text-foreground"
        >
          {collapsed ? "▶" : "▼"}{" "}
        </button>
        <span className="text-muted-foreground">[</span>
        {collapsed ? (
          <span
            className="text-muted-foreground cursor-pointer"
            onClick={() => setCollapsed(false)}
          >
            {" "}
            {value.length} items{" "}
          </span>
        ) : (
          <div style={{marginLeft: 16}}>
            {value.map((item, i) => (
              <div key={i}>
                <JsonNode value={item} depth={depth + 1}/>
                {i < value.length - 1 && <span className="text-muted-foreground">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="text-muted-foreground">]</span>
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted-foreground">{"{}"}</span>;
    return (
      <span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground hover:text-foreground"
        >
          {collapsed ? "▶" : "▼"}{" "}
        </button>
        <span className="text-muted-foreground">{"{"}</span>
        {collapsed ? (
          <span
            className="text-muted-foreground cursor-pointer"
            onClick={() => setCollapsed(false)}
          >
            {" "}
            {entries.length} keys{" "}
          </span>
        ) : (
          <div style={{marginLeft: 16}}>
            {entries.map(([key, val], i) => (
              <div key={key}>
                <span className="text-red-500 dark:text-red-400">&quot;{key}&quot;</span>
                <span className="text-muted-foreground">: </span>
                <JsonNode value={val} depth={depth + 1}/>
                {i < entries.length - 1 && <span className="text-muted-foreground">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="text-muted-foreground">{"}"}</span>
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

export function ResponseViewer() {
  const { response, isLoading, testResults } = useAppStore();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");

  const parsedJson = useMemo(() => {
    if (!response?.body) return null;
    if (!response.contentType.includes("json")) return null;
    try {
      return JSON.parse(response.body);
    } catch {
      return null;
    }
  }, [response]);

  const copyBody = () => {
    if (!response) return;
    navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadBody = () => {
    if (!response) return;
    const blob = new Blob([response.body], {type: response.contentType});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "response";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin"/>
          <span className="text-sm">Sending request...</span>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Hit Send to get a response</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b text-sm">
        <StatusBadge status={response.status}/>
        {response.statusText && (
          <span className="text-muted-foreground text-xs">{response.statusText}</span>
        )}
        <span className="text-muted-foreground text-xs">{response.time}ms</span>
        <span className="text-muted-foreground text-xs">{formatSize(response.size)}</span>
        {testResults.length > 0 && (
          <span className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            testResults.every(t => t.passed)
              ? "bg-green-500/15 text-green-600 dark:text-green-400"
              : "bg-red-500/15 text-red-600 dark:text-red-400"
          )}>
            {testResults.every(t => t.passed) ? "✓" : "✗"} {testResults.filter(t => t.passed).length}/{testResults.length} tests
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyBody} title="Copy">
            {copied ? <Check className="h-3.5 w-3.5 text-green-500"/> : <Copy className="h-3.5 w-3.5"/>}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={downloadBody} title="Download">
            <Download className="h-3.5 w-3.5"/>
          </Button>
        </div>
      </div>

      {/* Response Tabs */}
      <Tabs defaultValue="body" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 border-b bg-muted/10">
          <TabsList className="h-9 bg-transparent p-0 gap-0">
            <TabsTrigger value="body" className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground">
              Body
            </TabsTrigger>
            <TabsTrigger value="headers" className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground">
              Headers
              <span className="ml-1.5 text-[9px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-semibold">
                {Object.keys(response.headers).length}
              </span>
            </TabsTrigger>
            {testResults.length > 0 && (
              <TabsTrigger value="tests" className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground">
                Tests
                <span className={cn("ml-1.5 text-[9px] rounded-full px-1.5 py-0.5 font-semibold",
                  testResults.every(t => t.passed)
                    ? "bg-green-500/20 text-green-600 dark:text-green-400"
                    : "bg-red-500/20 text-red-600 dark:text-red-400"
                )}>
                  {testResults.filter(t => t.passed).length}/{testResults.length}
                </span>
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        <div className="flex-1 overflow-hidden">
          <TabsContent value="body" className="h-full mt-0">
            {parsedJson !== null && (
              <div className="flex items-center gap-2 px-4 py-1.5 border-b bg-muted/30">
                <button
                  onClick={() => setViewMode("pretty")}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    viewMode === "pretty" ? "bg-background shadow-sm" : "text-muted-foreground"
                  )}
                >
                  Pretty
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    viewMode === "raw" ? "bg-background shadow-sm" : "text-muted-foreground"
                  )}
                >
                  Raw
                </button>
              </div>
            )}
            <ScrollArea className="h-full">
              <div className="p-4">
                {parsedJson !== null && viewMode === "pretty" ? (
                  <div className="font-mono text-xs leading-relaxed">
                    <JsonRenderer data={parsedJson}/>
                  </div>
                ) : (
                  <pre className="font-mono text-xs whitespace-pre-wrap break-all text-foreground">
                    {response.body}
                  </pre>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="headers" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="p-4">
                <table className="w-full text-xs">
                  <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium pb-2 w-1/3">Header</th>
                    <th className="text-left font-medium pb-2">Value</th>
                  </tr>
                  </thead>
                  <tbody>
                  {Object.entries(response.headers).map(([key, value]) => (
                    <tr key={key} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 pr-4 font-mono text-blue-600 dark:text-blue-400">
                        {key}
                      </td>
                      <td className="py-1.5 font-mono break-all">{value}</td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="tests" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {testResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No tests defined</p>
                ) : (
                  testResults.map((t, i) => (
                    <div key={i} className={cn(
                      "flex items-start gap-3 px-3 py-2.5 rounded-lg border text-xs",
                      t.passed
                        ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900"
                        : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                    )}>
                      {t.passed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                        : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                      <div>
                        <p className="font-medium">{t.name}</p>
                        {t.error && (
                          <p className="text-muted-foreground mt-0.5 font-mono">{t.error}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
