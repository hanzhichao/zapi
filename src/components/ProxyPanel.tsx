"use client";

/**
 * ProxyPanel  —  Proxyman-style HTTP/HTTPS traffic interceptor
 *
 * Features:
 *  • Start / stop MITM proxy on configurable port (default 9090)
 *  • Real-time capture stream via Tauri event "proxy:capture"
 *  • Left sidebar: All / Pinned / by-Domain tree / by-App
 *  • Request list with method badge, host, path, status, size, time
 *  • Request detail: Info | Request (headers + body) | Response (headers + body)
 *  • CA certificate download + system-install (macOS/Windows/Linux)
 *  • Search / filter by keyword, method, status range
 *  • Pin / Delete per request
 *  • Body viewer with JSON pretty-print / binary base64 info
 */

import {
  useCallback, useEffect, useRef, useState, useMemo,
} from "react";
import {
  Play, Square, Trash2, Download, ShieldCheck, RefreshCw,
  Search, Pin, PinOff, ChevronRight, ChevronDown, Globe,
  Filter, AlertCircle, CheckCircle2, Clock, Wifi,
  Copy, FileText, Settings, X, Shield, Monitor, Layers,
  Network,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CapturedRequest {
  id: string;
  timestamp: number;
  state: "pending" | "done" | "error";
  scheme: "http" | "https";
  method: string;
  host: string;
  path: string;
  query: string;
  url: string;
  reqHeaders: [string, string][];
  reqBody: string;
  reqBodySize: number;
  resStatus: number;
  resStatusText: string;
  resHeaders: [string, string][];
  resBody: string;
  resBodySize: number;
  resContentType: string;
  durationMs: number;
  error: string;
  clientAddr: string;
  pinned: boolean;
  appName: string;
}

interface ProxyStatus {
  running: boolean;
  port: number;
  captureCount: number;
  caCertPem: string;
  caCertPath: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function methodColor(m: string) {
  const colors: Record<string, string> = {
    GET: "bg-green-500/15 text-green-700 dark:text-green-400",
    POST: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    PUT: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    PATCH: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    DELETE: "bg-red-500/15 text-red-700 dark:text-red-400",
    HEAD: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    OPTIONS: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
    CONNECT: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  };
  return colors[m.toUpperCase()] ?? "bg-gray-500/15 text-gray-600";
}

function statusColor(code: number) {
  if (!code) return "text-muted-foreground";
  if (code < 300) return "text-green-600 dark:text-green-400";
  if (code < 400) return "text-blue-600 dark:text-blue-400";
  if (code < 500) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function formatSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(ms: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function prettyBody(raw: string, contentType: string): string {
  if (!raw) return "";
  if (raw.startsWith("[binary:base64]")) {
    return `[Binary data — ${raw.length} chars base64 encoded]`;
  }
  if (contentType.includes("json") || raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { /* skip */ }
  }
  return raw;
}

function hostOnly(host: string) {
  return host.split(":")[0];
}

// ── Body Viewer ───────────────────────────────────────────────────────────────

function BodyViewer({ raw, contentType }: { raw: string; contentType: string }) {
  const [wrap, setWrap] = useState(false);
  const pretty = useMemo(() => prettyBody(raw, contentType), [raw, contentType]);
  const isBinary = raw.startsWith("[binary:base64]");

  if (!raw) return (
    <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">No body</div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-1 border-b bg-muted/10 shrink-0">
        <span className="text-[10px] text-muted-foreground flex-1 font-mono truncate">{contentType || "text/plain"}</span>
        {!isBinary && (
          <button onClick={() => setWrap(w => !w)} className="text-[10px] text-muted-foreground hover:text-foreground">
            {wrap ? "No wrap" : "Wrap"}
          </button>
        )}
        <button
          onClick={() => navigator.clipboard.writeText(pretty)}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
        >
          <Copy className="h-2.5 w-2.5" /> Copy
        </button>
      </div>
      <ScrollArea className="flex-1">
        <pre className={cn(
          "p-3 text-[11px] font-mono leading-relaxed text-foreground/80",
          !wrap && "whitespace-pre overflow-x-auto"
        )}>
          {pretty}
        </pre>
      </ScrollArea>
    </div>
  );
}

// ── Header Table ──────────────────────────────────────────────────────────────

function HeaderTable({ headers }: { headers: [string, string][] }) {
  if (!headers.length) return (
    <div className="px-3 py-4 text-xs text-muted-foreground">No headers</div>
  );
  return (
    <div className="divide-y divide-border/30">
      {headers.map(([k, v], i) => (
        <div key={i} className="flex items-baseline gap-3 px-3 py-1.5 hover:bg-muted/20">
          <span className="text-xs font-medium text-muted-foreground w-48 shrink-0 break-all">{k}</span>
          <span className="text-xs font-mono text-foreground/80 break-all min-w-0">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── Request Detail Panel ──────────────────────────────────────────────────────

function RequestDetail({
  req,
  onClose,
  onPin,
  onDelete,
}: {
  req: CapturedRequest;
  onClose: () => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [tab, setTab] = useState("overview");

  const reqCT = req.reqHeaders.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  const resCT = req.resContentType || (req.resHeaders.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "");

  const copyUrl = () => navigator.clipboard.writeText(req.url);

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0 bg-muted/10">
        <span className={cn("shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded", methodColor(req.method))}>
          {req.method}
        </span>
        <span className={cn("shrink-0 text-xs font-bold", statusColor(req.resStatus))}>
          {req.resStatus || (req.state === "pending" ? "…" : req.state === "error" ? "ERR" : "")}
        </span>
        <span className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">
          {req.host}{req.path}{req.query ? "?" + req.query : ""}
        </span>
        <button onClick={copyUrl} className="text-muted-foreground hover:text-foreground h-5 w-5 flex items-center justify-center shrink-0" title="Copy URL">
          <Copy className="h-3 w-3" />
        </button>
        <button onClick={() => onPin(req.id, !req.pinned)} className="text-muted-foreground hover:text-foreground h-5 w-5 flex items-center justify-center shrink-0">
          {req.pinned ? <PinOff className="h-3 w-3 text-amber-500" /> : <Pin className="h-3 w-3" />}
        </button>
        <button onClick={() => onDelete(req.id)} className="text-muted-foreground hover:text-destructive h-5 w-5 flex items-center justify-center shrink-0">
          <Trash2 className="h-3 w-3" />
        </button>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground h-5 w-5 flex items-center justify-center shrink-0">
          <X className="h-3 w-3" />
        </button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 border-b bg-muted/10 shrink-0">
          <TabsList className="h-8 bg-transparent p-0 gap-0">
            {[
              { v: "overview", l: "Overview" },
              { v: "request", l: "Request" },
              { v: "response", l: "Response" },
            ].map(({ v, l }) => (
              <TabsTrigger key={v} value={v}
                className="h-8 px-3 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-muted-foreground data-[state=active]:text-foreground">
                {l}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          {/* ── Overview Tab ── */}
          <TabsContent value="overview" className="mt-0 p-4 space-y-3">
            <Row label="URL" value={req.url} mono />
            <Row label="Status" value={req.resStatus ? `${req.resStatus} ${req.resStatusText}` : req.error || req.state} />
            <Row label="Method" value={req.method} />
            <Row label="Host" value={req.host} mono />
            <Row label="Path" value={req.path + (req.query ? "?" + req.query : "")} mono />
            <Row label="Scheme" value={req.scheme.toUpperCase()} />
            <Row label="Duration" value={formatDuration(req.durationMs)} />
            <Row label="Req Size" value={formatSize(req.reqBodySize)} />
            <Row label="Res Size" value={formatSize(req.resBodySize)} />
            <Row label="Client" value={req.clientAddr} mono />
            <Row label="Time" value={new Date(req.timestamp).toLocaleTimeString()} />
            {req.appName && <Row label="App" value={req.appName} />}
            {req.error && (
              <div className="p-2 rounded bg-red-500/10 text-xs text-red-600 dark:text-red-400 font-mono">
                {req.error}
              </div>
            )}
          </TabsContent>

          {/* ── Request Tab ── */}
          <TabsContent value="request" className="mt-0 h-full flex flex-col">
            <div className="px-3 py-1.5 border-b text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/10 shrink-0">
              Headers
            </div>
            <HeaderTable headers={req.reqHeaders} />
            {req.reqBody && (
              <>
                <div className="px-3 py-1.5 border-b border-t text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/10 shrink-0">
                  Body — {formatSize(req.reqBodySize)}
                </div>
                <BodyViewer raw={req.reqBody} contentType={reqCT} />
              </>
            )}
          </TabsContent>

          {/* ── Response Tab ── */}
          <TabsContent value="response" className="mt-0 h-full flex flex-col">
            {req.state === "pending" ? (
              <div className="flex items-center justify-center h-24 gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 animate-pulse" /> Waiting for response…
              </div>
            ) : req.state === "error" ? (
              <div className="p-4 text-xs text-red-500">{req.error || "Request failed"}</div>
            ) : (
              <>
                <div className="px-3 py-1.5 border-b text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/10 shrink-0">
                  Headers
                </div>
                <HeaderTable headers={req.resHeaders} />
                {req.resBody && (
                  <>
                    <div className="px-3 py-1.5 border-b border-t text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/10 shrink-0">
                      Body — {formatSize(req.resBodySize)}
                    </div>
                    <BodyViewer raw={req.resBody} contentType={resCT} />
                  </>
                )}
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">{label}</span>
      <span className={cn("text-xs break-all", mono && "font-mono")}>{value || "—"}</span>
    </div>
  );
}

// ── CA Certificate Dialog ─────────────────────────────────────────────────────

function CaCertDialog({ certPem, certPath, onClose }: {
  certPem: string;
  certPath: string;
  onClose: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState("");
  const [installOk, setInstallOk] = useState(false);

  const download = () => {
    const blob = new Blob([certPem], { type: "application/x-pem-file" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "zapi-proxy-ca.crt";
    a.click(); URL.revokeObjectURL(url);
  };

  const install = async () => {
    setInstalling(true); setInstallMsg(""); setInstallOk(false);
    try {
      await invoke("proxy_install_ca_cert");
      setInstallMsg("✓ Certificate installed. Set Trust to 'Always Trust' if prompted, then restart your browser.");
      setInstallOk(true);
    } catch (e) {
      const msg = String(e);
      // Tier-3 fallback: opened in Finder — give clear next steps
      if (msg.includes("opened in Finder") || msg.includes("double-click")) {
        setInstallMsg(msg);
        setInstallOk(false);
      } else if (msg.includes("cancelled") || msg.includes("cancel")) {
        setInstallMsg("Trust dialog was cancelled. Click Install & Trust again to retry.");
      } else {
        setInstallMsg(msg);
      }
    } finally { setInstalling(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">CA Certificate</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-auto">
          <p className="text-sm text-muted-foreground">
            To intercept HTTPS traffic, install the zapi Proxy CA certificate in your system keychain and trust it.
          </p>

          <div className="space-y-2">
            <p className="text-xs font-semibold">Step 1 — Install the certificate</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={download}>
                <Download className="h-3.5 w-3.5" /> Download .crt
              </Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={install} disabled={installing}>
                <ShieldCheck className="h-3.5 w-3.5" />
                {installing ? "Installing…" : "Install & Trust (Auto)"}
              </Button>
            </div>
            {installMsg && (
              <div className={cn(
                "text-xs rounded p-2 leading-relaxed",
                installOk ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
              )}>
                {installMsg}
              </div>
            )}
            {!installMsg && (
              <p className="text-[10px] text-muted-foreground">
                macOS: adds to your Login keychain — you will see a native password prompt.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold">Step 2 — Set your system proxy</p>
            <div className="bg-muted/30 rounded p-3 text-xs font-mono space-y-1">
              <p>HTTP Proxy:  127.0.0.1 : <span className="text-primary">9090</span></p>
              <p>HTTPS Proxy: 127.0.0.1 : <span className="text-primary">9090</span></p>
            </div>
            <p className="text-[10px] text-muted-foreground">
              macOS: System Settings → Network → Proxies
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold">Certificate location</p>
            <p className="text-xs font-mono text-muted-foreground break-all">{certPath || "Not generated yet"}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold">Certificate PEM</p>
            <ScrollArea className="h-24">
              <pre className="text-[10px] font-mono bg-muted/30 p-2 rounded text-muted-foreground">{certPem}</pre>
            </ScrollArea>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-700 dark:text-amber-400 space-y-1">
            <p className="font-semibold">⚠ Security Notice</p>
            <p>This CA certificate is unique to your machine. Never share it. Any traffic through this proxy can be read in plaintext.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar Tree ──────────────────────────────────────────────────────────────

type SidebarFilter =
  | { type: "all" }
  | { type: "pinned" }
  | { type: "domain"; host: string }
  | { type: "app"; name: string };

function SidebarDomainTree({
  captures,
  filter,
  onSelect,
}: {
  captures: CapturedRequest[];
  filter: SidebarFilter;
  onSelect: (f: SidebarFilter) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Group by hostname
  const byDomain = useMemo(() => {
    const map = new Map<string, CapturedRequest[]>();
    for (const c of captures) {
      const h = hostOnly(c.host);
      const list = map.get(h) ?? [];
      list.push(c);
      map.set(h, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [captures]);

  const byApp = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of captures) {
      if (c.appName) map.set(c.appName, (map.get(c.appName) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [captures]);

  const pinned = captures.filter(c => c.pinned).length;

  const navItem = (f: SidebarFilter, icon: React.ReactNode, label: string, count: number) => {
    const active = JSON.stringify(filter) === JSON.stringify(f);
    return (
      <button
        key={label}
        onClick={() => onSelect(f)}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors",
          active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
        )}
      >
        {icon}
        <span className="flex-1 text-left truncate">{label}</span>
        <span className="text-[10px] tabular-nums opacity-60">{count}</span>
      </button>
    );
  };

  return (
    <div className="px-2 py-2 space-y-3">
      {/* Fixed entries */}
      <div className="space-y-0.5">
        {navItem({ type: "all" }, <Network className="h-3 w-3" />, "All Requests", captures.length)}
        {navItem({ type: "pinned" }, <Pin className="h-3 w-3 text-amber-500" />, "Pinned", pinned)}
      </div>

      {/* Domains */}
      {byDomain.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 px-2 mb-1">Domains</p>
          <div className="space-y-0.5">
            {byDomain.map(([host, reqs]) => {
              const active = filter.type === "domain" && filter.host === host;
              return (
                <button
                  key={host}
                  onClick={() => onSelect({ type: "domain", host })}
                  className={cn(
                    "w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors",
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="flex-1 text-left truncate font-mono">{host}</span>
                  <span className="text-[10px] tabular-nums opacity-60">{reqs.length}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Apps */}
      {byApp.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 px-2 mb-1">Applications</p>
          <div className="space-y-0.5">
            {byApp.map(([name, count]) =>
              navItem({ type: "app", name }, <Monitor className="h-3 w-3" />, name, count)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Request List Row ──────────────────────────────────────────────────────────

function RequestRow({
  req,
  active,
  onClick,
}: {
  req: CapturedRequest;
  active: boolean;
  onClick: () => void;
}) {
  const stateIcon = req.state === "pending" ? (
    <Clock className="h-3 w-3 text-muted-foreground animate-pulse shrink-0" />
  ) : req.state === "error" ? (
    <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
  ) : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border/20 hover:bg-muted/30 select-none text-xs group",
        active && "bg-accent/50"
      )}
    >
      {/* Scheme badge */}
      <span className={cn(
        "shrink-0 text-[9px] font-bold w-5 text-center",
        req.scheme === "https" ? "text-green-500" : "text-blue-400"
      )}>
        {req.scheme === "https" ? "🔒" : "🔓"}
      </span>

      {/* Method */}
      <span className={cn("shrink-0 text-[9px] font-bold px-1 py-0.5 rounded", methodColor(req.method))}>
        {req.method}
      </span>

      {/* Host */}
      <span className="font-mono text-muted-foreground shrink-0 w-36 truncate" title={req.host}>
        {hostOnly(req.host)}
      </span>

      {/* Path */}
      <span className="font-mono flex-1 truncate text-foreground/80" title={req.path + (req.query ? "?" + req.query : "")}>
        {req.path}{req.query ? <span className="text-muted-foreground">?{req.query}</span> : null}
      </span>

      {/* Status */}
      <span className={cn("shrink-0 w-10 text-right tabular-nums font-medium", statusColor(req.resStatus))}>
        {req.resStatus || stateIcon}
      </span>

      {/* Size */}
      <span className="shrink-0 w-16 text-right text-muted-foreground tabular-nums">
        {formatSize(req.resBodySize)}
      </span>

      {/* Duration */}
      <span className="shrink-0 w-14 text-right text-muted-foreground tabular-nums">
        {formatDuration(req.durationMs)}
      </span>

      {/* Pin indicator */}
      {req.pinned && <Pin className="h-2.5 w-2.5 text-amber-500 shrink-0" />}
    </div>
  );
}

// ── Main Toolbar ──────────────────────────────────────────────────────────────

function ProxyToolbar({
  status,
  port,
  onPortChange,
  onStart,
  onStop,
  onClear,
  onCaCert,
  search,
  onSearch,
  methodFilter,
  onMethodFilter,
  statusFilter,
  onStatusFilter,
  isStarting,
  startError,
}: {
  status: ProxyStatus | null;
  port: number;
  onPortChange: (p: number) => void;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onCaCert: () => void;
  search: string;
  onSearch: (v: string) => void;
  methodFilter: string;
  onMethodFilter: (v: string) => void;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  isStarting: boolean;
  startError: string | null;
}) {
  const running = status?.running ?? false;

  return (
    <div className="flex flex-col border-b bg-background shrink-0">
    <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
      {/* Start / Stop */}
      {running ? (
        <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs shrink-0" onClick={onStop}>
          <Square className="h-3 w-3 fill-current" /> Stop
        </Button>
      ) : (
        <Button size="sm" className="h-7 gap-1.5 text-xs shrink-0" onClick={onStart} disabled={isStarting}>
          {isStarting
            ? <><RefreshCw className="h-3 w-3 animate-spin" /> Starting…</>
            : <><Play className="h-3 w-3 fill-current" /> Start</>}
        </Button>
      )}

      {/* Status dot */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn(
          "inline-block h-2 w-2 rounded-full",
          running ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"
        )} />
        <span className="text-xs text-muted-foreground">
          {running ? `Listening :${status?.port}` : "Stopped"}
        </span>
      </div>

      {/* Port */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs text-muted-foreground">Port</span>
        <Input
          type="number"
          value={port}
          onChange={e => onPortChange(parseInt(e.target.value) || 9090)}
          className="h-7 w-16 text-xs"
          disabled={running}
        />
      </div>

      {/* Search */}
      <div className="relative flex-1 min-w-32">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search URL, headers…"
          className="h-7 pl-7 text-xs"
        />
        {search && (
          <button onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Method filter */}
      <Select value={methodFilter} onValueChange={onMethodFilter}>
        <SelectTrigger className="h-7 w-24 text-xs shrink-0">
          <SelectValue placeholder="Method" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Methods</SelectItem>
          {["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"].map(m => (
            <SelectItem key={m} value={m} className={cn("text-xs font-bold", methodColor(m))}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status filter */}
      <Select value={statusFilter} onValueChange={onStatusFilter}>
        <SelectTrigger className="h-7 w-24 text-xs shrink-0">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Status</SelectItem>
          <SelectItem value="2xx" className="text-xs text-green-600">2xx OK</SelectItem>
          <SelectItem value="3xx" className="text-xs text-blue-600">3xx Redirect</SelectItem>
          <SelectItem value="4xx" className="text-xs text-yellow-600">4xx Client Err</SelectItem>
          <SelectItem value="5xx" className="text-xs text-red-600">5xx Server Err</SelectItem>
          <SelectItem value="err" className="text-xs text-red-600">Error</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear */}
      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs shrink-0" onClick={onClear}>
        <Trash2 className="h-3 w-3" /> Clear
      </Button>

      {/* CA Cert */}
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0" onClick={onCaCert}>
        <Shield className="h-3 w-3" /> CA Cert
      </Button>
    </div>

    {/* Inline error banner */}
    {startError && (
      <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span className="flex-1">{startError}</span>
        <button onClick={() => {/* clear handled by parent */}} className="shrink-0 hover:opacity-70" />
      </div>
    )}
    </div>
  );
}

// ── Column Header ─────────────────────────────────────────────────────────────

function ListHeader() {
  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b bg-muted/20 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide select-none shrink-0">
      <span className="w-5 shrink-0" />
      <span className="w-[4.5rem] shrink-0">Method</span>
      <span className="w-36 shrink-0">Host</span>
      <span className="flex-1">Path</span>
      <span className="w-10 text-right shrink-0">Status</span>
      <span className="w-16 text-right shrink-0">Size</span>
      <span className="w-14 text-right shrink-0">Time</span>
      <span className="w-3.5 shrink-0" />
    </div>
  );
}

// ── Stats Bar ─────────────────────────────────────────────────────────────────

function StatsBar({ captures }: { captures: CapturedRequest[] }) {
  const done  = captures.filter(c => c.state === "done");
  const errs  = captures.filter(c => c.state === "error" || (c.resStatus >= 400));
  const https = captures.filter(c => c.scheme === "https").length;
  const avgMs = done.length ? Math.round(done.reduce((s, c) => s + c.durationMs, 0) / done.length) : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-1 border-t bg-muted/10 text-[10px] text-muted-foreground shrink-0 select-none">
      <span><b className="text-foreground">{captures.length}</b> requests</span>
      <span><b className="text-green-500">{https}</b> HTTPS</span>
      <span><b className="text-red-500">{errs.length}</b> errors</span>
      <span>Avg <b className="text-foreground">{avgMs}ms</b></span>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function ProxyPanel() {
  const [status, setStatus]       = useState<ProxyStatus | null>(null);
  const [captures, setCaptures]   = useState<CapturedRequest[]>([]);
  const [selected, setSelected]   = useState<string | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>({ type: "all" });
  const [port, setPort]           = useState(9090);
  const [search, setSearch]       = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCaCert, setShowCaCert] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // ── Fetch initial status ──────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<ProxyStatus>("proxy_status");
      setStatus(s);
      if (s.port) setPort(s.port);
    } catch { /* tauri not available in browser dev */ }
  }, []);

  const loadCaptures = useCallback(async () => {
    try {
      const caps = await invoke<CapturedRequest[]>("proxy_get_captures");
      setCaptures(caps);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void loadCaptures();
  }, [refreshStatus, loadCaptures]);

  // ── Real-time capture events ──────────────────────────────────────────────

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<CapturedRequest>("proxy:capture", (event) => {
      const cap = event.payload;
      setCaptures(prev => {
        const idx = prev.findIndex(c => c.id === cap.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = cap;
          return next;
        }
        return [...prev, cap];
      });
      // Auto-scroll
      if (autoScrollRef.current && listRef.current) {
        setTimeout(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        }, 50);
      }
    }).then(fn => { unlisten = fn; }).catch(() => {});

    listen("proxy:status", () => { void refreshStatus(); }).catch(() => {});

    return () => { unlisten?.(); };
  }, [refreshStatus]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const start = async () => {
    setIsStarting(true);
    setStartError(null);
    try {
      await invoke("proxy_start", { port });
      await refreshStatus();
    } catch (e) {
      const msg = String(e);
      setStartError(msg);
      console.error("[proxy] start failed:", msg);
    } finally {
      setIsStarting(false);
    }
  };

  const stop = async () => {
    setStartError(null);
    try {
      await invoke("proxy_stop");
      await refreshStatus();
    } catch { /* ignore */ }
  };

  const clear = async () => {
    setCaptures([]);
    setSelected(null);
    try { await invoke("proxy_clear_captures"); } catch { /* ignore */ }
  };

  const pin = async (id: string, pinned: boolean) => {
    setCaptures(prev => prev.map(c => c.id === id ? { ...c, pinned } : c));
    try { await invoke("proxy_pin_request", { id, pinned }); } catch { /* ignore */ }
  };

  const del = async (id: string) => {
    setCaptures(prev => prev.filter(c => c.id !== id));
    if (selected === id) setSelected(null);
    try { await invoke("proxy_delete_capture", { id }); } catch { /* ignore */ }
  };

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = captures;

    // Sidebar filter
    if (sidebarFilter.type === "pinned") {
      list = list.filter(c => c.pinned);
    } else if (sidebarFilter.type === "domain") {
      list = list.filter(c => hostOnly(c.host) === sidebarFilter.host);
    } else if (sidebarFilter.type === "app") {
      list = list.filter(c => c.appName === sidebarFilter.name);
    }

    // Method filter
    if (methodFilter !== "all") {
      list = list.filter(c => c.method === methodFilter);
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "err") {
        list = list.filter(c => c.state === "error");
      } else {
        const min = parseInt(statusFilter[0]) * 100;
        const max = min + 99;
        list = list.filter(c => c.resStatus >= min && c.resStatus <= max);
      }
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.url.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.path.toLowerCase().includes(q) ||
        String(c.resStatus).includes(q) ||
        c.method.toLowerCase().includes(q) ||
        c.reqBody.toLowerCase().includes(q) ||
        c.resBody.toLowerCase().includes(q)
      );
    }

    return list;
  }, [captures, sidebarFilter, methodFilter, statusFilter, search]);

  const selectedReq = filtered.find(c => c.id === selected) ?? captures.find(c => c.id === selected);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <ProxyToolbar
        status={status}
        port={port}
        onPortChange={setPort}
        onStart={start}
        onStop={stop}
        onClear={clear}
        onCaCert={() => setShowCaCert(true)}
        search={search}
        onSearch={setSearch}
        methodFilter={methodFilter}
        onMethodFilter={setMethodFilter}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        isStarting={isStarting}
        startError={startError}
      />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left sidebar */}
        {sidebarOpen && (
          <div className="w-48 shrink-0 border-r bg-background flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Filter</span>
              <button onClick={() => setSidebarOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <SidebarDomainTree
                captures={captures}
                filter={sidebarFilter}
                onSelect={setSidebarFilter}
              />
            </ScrollArea>
          </div>
        )}

        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-6 shrink-0 border-r flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
            title="Show sidebar"
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Center: request list */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <ListHeader />

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              {captures.length === 0 ? (
                <>
                  <Network className="h-10 w-10 opacity-20" />
                  <p className="text-sm font-medium">No traffic captured</p>
                  <p className="text-xs max-w-56 text-center">
                    {status?.running
                      ? <>Set <span className="font-mono">HTTP/HTTPS Proxy: 127.0.0.1:{port}</span> in your system settings, then browse the web.</>
                      : "Click Start to begin capturing traffic."}
                  </p>
                  {!status?.running && (
                    <Button size="sm" className="gap-1.5 text-xs mt-1" onClick={start} disabled={isStarting}>
                      {isStarting
                        ? <><RefreshCw className="h-3 w-3 animate-spin" /> Starting…</>
                        : <><Play className="h-3 w-3 fill-current" /> Start Proxy</>}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Filter className="h-8 w-8 opacity-20" />
                  <p className="text-sm">No requests match filter</p>
                </>
              )}
            </div>
          ) : (
            <div
              ref={listRef}
              className="flex-1 overflow-auto"
              onScroll={e => {
                const el = e.currentTarget;
                autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {filtered.map(req => (
                <RequestRow
                  key={req.id}
                  req={req}
                  active={req.id === selected}
                  onClick={() => setSelected(req.id)}
                />
              ))}
            </div>
          )}

          <StatsBar captures={filtered} />
        </div>

        {/* Right: detail panel */}
        {selectedReq && (
          <div className="w-[420px] shrink-0 overflow-hidden flex flex-col">
            <RequestDetail
              req={selectedReq}
              onClose={() => setSelected(null)}
              onPin={pin}
              onDelete={del}
            />
          </div>
        )}
      </div>

      {/* CA Cert dialog */}
      {showCaCert && (
        <CaCertDialog
          certPem={status?.caCertPem ?? ""}
          certPath={status?.caCertPath ?? ""}
          onClose={() => setShowCaCert(false)}
        />
      )}
    </div>
  );
}
