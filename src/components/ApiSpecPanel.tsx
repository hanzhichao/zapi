"use client";

/**
 * API Spec Panel  —  YApi / Apifox-style interface management.
 *
 * Features:
 *  • List of API specs per collection, with method badge + status
 *  • Create / duplicate / delete
 *  • Detail tabs: Info | Request Params | Request Headers | Response
 *  • Nested schema table editor (object/array expand with children)
 *  • Multiple response scenarios (成功 / 参数错误 / …)
 *  • Mock.js @notation support: @email, @username, @integer(1,100), etc.
 *  • "Preview Mock" button generates a sample JSON from the schema
 */

import { useState, useCallback } from "react";
import {
  Plus, Trash2, Copy, ChevronRight, ChevronDown, EyeOff,
  CheckCircle2, Clock, XCircle, FileCode, Search, MoreHorizontal,
  Sparkles, Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { generateMockResponse, MOCK_TOKENS } from "@/lib/faker";
import type { ApiParamSchema, ApiResponseScenario, ApiSpec, ApiParamType, ApiSpecStatus, HttpMethod } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const PARAM_TYPES: ApiParamType[] = ["string", "number", "integer", "boolean", "object", "array"];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "bg-green-500/15 text-green-700 dark:text-green-400",
  POST: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  PUT: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  PATCH: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  DELETE: "bg-red-500/15 text-red-700 dark:text-red-400",
  HEAD: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  OPTIONS: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

const STATUS_CONFIG: Record<ApiSpecStatus, { icon: LucideIcon; label: string; color: string }> = {
  draft:      { icon: Clock,         label: "Draft",      color: "text-yellow-500" },
  done:       { icon: CheckCircle2,  label: "Done",       color: "text-green-500" },
  deprecated: { icon: XCircle,       label: "Deprecated", color: "text-red-500" },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

function newParam(): ApiParamSchema {
  return { id: uuid(), name: "", type: "string", required: false, defaultValue: "", description: "", children: [] };
}

// Deep-update a node within a param tree by id
function updateParamInTree(
  tree: ApiParamSchema[],
  id: string,
  updater: (p: ApiParamSchema) => ApiParamSchema,
): ApiParamSchema[] {
  return tree.map((p) => {
    if (p.id === id) return updater(p);
    if (p.children.length) return { ...p, children: updateParamInTree(p.children, id, updater) };
    return p;
  });
}

function addChildInTree(tree: ApiParamSchema[], parentId: string): ApiParamSchema[] {
  return tree.map((p) => {
    if (p.id === parentId) return { ...p, children: [...p.children, newParam()] };
    if (p.children.length) return { ...p, children: addChildInTree(p.children, parentId) };
    return p;
  });
}

function deleteParamInTree(tree: ApiParamSchema[], id: string): ApiParamSchema[] {
  return tree
    .filter((p) => p.id !== id)
    .map((p) => ({ ...p, children: deleteParamInTree(p.children, id) }));
}

// ── Schema Table ──────────────────────────────────────────────────────────────

interface SchemaTableProps {
  rows: ApiParamSchema[];
  onChange: (rows: ApiParamSchema[]) => void;
  depth?: number;
}

function ParamRow({
  param,
  depth,
  expanded,
  onToggle,
  onChange,
  onAddChild,
  onDelete,
}: {
  param: ApiParamSchema;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (p: ApiParamSchema) => void;
  onAddChild: () => void;
  onDelete: () => void;
}) {
  const canHaveChildren = param.type === "object" || param.type === "array";
  const indent = depth * 20;

  return (
    <div className="flex items-start gap-1 py-1 px-2 border-b border-border/30 hover:bg-muted/20 group text-xs">
      {/* Indent + expand toggle */}
      <div className="flex items-center shrink-0 mt-1.5" style={{ paddingLeft: indent }}>
        {canHaveChildren ? (
          <button onClick={onToggle} className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
      </div>

      {/* Name */}
      <Input
        value={param.name}
        onChange={(e) => onChange({ ...param, name: e.target.value })}
        placeholder="field name"
        className="h-6 text-xs flex-[2] min-w-0 border-0 bg-transparent focus:bg-muted/50 px-1 font-mono"
      />

      {/* Type */}
      <Select value={param.type} onValueChange={(v) => onChange({ ...param, type: v as ApiParamType })}>
        <SelectTrigger className="h-6 text-xs w-20 shrink-0 border-0 bg-transparent focus:bg-muted/50 px-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PARAM_TYPES.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Required */}
      <button
        onClick={() => onChange({ ...param, required: !param.required })}
        className={cn(
          "shrink-0 w-7 text-center h-6 text-xs rounded font-medium transition-colors",
          param.required ? "text-red-500" : "text-muted-foreground hover:text-foreground"
        )}
        title="Required"
      >
        {param.required ? "✱" : "○"}
      </button>

      {/* Default / Mock value */}
      <MockValueInput
        value={param.defaultValue}
        onChange={(v) => onChange({ ...param, defaultValue: v })}
      />

      {/* Description */}
      <Input
        value={param.description}
        onChange={(e) => onChange({ ...param, description: e.target.value })}
        placeholder="description"
        className="h-6 text-xs flex-[2] min-w-0 border-0 bg-transparent focus:bg-muted/50 px-1"
      />

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {canHaveChildren && (
          <button onClick={onAddChild} className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-primary" title="Add child">
            <Plus className="h-3 w-3" />
          </button>
        )}
        <button onClick={onDelete} className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-destructive" title="Delete">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function MockValueInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const isToken = value.startsWith("@");

  return (
    <div className="relative flex-[2] min-w-0">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(e.target.value.startsWith("@")); }}
        onFocus={() => value.startsWith("@") && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="default / @mock"
        className={cn(
          "h-6 text-xs border-0 bg-transparent focus:bg-muted/50 px-1 font-mono",
          isToken && "text-violet-600 dark:text-violet-400"
        )}
      />
      {open && (
        <div className="absolute left-0 top-7 z-50 bg-popover border rounded-md shadow-lg py-1 min-w-48 max-h-52 overflow-auto">
          {MOCK_TOKENS.filter((t) => !value || t.startsWith(value)).slice(0, 20).map((token) => (
            <button
              key={token}
              onMouseDown={(e) => { e.preventDefault(); onChange(token); setOpen(false); }}
              className="w-full text-left px-2 py-1 text-xs font-mono text-violet-600 dark:text-violet-400 hover:bg-accent"
            >
              {token}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaTable({ rows, onChange, depth = 0 }: SchemaTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleChange = (id: string, updated: ApiParamSchema) =>
    onChange(updateParamInTree(rows, id, () => updated));

  const handleAddChild = (id: string) =>
    onChange(addChildInTree(rows, id));

  const handleDelete = (id: string) =>
    onChange(deleteParamInTree(rows, id));

  function renderRows(params: ApiParamSchema[], level: number): React.ReactNode {
    return params.map((param) => (
      <div key={param.id}>
        <ParamRow
          param={param}
          depth={level}
          expanded={!!expanded[param.id]}
          onToggle={() => toggleExpand(param.id)}
          onChange={(p) => handleChange(param.id, p)}
          onAddChild={() => handleAddChild(param.id)}
          onDelete={() => handleDelete(param.id)}
        />
        {expanded[param.id] && param.children.length > 0 && renderRows(param.children, level + 1)}
      </div>
    ));
  }

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/30 border-b text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        <span className="w-4 shrink-0" />
        <span className="flex-[2]">Name</span>
        <span className="w-20 shrink-0">Type</span>
        <span className="w-7 shrink-0 text-center">Req</span>
        <span className="flex-[2]">Default / Mock</span>
        <span className="flex-[2]">Description</span>
        <span className="w-10 shrink-0" />
      </div>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          No fields. Click <span className="font-medium">+ Add Field</span> to start.
        </div>
      ) : (
        <div>{renderRows(rows, depth)}</div>
      )}
    </div>
  );
}

// ── Response Scenarios ────────────────────────────────────────────────────────

function ScenarioEditor({
  scenarios,
  onChange,
  mockServerPort,
}: {
  scenarios: ApiResponseScenario[];
  onChange: (s: ApiResponseScenario[]) => void;
  mockServerPort: number;
}) {
  const [activeId, setActiveId] = useState<string>(scenarios[0]?.id ?? "");
  const [mockPreview, setMockPreview] = useState<string>("");
  const [showPreview, setShowPreview] = useState(false);

  const active = scenarios.find((s) => s.id === activeId);

  const addScenario = () => {
    const s: ApiResponseScenario = {
      id: uuid(), name: "New Scenario", statusCode: 200, description: "", schema: [],
    };
    onChange([...scenarios, s]);
    setActiveId(s.id);
  };

  const updateScenario = (id: string, data: Partial<ApiResponseScenario>) =>
    onChange(scenarios.map((s) => (s.id === id ? { ...s, ...data } : s)));

  const deleteScenario = (id: string) => {
    const next = scenarios.filter((s) => s.id !== id);
    onChange(next);
    if (id === activeId && next.length) setActiveId(next[0].id);
  };

  const previewMock = () => {
    if (!active) return;
    setMockPreview(generateMockResponse(active));
    setShowPreview(true);
  };

  return (
    <div className="flex h-full gap-0">
      {/* Scenario list */}
      <div className="w-40 shrink-0 border-r flex flex-col">
        <div className="px-2 py-1.5 border-b flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Scenarios</span>
          <button onClick={addScenario} className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-primary">
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <ScrollArea className="flex-1">
          {scenarios.map((s) => (
            <div
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-xs group border-b border-border/30",
                s.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
              )}
            >
              <span className={cn(
                "inline-flex items-center justify-center text-[9px] font-bold px-1 rounded",
                s.statusCode < 300 ? "bg-green-500/20 text-green-700 dark:text-green-400" :
                s.statusCode < 400 ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400" :
                "bg-red-500/20 text-red-700 dark:text-red-400"
              )}>
                {s.statusCode}
              </span>
              <span className="flex-1 truncate">{s.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteScenario(s.id); }}
                className="hidden group-hover:flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Scenario detail */}
      {active ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Scenario metadata */}
          <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
            <Input
              value={active.name}
              onChange={(e) => updateScenario(active.id, { name: e.target.value })}
              className="h-7 text-xs flex-1 max-w-44"
              placeholder="Scenario name"
            />
            <Select
              value={String(active.statusCode)}
              onValueChange={(v) => updateScenario(active.id, { statusCode: parseInt(v) })}
            >
              <SelectTrigger className="h-7 text-xs w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503].map((c) => (
                  <SelectItem key={c} value={String(c)} className="text-xs">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={active.description}
              onChange={(e) => updateScenario(active.id, { description: e.target.value })}
              className="h-7 text-xs flex-1"
              placeholder="Description"
            />
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0" onClick={previewMock}>
              <Sparkles className="h-3 w-3" />
              Preview Mock
            </Button>
          </div>

          {/* Schema table */}
          <div className="flex-1 overflow-auto p-3">
            <SchemaTable
              rows={active.schema}
              onChange={(schema) => updateScenario(active.id, { schema })}
            />
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 h-7 gap-1 text-xs"
              onClick={() => updateScenario(active.id, { schema: [...active.schema, newParam()] })}
            >
              <Plus className="h-3 w-3" /> Add Field
            </Button>
          </div>

          {/* Mock preview drawer */}
          {showPreview && (
            <div className="border-t bg-muted/20 shrink-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b">
                <span className="text-xs font-medium">Mock Preview</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    Mock URL: <span className="font-mono">http://localhost:{mockServerPort}{active.description ? "/" + active.description : ""}</span>
                  </span>
                  <button onClick={() => setShowPreview(false)} className="ml-2 h-4 w-4 text-muted-foreground hover:text-foreground">
                    <EyeOff className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <ScrollArea className="max-h-40">
                <pre className="p-3 text-xs font-mono text-foreground/80">{mockPreview}</pre>
              </ScrollArea>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          No scenarios. Click + to add one.
        </div>
      )}
    </div>
  );
}

// ── Spec Detail ───────────────────────────────────────────────────────────────

function SpecDetail({ spec }: { spec: ApiSpec }) {
  const { updateApiSpec, mockServerPort } = useAppStore();
  const [tab, setTab] = useState("info");

  const update = useCallback(
    (data: Partial<ApiSpec>) => updateApiSpec(spec.id, data),
    [spec.id, updateApiSpec]
  );

  const StatusIcon = STATUS_CONFIG[spec.status].icon;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-background shrink-0">
        <Select value={spec.method} onValueChange={(v) => update({ method: v as HttpMethod })}>
          <SelectTrigger className={cn("w-20 h-7 text-xs font-bold border-0 rounded", METHOD_COLORS[spec.method])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m} className={cn("text-xs font-bold", METHOD_COLORS[m])}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={spec.path}
          onChange={(e) => update({ path: e.target.value })}
          placeholder="/api/v1/resource"
          className="flex-1 h-7 text-xs font-mono border-0 bg-muted/30"
        />

        <Select value={spec.status} onValueChange={(v) => update({ status: v as ApiSpecStatus })}>
          <SelectTrigger className={cn("w-28 h-7 text-xs border-0 bg-transparent", STATUS_CONFIG[spec.status].color)}>
            <span className="flex items-center gap-1">
              <StatusIcon className="h-3 w-3" />
              {STATUS_CONFIG[spec.status].label}
            </span>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_CONFIG) as ApiSpecStatus[]).map((s) => {
              const cfg = STATUS_CONFIG[s];
              const Ic = cfg.icon;
              return (
                <SelectItem key={s} value={s} className={cn("text-xs", cfg.color)}>
                  <span className="flex items-center gap-1"><Ic className="h-3 w-3" />{cfg.label}</span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 border-b bg-muted/10 shrink-0">
          <TabsList className="h-8 bg-transparent p-0 gap-0">
            {[
              { v: "info", label: "Info" },
              { v: "params", label: "Request Params" },
              { v: "headers", label: "Request Headers" },
              { v: "response", label: "Response" },
            ].map(({ v, label }) => (
              <TabsTrigger
                key={v} value={v}
                className="h-8 px-3 text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-muted-foreground data-[state=active]:text-foreground"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Info tab */}
          <TabsContent value="info" className="p-4 mt-0 space-y-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input value={spec.name} onChange={(e) => update({ name: e.target.value })} className="h-7 text-xs" placeholder="Interface name" />

              <label className="text-xs text-muted-foreground">Description</label>
              <Textarea value={spec.description} onChange={(e) => update({ description: e.target.value })} className="text-xs min-h-14 resize-none" placeholder="Interface description" />

              <label className="text-xs text-muted-foreground">Mock URL</label>
              <div className="flex items-center gap-1">
                <Input
                  value={spec.mockUrl || `http://localhost:${mockServerPort}${spec.path}`}
                  onChange={(e) => update({ mockUrl: e.target.value })}
                  className="h-7 text-xs font-mono flex-1"
                  placeholder={`http://localhost:${mockServerPort}${spec.path}`}
                />
                <Button size="sm" variant="ghost" className="h-7 text-xs px-2 shrink-0"
                  onClick={() => update({ mockUrl: `http://localhost:${mockServerPort}${spec.path}` })}>
                  Reset
                </Button>
              </div>

              <label className="text-xs text-muted-foreground">Auth Required</label>
              <button
                onClick={() => update({ requiresAuth: !spec.requiresAuth })}
                className={cn(
                  "justify-self-start px-3 py-1 text-xs rounded-full font-medium border transition-colors",
                  spec.requiresAuth
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {spec.requiresAuth ? "🔐 Required" : "Public"}
              </button>

              <label className="text-xs text-muted-foreground">Tags</label>
              <Input
                value={spec.tags.join(", ")}
                onChange={(e) => update({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                className="h-7 text-xs"
                placeholder="tag1, tag2"
              />
            </div>
          </TabsContent>

          {/* Request Params tab */}
          <TabsContent value="params" className="p-4 mt-0">
            <SchemaTable rows={spec.requestParams} onChange={(rows) => update({ requestParams: rows })} />
            <Button
              size="sm" variant="ghost" className="mt-2 h-7 gap-1 text-xs"
              onClick={() => update({ requestParams: [...spec.requestParams, newParam()] })}
            >
              <Plus className="h-3 w-3" /> Add Field
            </Button>
            <div className="mt-3 p-2 rounded bg-muted/20 border text-[11px] text-muted-foreground">
              <span className="font-medium text-violet-500">@mock notation</span> — use <span className="font-mono text-violet-500">@email</span>, <span className="font-mono text-violet-500">@username</span>, <span className="font-mono text-violet-500">@integer(1,100)</span> in the Default/Mock column to generate mock data automatically.
            </div>
          </TabsContent>

          {/* Request Headers tab */}
          <TabsContent value="headers" className="p-4 mt-0">
            <SchemaTable rows={spec.requestHeaders} onChange={(rows) => update({ requestHeaders: rows })} />
            <Button
              size="sm" variant="ghost" className="mt-2 h-7 gap-1 text-xs"
              onClick={() => update({ requestHeaders: [...spec.requestHeaders, newParam()] })}
            >
              <Plus className="h-3 w-3" /> Add Field
            </Button>
          </TabsContent>

          {/* Response tab */}
          <TabsContent value="response" className="mt-0 h-full">
            <div className="h-[calc(100vh-300px)] min-h-48">
              <ScenarioEditor
                scenarios={spec.responseScenarios}
                onChange={(responseScenarios) => update({ responseScenarios })}
                mockServerPort={mockServerPort}
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ── Spec List Item ────────────────────────────────────────────────────────────

function SpecListItem({
  spec,
  active,
  onClick,
  onDelete,
  onDuplicate,
}: {
  spec: ApiSpec;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const StatusIcon = STATUS_CONFIG[spec.status].icon;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer group border-b border-border/30 select-none",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/40"
      )}
    >
      <span className={cn(
        "shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded",
        METHOD_COLORS[spec.method]
      )}>
        {spec.method}
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-xs truncate font-medium">{spec.name}</div>
        <div className="text-[10px] text-muted-foreground font-mono truncate">{spec.path}</div>
      </div>

      <StatusIcon className={cn("h-3 w-3 shrink-0", STATUS_CONFIG[spec.status].color)} />

      {/* More menu */}
      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          className="h-5 w-5 hidden group-hover:flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-5 z-50 bg-popover border rounded-md shadow-lg py-1 w-32"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button className="w-full text-left px-3 py-1 text-xs hover:bg-accent flex items-center gap-1.5" onClick={(e) => { e.stopPropagation(); onDuplicate(); setMenuOpen(false); }}>
              <Copy className="h-3 w-3" /> Duplicate
            </button>
            <button className="w-full text-left px-3 py-1 text-xs hover:bg-accent text-destructive flex items-center gap-1.5" onClick={(e) => { e.stopPropagation(); onDelete(); setMenuOpen(false); }}>
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function ApiSpecPanel() {
  const {
    collections, apiSpecs, activeApiSpecId, setActiveApiSpecId,
    addApiSpec, deleteApiSpec, duplicateApiSpec,
  } = useAppStore();

  const [search, setSearch] = useState("");
  const [colFilter, setColFilter] = useState<string>(collections[0]?.id ?? "");

  const filteredSpecs = apiSpecs.filter((s) => {
    if (colFilter && s.collectionId !== colFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q);
    }
    return true;
  });

  const activeSpec = apiSpecs.find((s) => s.id === activeApiSpecId);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: spec list */}
      <div className="w-56 shrink-0 border-r flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold">Interfaces</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="New Interface"
            onClick={() => addApiSpec(colFilter || collections[0]?.id || "")}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-6 pl-6 text-xs bg-muted/30 border-0"
            />
          </div>
        </div>

        {/* Collection filter */}
        {collections.length > 1 && (
          <div className="px-2 py-1 border-b shrink-0">
            <Select value={colFilter} onValueChange={setColFilter}>
              <SelectTrigger className="h-6 text-xs border-0 bg-transparent">
                <SelectValue placeholder="All collections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="" className="text-xs">All Collections</SelectItem>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* List */}
        <ScrollArea className="flex-1">
          {filteredSpecs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-3 gap-2 text-center">
              <FileCode className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No interfaces yet</p>
              <Button size="sm" variant="outline" className="h-6 text-xs gap-1"
                onClick={() => addApiSpec(colFilter || collections[0]?.id || "")}>
                <Plus className="h-3 w-3" /> New Interface
              </Button>
            </div>
          ) : (
            filteredSpecs.map((spec) => (
              <SpecListItem
                key={spec.id}
                spec={spec}
                active={spec.id === activeApiSpecId}
                onClick={() => setActiveApiSpecId(spec.id)}
                onDelete={() => deleteApiSpec(spec.id)}
                onDuplicate={() => duplicateApiSpec(spec.id)}
              />
            ))
          )}
        </ScrollArea>

        {/* Footer stats */}
        <div className="px-3 py-1.5 border-t shrink-0 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{filteredSpecs.length} interface{filteredSpecs.length !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{filteredSpecs.filter((s) => s.status === "done").length} done</span>
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-hidden">
        {activeSpec ? (
          <SpecDetail key={activeSpec.id} spec={activeSpec} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Layers className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select or create an interface</p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => addApiSpec(colFilter || collections[0]?.id || "")}
            >
              <Plus className="h-3.5 w-3.5" /> New Interface
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
