"use client";

import { useState } from "react";
import { Plus, Trash2, Play, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/store";
import { runExtractors } from "@/lib/extractor";
import type { ExtractorRule, ExtractorSource, ExtractorType } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Config ─────────────────────────────────────────────────────────────────────

const SOURCE_OPTIONS: { value: ExtractorSource; label: string }[] = [
  { value: "body",         label: "Body" },
  { value: "header",       label: "Header" },
  { value: "status",       label: "Status Code" },
  { value: "responseTime", label: "Response Time" },
];

const TYPE_OPTIONS: { value: ExtractorType; label: string; placeholder: string }[] = [
  { value: "jsonpath", label: "JSONPath",  placeholder: "$.data.token" },
  { value: "regex",    label: "Regex",     placeholder: "access_token=([^&]+)" },
  { value: "header",   label: "Header",    placeholder: "Authorization" },
  { value: "full",     label: "Full Body", placeholder: "(entire response body)" },
];

function getTypeOptions(source: ExtractorSource): ExtractorType[] {
  if (source === "header")       return ["header"];
  if (source === "status")       return ["full"];
  if (source === "responseTime") return ["full"];
  return ["jsonpath", "regex", "full"];
}

function defaultType(source: ExtractorSource): ExtractorType {
  if (source === "header")       return "header";
  if (source === "status")       return "full";
  if (source === "responseTime") return "full";
  return "jsonpath";
}

function newRule(): ExtractorRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    varName: "",
    source: "body",
    type: "jsonpath",
    expression: "",
    scope: "collection",
  };
}

// ── Rule row ───────────────────────────────────────────────────────────────────

interface TestResult { varName: string; value: string; error?: string }

