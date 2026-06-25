"use client";

import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppStore } from "@/lib/store";
import type { AssertionOperator, AssertionSource, VisualAssertion } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Config ─────────────────────────────────────────────────────────────────────

const SOURCE_OPTIONS: { value: AssertionSource; label: string }[] = [
  { value: "status",       label: "Status Code" },
  { value: "responseTime", label: "Response Time (ms)" },
  { value: "bodySize",     label: "Body Size (bytes)" },
  { value: "header",       label: "Header" },
  { value: "body",         label: "Body / JSON Path" },
];

const OPERATOR_OPTIONS: { value: AssertionOperator; label: string; noValue?: boolean }[] = [
  { value: "eq",           label: "equals" },
  { value: "ne",           label: "not equals" },
  { value: "gt",           label: "greater than" },
  { value: "lt",           label: "less than" },
  { value: "gte",          label: "≥ greater or equal" },
  { value: "lte",          label: "≤ less or equal" },
  { value: "contains",     label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "starts_with",  label: "starts with" },
  { value: "ends_with",    label: "ends with" },
  { value: "exists",       label: "exists", noValue: true },
  { value: "not_exists",   label: "not exists", noValue: true },
  { value: "matches",      label: "matches regex" },
];

const SOURCE_OPERATORS: Record<AssertionSource, AssertionOperator[]> = {
  status:       ["eq", "ne", "gt", "lt", "gte", "lte"],
  responseTime: ["lt", "lte", "gt", "gte", "eq"],
  bodySize:     ["lt", "lte", "gt", "gte", "eq"],
  header:       ["eq", "ne", "contains", "not_contains", "exists", "not_exists", "matches"],
  body:         ["eq", "ne", "contains", "not_contains", "starts_with", "ends_with", "exists", "not_exists", "matches"],
};

const SOURCE_DEFAULTS: Record<AssertionSource, Partial<VisualAssertion>> = {
  status:       { operator: "eq",   value: "200" },
  responseTime: { operator: "lt",   value: "2000" },
  bodySize:     { operator: "lt",   value: "1000000" },
  header:       { operator: "eq",   value: "" },
  body:         { operator: "exists", value: "" },
};

function newAssertion(source: AssertionSource = "status"): VisualAssertion {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    source,
    ...SOURCE_DEFAULTS[source],
    operator: SOURCE_DEFAULTS[source].operator ?? "eq",
    value: SOURCE_DEFAULTS[source].value ?? "",
  };
}

// ── Row component ─────────────────────────────────────────────────────────────

function AssertionRow({
  assertion,
  onChange,
  onDelete,
}: {
  assertion: VisualAssertion;
  onChange: (updated: VisualAssertion) => void;
  onDelete: () => void;
}) {
  const allowedOps = SOURCE_OPERATORS[assertion.source];
  const opInfo = OPERATOR_OPTIONS.find((o) => o.value === assertion.operator);
  const needsField = assertion.source === "header" || assertion.source === "body";
  const noValue = opInfo?.noValue ?? false;

  const update = (patch: Partial<VisualAssertion>) => onChange({ ...assertion, ...patch });

  const handleSourceChange = (src: AssertionSource) => {
    const defaults = SOURCE_DEFAULTS[src];
    const newOps = SOURCE_OPERATORS[src];
    onChange({
      ...assertion,
      source: src,
      field: src === "header" || src === "body" ? assertion.field ?? "" : undefined,
      operator: newOps.includes(assertion.operator) ? assertion.operator : (defaults.operator ?? newOps[0]),
      value: defaults.value ?? assertion.value,
    });
  };

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs group",
      !assertion.enabled && "opacity-50"
    )}>
      {/* Enable toggle */}
      <button
        onClick={() => update({ enabled: !assertion.enabled })}
        className={cn(
          "h-3.5 w-3.5 rounded-sm border flex-shrink-0 flex items-center justify-center",
          assertion.enabled ? "bg-primary border-primary" : "border-muted-foreground"
        )}
      >
        {assertion.enabled && <span className="text-primary-foreground text-[9px] font-bold">✓</span>}
      </button>

      {/* Source */}
      <Select value={assertion.source} onValueChange={(v) => handleSourceChange(v as AssertionSource)}>
        <SelectTrigger className="h-6 text-[11px] w-28 shrink-0 gap-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SOURCE_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value} className="text-[11px]">{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Field (for header/body) */}
      {needsField && (
        <Input
          value={assertion.field ?? ""}
          onChange={(e) => update({ field: e.target.value })}
          placeholder={assertion.source === "header" ? "header-name" : "$.path.to.field"}
          className="h-6 text-[11px] font-mono w-32 shrink-0"
        />
      )}

      {/* Operator */}
      <Select value={assertion.operator} onValueChange={(v) => update({ operator: v as AssertionOperator })}>
        <SelectTrigger className="h-6 text-[11px] w-28 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATOR_OPTIONS.filter((o) => allowedOps.includes(o.value)).map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-[11px]">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value */}
      {!noValue && (
        <Input
          value={assertion.value}
          onChange={(e) => update({ value: e.target.value })}
          placeholder="expected value"
          className="h-6 text-[11px] flex-1 min-w-0"
        />
      )}

      {/* Custom name */}
      <Input
        value={assertion.name ?? ""}
        onChange={(e) => update({ name: e.target.value || undefined })}
        placeholder="label (optional)"
        className="h-6 text-[11px] w-28 shrink-0 text-muted-foreground"
      />

      {/* Delete */}
      <Button
        variant="ghost" size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0 text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ── Quick assertion presets ────────────────────────────────────────────────────

