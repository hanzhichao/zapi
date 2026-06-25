"use client";

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus, Play, Square, Pencil, Trash2, Copy, Server, RefreshCw,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import type { MockEndpoint, KeyValue } from "@/lib/types";
import { cn } from "@/lib/utils";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "*"];

const METHOD_COLORS: Record<string, string> = {
  GET: "text-green-600 dark:text-green-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-yellow-600 dark:text-yellow-400",
  PATCH: "text-orange-600 dark:text-orange-400",
  DELETE: "text-red-600 dark:text-red-400",
  "*": "text-muted-foreground",
};

const CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "text/html",
  "application/xml",
  "text/xml",
  "application/javascript",
];

const STATUS_CODES = [200, 201, 204, 400, 401, 403, 404, 409, 422, 500, 502, 503];

function statusLabel(code: number) {
  const map: Record<number, string> = {
    200: "OK", 201: "Created", 204: "No Content",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
    404: "Not Found", 409: "Conflict", 422: "Unprocessable",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Unavailable",
  };
  return map[code] ? `${code} ${map[code]}` : String(code);
}

const EMPTY_ENDPOINT: Omit<MockEndpoint, "id"> = {
  name: "",
  method: "GET",
  path: "/api/example",
  statusCode: 200,
  responseHeaders: [],
  responseBody: '{\n  "message": "Hello from Mock!"\n}',
  contentType: "application/json",
  delay: 0,
  enabled: true,
};

type MsgState = { type: "error" | "success"; text: string } | null;