function RuleRow({
  rule,
  testResult,
  onChange,
  onDelete,
}: {
  rule: ExtractorRule;
  testResult?: TestResult;
  onChange: (r: ExtractorRule) => void;
  onDelete: () => void;
}) {
  const typeOptions = getTypeOptions(rule.source);
  const typePlaceholder = TYPE_OPTIONS.find((t) => t.value === rule.type)?.placeholder ?? "";
  const showExpression = rule.type !== "full";

  const update = (patch: Partial<ExtractorRule>) => onChange({ ...rule, ...patch });

  const handleSourceChange = (src: ExtractorSource) => {
    const dt = defaultType(src);
    onChange({ ...rule, source: src, type: dt, expression: "" });
  };

  return (
    <div className={cn("border rounded-lg p-2.5 space-y-2 text-xs", !rule.enabled && "opacity-50")}>
      <div className="flex items-center gap-2">
        {/* Enable */}
        <button
          onClick={() => update({ enabled: !rule.enabled })}
          className={cn(
            "h-4 w-4 rounded-sm border flex items-center justify-center shrink-0",
            rule.enabled ? "bg-primary border-primary" : "border-muted-foreground"
          )}
        >
          {rule.enabled && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
        </button>

        {/* Variable name */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-muted-foreground shrink-0">Save to</span>
          <span className="text-muted-foreground shrink-0">{"{{" }</span>
          <Input
            value={rule.varName}
            onChange={(e) => update({ varName: e.target.value })}
            placeholder="variableName"
            className="h-6 text-[11px] font-mono flex-1 min-w-0"
          />
          <span className="text-muted-foreground shrink-0">{"}}"}</span>
        </div>

        {/* Scope */}
        <Select value={rule.scope} onValueChange={(v) => update({ scope: v as ExtractorRule["scope"] })}>
          <SelectTrigger className="h-6 text-[11px] w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="collection" className="text-[11px]">Collection var</SelectItem>
            <SelectItem value="environment" className="text-[11px]">Env var</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-destructive" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex items-center gap-2 pl-6">
        {/* Source */}
        <Select value={rule.source} onValueChange={(v) => handleSourceChange(v as ExtractorSource)}>
          <SelectTrigger className="h-6 text-[11px] w-24 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-[11px]">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Type */}
        {typeOptions.length > 1 && (
          <Select value={rule.type} onValueChange={(v) => update({ type: v as ExtractorType, expression: "" })}>
            <SelectTrigger className="h-6 text-[11px] w-24 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.filter((t) => typeOptions.includes(t.value)).map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-[11px]">{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Expression */}
        {showExpression && (
          <Input
            value={rule.expression}
            onChange={(e) => update({ expression: e.target.value })}
            placeholder={typePlaceholder}
            className="h-6 text-[11px] font-mono flex-1 min-w-0"
          />
        )}
      </div>

      {/* Test result */}
      {testResult && (
        <div className={cn(
          "pl-6 text-[11px] flex items-start gap-1.5 rounded px-2 py-1",
          testResult.error
            ? "bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400"
            : "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400"
        )}>
          {testResult.error
            ? <><AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />{testResult.error}</>
            : <><Check className="h-3 w-3 mt-0.5 shrink-0" />Extracted: <code className="font-mono">{testResult.value.slice(0, 80)}{testResult.value.length > 80 ? "…" : ""}</code></>
          }
        </div>
      )}
    </div>
  );
}

// ── Quick templates ───────────────────────────────────────────────────────────

const TEMPLATES: { label: string; rule: Omit<ExtractorRule, "id"> }[] = [
  {
    label: "JWT Token",
    rule: { enabled: true, varName: "token", source: "body", type: "jsonpath", expression: "$.token", scope: "collection" },
  },
  {
    label: "Access Token",
    rule: { enabled: true, varName: "accessToken", source: "body", type: "jsonpath", expression: "$.access_token", scope: "collection" },
  },
  {
    label: "User ID",
    rule: { enabled: true, varName: "userId", source: "body", type: "jsonpath", expression: "$.data.id", scope: "collection" },
  },
  {
    label: "Set-Cookie",
    rule: { enabled: true, varName: "sessionCookie", source: "header", type: "header", expression: "set-cookie", scope: "environment" },
  },
];

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { requestId: string }

export function ResponseExtractor({ requestId }: Props) {
  const { requests, response, updateRequest, collections, environments, activeEnvironmentId } = useAppStore();
  const request = requests.find((r) => r.id === requestId);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  if (!request) return null;

  const rules: ExtractorRule[] = request.extractors ?? [];

  const save = (updated: ExtractorRule[]) => updateRequest(requestId, { extractors: updated });

  const addRule = () => save([...rules, newRule()]);

  const addTemplate = (t: Omit<ExtractorRule, "id">) => {
    save([...rules, { ...t, id: crypto.randomUUID() }]);
    setShowTemplates(false);
  };

  const runTest = () => {
    if (!response) return;
    const results = runExtractors(rules, response);
    setTestResults(results);
  };

  const collection = collections.find((c) => c.id === request.collectionId);
  const colVars = collection?.variables ?? [];
  const env = environments.find((e) => e.id === activeEnvironmentId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-xs text-muted-foreground flex-1">
          {rules.length === 0
            ? "Extract variables from responses to chain requests"
            : `${rules.filter((r) => r.enabled).length} active extractor${rules.length !== 1 ? "s" : ""}`}
        </span>

        <div className="relative">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowTemplates((v) => !v)}>
            Templates ▾
          </Button>
          {showTemplates && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-lg w-44 py-1">
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => addTemplate(t.rule)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addRule}>
          <Plus className="h-3 w-3" /> Add
        </Button>

        {response && rules.length > 0 && (
          <Button size="sm" className="h-7 text-xs gap-1" onClick={runTest}>
            <Play className="h-3 w-3" /> Test
          </Button>
        )}
      </div>

      {/* Rules */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {rules.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground space-y-2">
              <p className="text-sm">No extractors</p>
              <p className="text-xs">Extract values from responses to reuse in subsequent requests.<br/>Perfect for auth tokens, IDs, and pagination cursors.</p>
              <div className="flex flex-wrap gap-1.5 justify-center pt-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => addTemplate(t.rule)}
                    className="text-xs px-2.5 py-1 rounded-full border hover:bg-accent"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                testResult={testResults.find((r) => r.varName === rule.varName)}
                onChange={(updated) => save(rules.map((r) => (r.id === rule.id ? updated : r)))}
                onDelete={() => save(rules.filter((r) => r.id !== rule.id))}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Variable scope info */}
      {rules.length > 0 && (
        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground space-y-0.5">
          <p>Extractors run automatically after each response.</p>
          <p>
            Collection: <strong>{collection?.name ?? "—"}</strong> ·
            Environment: <strong>{env?.name ?? "None"}</strong>
          </p>
          {colVars.length > 0 && (
            <p>Available vars: {colVars.slice(0, 4).map((v) => `{{${v.name}}}`).join(" ")}{colVars.length > 4 ? " …" : ""}</p>
          )}
        </div>
      )}
    </div>
  );
}