const PRESETS: { label: string; assertion: Omit<VisualAssertion, "id"> }[] = [
  { label: "Status 200", assertion: { enabled: true, source: "status", operator: "eq", value: "200" } },
  { label: "Status 2xx", assertion: { enabled: true, source: "status", operator: "gte", value: "200", name: "Status 2xx" } },
  { label: "Fast < 1s",  assertion: { enabled: true, source: "responseTime", operator: "lt", value: "1000", name: "Response time < 1s" } },
  { label: "Has body",   assertion: { enabled: true, source: "body", operator: "exists", value: "" } },
  { label: "JSON ok",    assertion: { enabled: true, source: "header", field: "content-type", operator: "contains", value: "json" } },
];

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  requestId: string;
}

export function VisualTestBuilder({ requestId }: Props) {
  const { requests, updateRequest } = useAppStore();
  const request = requests.find((r) => r.id === requestId);
  const [showPresets, setShowPresets] = useState(false);

  if (!request) return null;

  const assertions: VisualAssertion[] = request.visualAssertions ?? [];

  const save = (updated: VisualAssertion[]) => {
    updateRequest(requestId, { visualAssertions: updated });
  };

  const addAssertion = () => save([...assertions, newAssertion()]);

  const addPreset = (preset: Omit<VisualAssertion, "id">) => {
    save([...assertions, { ...preset, id: crypto.randomUUID() }]);
    setShowPresets(false);
  };

  const updateRow = (id: string, updated: VisualAssertion) => {
    save(assertions.map((a) => (a.id === id ? updated : a)));
  };

  const deleteRow = (id: string) => {
    save(assertions.filter((a) => a.id !== id));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-xs text-muted-foreground flex-1">
          {assertions.length === 0
            ? "No assertions — add one to visually validate responses"
            : `${assertions.filter((a) => a.enabled).length} / ${assertions.length} active`}
        </span>

        {/* Quick presets dropdown */}
        <div className="relative">
          <Button
            variant="outline" size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowPresets((v) => !v)}
          >
            <Sparkles className="h-3 w-3" />
            Presets
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showPresets && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-lg w-40 py-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => addPreset(p.assertion)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addAssertion}>
          <Plus className="h-3 w-3" /> Add Assertion
        </Button>
      </div>

      {/* Assertion list */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {assertions.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <p className="text-sm">No assertions yet</p>
            <p className="text-xs mt-1">Add assertions to visually verify response conditions without writing code.</p>
            <div className="flex flex-wrap gap-1.5 justify-center mt-4">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => addPreset(p.assertion)}
                  className="text-xs px-2.5 py-1 rounded-full border hover:bg-accent transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          assertions.map((a) => (
            <AssertionRow
              key={a.id}
              assertion={a}
              onChange={(updated) => updateRow(a.id, updated)}
              onDelete={() => deleteRow(a.id)}
            />
          ))
        )}
      </div>

      {assertions.length > 0 && (
        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
          Assertions run automatically after each request. Results appear in the Response → Tests tab.
        </div>
      )}
    </div>
  );
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .963L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  );
}