export function MockPanel() {
  const {
    mockEndpoints, mockServerPort, mockServerRunning,
    addMockEndpoint, updateMockEndpoint, deleteMockEndpoint,
    setMockServerPort, setMockServerRunning,
  } = useAppStore();

  const [msg, setMsg] = useState<MsgState>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<MockEndpoint, "id">>(EMPTY_ENDPOINT);

  const flash = (text: string, type: "error" | "success" = "success") => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const syncEndpointsToRust = async (endpoints: MockEndpoint[]) => {
    try {
      await invoke("mock_update_endpoints", {
        endpoints: endpoints.map((e) => ({
          id: e.id,
          name: e.name,
          method: e.method,
          path: e.path,
          statusCode: e.statusCode,
          responseHeaders: e.responseHeaders.map((h) => [h.key, h.value] as [string, string]),
          responseBody: e.responseBody,
          contentType: e.contentType,
          delay: e.delay,
          enabled: e.enabled,
        })),
      });
    } catch (_) { /* best-effort */ }
  };

  const startServer = async () => {
    try {
      await invoke("mock_server_start", { port: mockServerPort });
      await syncEndpointsToRust(mockEndpoints);
      setMockServerRunning(true);
      flash(`Mock server running on port ${mockServerPort}`);
    } catch (e) {
      flash(String(e), "error");
    }
  };

  const stopServer = async () => {
    try {
      await invoke("mock_server_stop");
      setMockServerRunning(false);
      flash("Mock server stopped");
    } catch (e) {
      flash(String(e), "error");
    }
  };

  const openNew = () => {
    setEditId(null);
    setForm(EMPTY_ENDPOINT);
    setEditOpen(true);
  };

  const openEdit = (ep: MockEndpoint) => {
    setEditId(ep.id);
    setForm({
      name: ep.name, method: ep.method, path: ep.path,
      statusCode: ep.statusCode, responseHeaders: ep.responseHeaders,
      responseBody: ep.responseBody, contentType: ep.contentType,
      delay: ep.delay, enabled: ep.enabled,
    });
    setEditOpen(true);
  };

  const saveEndpoint = async () => {
    if (!form.path.trim()) return;
    let updated: MockEndpoint[];
    if (editId) {
      updateMockEndpoint(editId, form);
      updated = mockEndpoints.map((e) => e.id === editId ? { ...e, ...form } : e);
    } else {
      const ep = addMockEndpoint(form);
      updated = [...mockEndpoints, ep];
    }
    setEditOpen(false);
    if (mockServerRunning) await syncEndpointsToRust(updated);
  };

  const deleteEp = async (id: string) => {
    deleteMockEndpoint(id);
    const updated = mockEndpoints.filter((e) => e.id !== id);
    if (mockServerRunning) await syncEndpointsToRust(updated);
  };

  const toggleEp = async (id: string, enabled: boolean) => {
    updateMockEndpoint(id, { enabled });
    const updated = mockEndpoints.map((e) => e.id === id ? { ...e, enabled } : e);
    if (mockServerRunning) await syncEndpointsToRust(updated);
  };

  const baseUrl = `http://localhost:${mockServerPort}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Server className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold flex-1">Mock Server</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={openNew} title="New endpoint">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Status message */}
      {msg && (
        <div className={cn("mx-2 mt-1.5 px-2 py-1 rounded text-xs shrink-0",
          msg.type === "error" ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-green-500/10 text-green-600 dark:text-green-400")}>
          {msg.text}
        </div>
      )}

      {/* Server control */}
      <div className="px-3 py-2 border-b bg-muted/20 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full shrink-0", mockServerRunning ? "bg-green-500" : "bg-muted-foreground/40")} />
          <span className="text-xs flex-1 font-mono">
            {mockServerRunning ? `Running — ${baseUrl}` : "Stopped"}
          </span>
          {mockServerRunning && (
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Copy URL"
              onClick={() => { void navigator.clipboard.writeText(baseUrl); flash("URL copied"); }}>
              <Copy className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground shrink-0">Port</Label>
          <Input
            type="number"
            value={mockServerPort}
            onChange={(e) => setMockServerPort(Number(e.target.value))}
            disabled={mockServerRunning}
            className="h-7 text-xs w-20 font-mono"
          />
          <Button
            size="sm"
            variant={mockServerRunning ? "destructive" : "default"}
            className="h-7 text-xs px-3 gap-1.5 flex-1"
            onClick={mockServerRunning ? stopServer : startServer}
          >
            {mockServerRunning ? <><Square className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Start</>}
          </Button>
        </div>
      </div>

      {/* Endpoint list */}
      <div className="flex-1 overflow-y-auto py-1">
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Endpoints ({mockEndpoints.length})
          </span>
        </div>

        {mockEndpoints.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center leading-relaxed">
            No endpoints yet.
            <br />
            Click <strong>+</strong> to add one.
          </div>
        )}

        {mockEndpoints.map((ep) => (
          <div key={ep.id}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 group hover:bg-accent/50 rounded-sm mx-1 transition-opacity",
              !ep.enabled && "opacity-50")}>
            <Switch
              checked={ep.enabled}
              onCheckedChange={(v) => toggleEp(ep.id, v)}
              className="scale-75"
            />
            <span className={cn("text-[10px] font-bold w-10 shrink-0 font-mono", METHOD_COLORS[ep.method] ?? "text-muted-foreground")}>
              {ep.method}
            </span>
            <span className="flex-1 text-xs truncate font-mono" title={ep.path}>{ep.path}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{ep.statusCode}</span>
            <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => openEdit(ep)} title="Edit">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive" onClick={() => deleteEp(ep.id)} title="Delete">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl flex flex-col overflow-hidden p-0 gap-0 max-h-[90vh]">
          <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
            <DialogTitle>{editId ? "Edit Endpoint" : "New Endpoint"}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-3">
            {/* Name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name <span className="opacity-50">(optional)</span></Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Get Users" className="h-8 text-sm" />
            </div>

            {/* Method + Path */}
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}>
                  <SelectTrigger className={cn("h-8 text-sm font-bold", METHOD_COLORS[form.method] ?? "")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HTTP_METHODS.map((m) => (
                      <SelectItem key={m} value={m} className={cn("font-bold", METHOD_COLORS[m] ?? "")}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Path</Label>
                <Input value={form.path} onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
                  placeholder="/api/users" className="h-8 text-sm font-mono" />
              </div>
            </div>

            {/* Status + Content-Type + Delay */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status Code</Label>
                <Select value={String(form.statusCode)} onValueChange={(v) => setForm((f) => ({ ...f, statusCode: Number(v) }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_CODES.map((c) => (
                      <SelectItem key={c} value={String(c)} className="text-xs">{statusLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Content-Type</Label>
                <Select value={form.contentType} onValueChange={(v) => setForm((f) => ({ ...f, contentType: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Delay (ms)</Label>
                <Input type="number" value={form.delay}
                  onChange={(e) => setForm((f) => ({ ...f, delay: Math.max(0, Number(e.target.value)) }))}
                  className="h-8 text-xs" min={0} />
              </div>
            </div>

            {/* Response headers */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Response Headers</Label>
              <KeyValueEditor
                items={form.responseHeaders}
                onChange={(responseHeaders: KeyValue[]) => setForm((f) => ({ ...f, responseHeaders }))}
                keyPlaceholder="Header"
              />
            </div>

            {/* Response body */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Response Body</Label>
              <Textarea value={form.responseBody}
                onChange={(e) => setForm((f) => ({ ...f, responseBody: e.target.value }))}
                placeholder={'{\n  "message": "success"\n}'}
                className="min-h-[160px] font-mono text-xs resize-none bg-muted/20" spellCheck={false} />
            </div>
          </div>

          <DialogFooter className="px-4 pb-4 shrink-0">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEndpoint} disabled={!form.path.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
