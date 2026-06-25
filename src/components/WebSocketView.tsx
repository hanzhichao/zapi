"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { sendWsMessage } from "@/lib/websocket-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Trash2,
  ArrowUp,
  ArrowDown,
  Plus,
  Pencil,
  Check,
  X,
  Play,
  StopCircle,
  ChevronDown,
  ChevronRight,
  Filter,
  TestTube2,
  MessageSquare,
  GripVertical,
  AlertTriangle,
  Clock,
  Zap,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WsFilterRule, WsStateMachine, SmStep, SmStepResult, SmRunResult, WsMatcherType, WsFilterDirection, WsFilterAction, HighlightColor } from "@/lib/ws-sm-types";
import { HIGHLIGHT_COLORS, type SmStepType } from "@/lib/ws-sm-types";
import { buildDisplayList, createHeartbeatFilterRule } from "@/lib/ws-filter";
import { WsStateMachineRunner, createExampleMachine } from "@/lib/ws-state-machine";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return crypto.randomUUID(); }

function timeStr(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 1 });
}

// ── Sub-components: Messages tab ──────────────────────────────────────────────

function CollapsedRow({ msgs, label, onExpand }: { msgs: { id: string }[]; label: string; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      className="w-full flex items-center gap-2 px-2 py-1 rounded-sm text-left text-[10px] text-muted-foreground hover:bg-muted/30 italic"
    >
      <ChevronRight className="h-3 w-3 shrink-0" />
      <span>{msgs.length}× {label}</span>
    </button>
  );
}

// ── Sub-components: Filter editor ─────────────────────────────────────────────

const MATCHER_LABELS: Record<WsMatcherType, string> = {
  contains: "Contains",
  equals: "Equals",
  regex: "Regex",
  jsonpath: "JSONPath ==",
  "jsonpath-exists": "JSONPath exists",
};

const ACTION_LABELS: Record<WsFilterAction, string> = {
  show: "Show",
  hide: "Hide",
  collapse: "Collapse",
  highlight: "Highlight",
};

function FilterRuleRow({
  rule,
  onUpdate,
  onDelete,
}: {
  rule: WsFilterRule;
  onUpdate: (data: Partial<WsFilterRule>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-md mb-2 text-xs">
      {/* Row header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
        <button
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="truncate font-medium">{rule.name || "(unnamed)"}</span>
        </button>
        {/* quick summary */}
        <span className="text-[10px] text-muted-foreground shrink-0">
          {rule.action}
          {rule.action === "highlight" && rule.color ? ` · ${rule.color}` : ""}
        </span>
        <button
          className={cn(
            "h-4 w-7 rounded-full transition-colors shrink-0 relative",
            rule.enabled ? "bg-blue-500" : "bg-muted"
          )}
          onClick={() => onUpdate({ enabled: !rule.enabled })}
          title={rule.enabled ? "Disable" : "Enable"}
        >
          <span
            className={cn(
              "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
              rule.enabled ? "translate-x-3.5" : "translate-x-0.5"
            )}
          />
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {/* Name */}
          <div className="flex gap-2 items-center">
            <label className="w-20 shrink-0 text-muted-foreground">Name</label>
            <Input
              className="h-6 text-xs"
              value={rule.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
            />
          </div>
          {/* Direction */}
          <div className="flex gap-2 items-center">
            <label className="w-20 shrink-0 text-muted-foreground">Direction</label>
            <Select value={rule.direction} onValueChange={(v) => onUpdate({ direction: v as WsFilterDirection })}>
              <SelectTrigger className="h-6 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Matcher */}
          <div className="flex gap-2 items-center">
            <label className="w-20 shrink-0 text-muted-foreground">Match</label>
            <Select value={rule.matcher} onValueChange={(v) => onUpdate({ matcher: v as WsMatcherType })}>
              <SelectTrigger className="h-6 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MATCHER_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Pattern */}
          <div className="flex gap-2 items-center">
            <label className="w-20 shrink-0 text-muted-foreground">Pattern</label>
            <Input
              className="h-6 text-xs flex-1 font-mono"
              placeholder={rule.matcher === "jsonpath" || rule.matcher === "jsonpath-exists" ? "$.field" : "pattern…"}
              value={rule.pattern}
              onChange={(e) => onUpdate({ pattern: e.target.value })}
            />
          </div>
          {/* JSONPath expected */}
          {rule.matcher === "jsonpath" && (
            <div className="flex gap-2 items-center">
              <label className="w-20 shrink-0 text-muted-foreground">Equals</label>
              <Input
                className="h-6 text-xs flex-1 font-mono"
                placeholder="expected value"
                value={rule.jsonpathExpected ?? ""}
                onChange={(e) => onUpdate({ jsonpathExpected: e.target.value })}
              />
            </div>
          )}
          {/* Action */}
          <div className="flex gap-2 items-center">
            <label className="w-20 shrink-0 text-muted-foreground">Action</label>
            <Select value={rule.action} onValueChange={(v) => onUpdate({ action: v as WsFilterAction })}>
              <SelectTrigger className="h-6 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACTION_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Highlight color */}
          {rule.action === "highlight" && (
            <div className="flex gap-2 items-center">
              <label className="w-20 shrink-0 text-muted-foreground">Color</label>
              <div className="flex gap-1.5">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    className={cn(
                      "h-4 w-4 rounded-full border-2",
                      c.value === "red" && "bg-red-500",
                      c.value === "yellow" && "bg-yellow-500",
                      c.value === "green" && "bg-green-500",
                      c.value === "blue" && "bg-blue-500",
                      c.value === "purple" && "bg-purple-500",
                      rule.color === c.value ? "border-foreground" : "border-transparent"
                    )}
                    onClick={() => onUpdate({ color: c.value as HighlightColor })}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Collapse label */}
          {rule.action === "collapse" && (
            <div className="flex gap-2 items-center">
              <label className="w-20 shrink-0 text-muted-foreground">Label</label>
              <Input
                className="h-6 text-xs flex-1"
                placeholder="Group label (e.g. heartbeat)"
                value={rule.collapseLabel ?? ""}
                onChange={(e) => onUpdate({ collapseLabel: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components: State machine step ────────────────────────────────────────

const STEP_ICONS: Record<SmStepType, React.ReactNode> = {
  send: <Zap className="h-3.5 w-3.5 text-blue-500" />,
  expect: <Check className="h-3.5 w-3.5 text-green-500" />,
  forbid: <Ban className="h-3.5 w-3.5 text-red-500" />,
  wait: <Clock className="h-3.5 w-3.5 text-yellow-500" />,
};

const STEP_STATUS_COLORS: Record<string, string> = {
  pending:  "text-muted-foreground",
  running:  "text-blue-500 animate-pulse",
  pass:     "text-green-500",
  fail:     "text-red-500",
  skip:     "text-muted-foreground/40 line-through",
};

function StepResultBadge({ result }: { result?: SmStepResult }) {
  if (!result || result.status === "pending") return null;
  const icon = {
    running: <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />,
    pass:    <Check className="h-3 w-3 text-green-500" />,
    fail:    <AlertTriangle className="h-3 w-3 text-red-500" />,
    skip:    <span className="text-[10px] text-muted-foreground">skip</span>,
  }[result.status];

  return (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      {icon}
      {result.elapsedMs !== undefined && (
        <span className="text-[10px] text-muted-foreground">{result.elapsedMs}ms</span>
      )}
    </div>
  );
}

function SmStepRow({
  step,
  result,
  onUpdate,
  onDelete,
}: {
  step: SmStep;
  result?: SmStepResult;
  onUpdate: (data: Partial<SmStep>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const summary = (() => {
    switch (step.type) {
      case "send": return step.message ? `"${step.message.slice(0, 60)}"` : "(empty)";
      case "expect": return step.pattern
        ? `${step.matcher ?? "contains"}: ${step.pattern}${step.jsonpathExpected ? ` == ${step.jsonpathExpected}` : ""}${step.timeoutMs ? ` (${step.timeoutMs / 1000}s)` : ""}`
        : "(no pattern)";
      case "forbid": return step.pattern ? `${step.matcher ?? "contains"}: ${step.pattern}` : "(no pattern)";
      case "wait": return `${step.waitMs ?? 1000}ms`;
    }
  })();

  return (
    <div className={cn(
      "border rounded-md mb-2 text-xs transition-colors",
      result?.status === "running" && "border-blue-500/50 bg-blue-500/5",
      result?.status === "pass" && "border-green-500/30 bg-green-500/5",
      result?.status === "fail" && "border-red-500/50 bg-red-500/5",
    )}>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
        <button
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          {STEP_ICONS[step.type]}
          <span className={cn("uppercase font-bold w-12 shrink-0", STEP_STATUS_COLORS[result?.status ?? "pending"])}>
            {step.type}
          </span>
          <span className="truncate text-muted-foreground">{summary}</span>
        </button>
        <StepResultBadge result={result} />
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0"
          onClick={onDelete}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Result details */}
      {result && (result.message || result.actualData) && (
        <div className={cn(
          "px-3 pb-1.5 text-[10px] space-y-0.5 border-t",
          result.status === "fail" ? "border-red-500/20" : "border-green-500/20"
        )}>
          {result.message && <p className={result.status === "fail" ? "text-red-400" : "text-green-400"}>{result.message}</p>}
          {result.actualData && <p className="text-muted-foreground font-mono break-all">{result.actualData}</p>}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {/* Description */}
          <div className="flex gap-2 items-center">
            <label className="w-20 shrink-0 text-muted-foreground">Description</label>
            <Input
              className="h-6 text-xs"
              placeholder="(optional)"
              value={step.description ?? ""}
              onChange={(e) => onUpdate({ description: e.target.value })}
            />
          </div>

          {step.type === "send" && (
            <div className="flex gap-2 items-start">
              <label className="w-20 shrink-0 text-muted-foreground mt-1">Message</label>
              <Textarea
                className="h-20 text-xs font-mono flex-1 resize-none"
                value={step.message ?? ""}
                onChange={(e) => onUpdate({ message: e.target.value })}
                placeholder='{"action":"start"}'
              />
            </div>
          )}

          {(step.type === "expect" || step.type === "forbid") && (
            <>
              <div className="flex gap-2 items-center">
                <label className="w-20 shrink-0 text-muted-foreground">Match</label>
                <Select value={step.matcher ?? "contains"} onValueChange={(v) => onUpdate({ matcher: v as WsMatcherType })}>
                  <SelectTrigger className="h-6 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MATCHER_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 items-center">
                <label className="w-20 shrink-0 text-muted-foreground">Pattern</label>
                <Input
                  className="h-6 text-xs flex-1 font-mono"
                  value={step.pattern ?? ""}
                  onChange={(e) => onUpdate({ pattern: e.target.value })}
                  placeholder={step.matcher?.startsWith("jsonpath") ? "$.status" : "pattern…"}
                />
              </div>
              {step.matcher === "jsonpath" && (
                <div className="flex gap-2 items-center">
                  <label className="w-20 shrink-0 text-muted-foreground">Equals</label>
                  <Input
                    className="h-6 text-xs flex-1 font-mono"
                    value={step.jsonpathExpected ?? ""}
                    onChange={(e) => onUpdate({ jsonpathExpected: e.target.value })}
                    placeholder="expected value"
                  />
                </div>
              )}
              {step.type === "expect" && (
                <div className="flex gap-2 items-center">
                  <label className="w-20 shrink-0 text-muted-foreground">Timeout</label>
                  <Input
                    type="number"
                    className="h-6 text-xs w-24"
                    value={step.timeoutMs ?? 10000}
                    onChange={(e) => onUpdate({ timeoutMs: Number(e.target.value) })}
                  />
                  <span className="text-muted-foreground">ms</span>
                </div>
              )}
              {step.type === "forbid" && (
                <div className="flex gap-2 items-center">
                  <label className="w-20 shrink-0 text-muted-foreground">Window</label>
                  <Select
                    value={step.forbidWindow ?? "since-last"}
                    onValueChange={(v) => onUpdate({ forbidWindow: v as SmStep["forbidWindow"] })}
                  >
                    <SelectTrigger className="h-6 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="since-last">Since last SEND/EXPECT</SelectItem>
                      <SelectItem value="since-start">Since run start</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {step.type === "wait" && (
            <div className="flex gap-2 items-center">
              <label className="w-20 shrink-0 text-muted-foreground">Duration</label>
              <Input
                type="number"
                className="h-6 text-xs w-24"
                value={step.waitMs ?? 1000}
                onChange={(e) => onUpdate({ waitMs: Number(e.target.value) })}
              />
              <span className="text-muted-foreground">ms</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components: State machine card ───────────────────────────────────────

function StateMachineCard({
  sm,
  stepResults,
  isRunning,
  onRun,
  onAbort,
  onUpdateSm,
  onDeleteSm,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
}: {
  sm: WsStateMachine;
  stepResults: SmStepResult[];
  isRunning: boolean;
  onRun: () => void;
  onAbort: () => void;
  onUpdateSm: (data: Partial<WsStateMachine>) => void;
  onDeleteSm: () => void;
  onAddStep: (type: SmStepType) => void;
  onUpdateStep: (id: string, data: Partial<SmStep>) => void;
  onDeleteStep: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(sm.name);

  const passCount = stepResults.filter((r) => r.status === "pass").length;
  const failCount = stepResults.filter((r) => r.status === "fail").length;
  const totalDone = stepResults.filter((r) => r.status !== "pending" && r.status !== "running").length;

  return (
    <div className="border rounded-lg mb-3">
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 rounded-t-lg">
        <button onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>

        {editingName ? (
          <form
            className="flex-1 flex gap-1"
            onSubmit={(e) => { e.preventDefault(); onUpdateSm({ name: nameValue }); setEditingName(false); }}
          >
            <Input
              autoFocus
              className="h-6 text-xs flex-1"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
            />
            <Button type="submit" size="icon" variant="ghost" className="h-5 w-5">
              <Check className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => { setNameValue(sm.name); setEditingName(false); }}
            >
              <X className="h-3 w-3" />
            </Button>
          </form>
        ) : (
          <button
            className="flex-1 text-left text-sm font-medium truncate"
            onDoubleClick={() => setEditingName(true)}
          >
            {sm.name}
          </button>
        )}

        {/* Step result summary */}
        {stepResults.length > 0 && totalDone > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {passCount}/{totalDone}
            {failCount > 0 && <span className="text-red-500 ml-1">{failCount} failed</span>}
          </span>
        )}

        <Button
          size="sm"
          className="h-6 text-xs gap-1 px-2 shrink-0"
          variant={isRunning ? "outline" : "default"}
          onClick={isRunning ? onAbort : onRun}
          disabled={!isRunning && sm.steps.length === 0}
        >
          {isRunning ? (
            <><StopCircle className="h-3 w-3" /> Abort</>
          ) : (
            <><Play className="h-3 w-3" /> Run</>
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => setEditingName(true)}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onDeleteSm}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {open && (
        <div className="p-3">
          {/* Description */}
          {sm.description && (
            <p className="text-xs text-muted-foreground mb-3">{sm.description}</p>
          )}

          {/* Steps */}
          {sm.steps.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2 text-center">
              No steps yet — add one below
            </p>
          ) : (
            sm.steps.map((step) => (
              <SmStepRow
                key={step.id}
                step={step}
                result={stepResults.find((r) => r.stepId === step.id)}
                onUpdate={(data) => onUpdateStep(step.id, data)}
                onDelete={() => onDeleteStep(step.id)}
              />
            ))
          )}

          {/* Add step buttons */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(["send", "expect", "forbid", "wait"] as SmStepType[]).map((t) => (
              <Button
                key={t}
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1 px-2"
                onClick={() => onAddStep(t)}
              >
                {STEP_ICONS[t]}
                {t.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main WebSocketView ─────────────────────────────────────────────────────────

type WsTab = "messages" | "filters" | "assertions";

export function WebSocketView() {
  const {
    activeRequestId,
    wsMessages,
    wsConnected,
    clearWsMessages,
    addWsMessage,
    wsFilters,
    addWsFilter,
    updateWsFilter,
    deleteWsFilter,
    wsStateMachines,
    addWsStateMachine,
    updateWsStateMachine,
    deleteWsStateMachine,
  } = useAppStore();

  const [tab, setTab] = useState<WsTab>("messages");
  const [input, setInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedCollapsed, setExpandedCollapsed] = useState<Record<number, boolean>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // State machine runner state
  const runnerRef = useRef<WsStateMachineRunner | null>(null);
  const [runningSm, setRunningSm] = useState<string | null>(null); // SM id
  const [smResults, setSmResults] = useState<Record<string, SmStepResult[]>>({});

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && bottomRef.current && tab === "messages") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [wsMessages, autoScroll, tab]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  // ── Feed messages to active runner ──────────────────────────────────────
  useEffect(() => {
    if (wsMessages.length > 0 && runnerRef.current) {
      const last = wsMessages[wsMessages.length - 1];
      runnerRef.current.ingest(last);
    }
  }, [wsMessages]);

  // ── Send ────────────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    if (!activeRequestId || !input.trim() || !wsConnected) return;
    const ok = sendWsMessage(activeRequestId, input);
    if (ok) {
      addWsMessage({
        id: uid(),
        direction: "sent",
        data: input,
        timestamp: Date.now(),
      });
      setInput("");
    }
  }, [activeRequestId, input, wsConnected, addWsMessage]);

  // ── Filters helpers ──────────────────────────────────────────────────────
  const addNewFilter = () => {
    const rule: WsFilterRule = {
      id: uid(),
      name: "New Filter",
      enabled: true,
      direction: "all",
      matcher: "contains",
      pattern: "",
      action: "highlight",
      color: "yellow",
    };
    addWsFilter(rule);
  };

  const addHeartbeatRule = () => addWsFilter(createHeartbeatFilterRule());

  // ── State machine helpers ────────────────────────────────────────────────
  const addNewMachine = () => {
    const sm: WsStateMachine = {
      id: uid(),
      name: "New Assertion",
      steps: [],
      createdAt: Date.now(),
    };
    addWsStateMachine(sm);
  };

  const addExampleMachine = () => {
    addWsStateMachine(createExampleMachine());
  };

  const addStep = (smId: string, type: SmStepType) => {
    const sm = wsStateMachines.find((m) => m.id === smId);
    if (!sm) return;
    const step: SmStep = { id: uid(), type };
    if (type === "expect") step.timeoutMs = 10000;
    if (type === "wait") step.waitMs = 1000;
    if (type === "expect" || type === "forbid") step.matcher = "contains";
    updateWsStateMachine(smId, { steps: [...sm.steps, step] });
  };

  const updateStep = (smId: string, stepId: string, data: Partial<SmStep>) => {
    const sm = wsStateMachines.find((m) => m.id === smId);
    if (!sm) return;
    updateWsStateMachine(smId, {
      steps: sm.steps.map((s) => (s.id === stepId ? { ...s, ...data } : s)),
    });
  };

  const deleteStep = (smId: string, stepId: string) => {
    const sm = wsStateMachines.find((m) => m.id === smId);
    if (!sm) return;
    updateWsStateMachine(smId, { steps: sm.steps.filter((s) => s.id !== stepId) });
  };

  const runMachine = async (smId: string) => {
    const sm = wsStateMachines.find((m) => m.id === smId);
    if (!sm || runningSm) return;

    // Initialise results to pending
    const initial = sm.steps.map((s) => ({ stepId: s.id, status: "pending" as const }));
    setSmResults((prev) => ({ ...prev, [smId]: initial }));
    setRunningSm(smId);

    const sendFn = (msg: string) => {
      if (!activeRequestId) return;
      sendWsMessage(activeRequestId, msg);
      addWsMessage({ id: uid(), direction: "sent", data: msg, timestamp: Date.now() });
    };

    const runner = new WsStateMachineRunner(sm, sendFn, (results) => {
      setSmResults((prev) => ({ ...prev, [smId]: results }));
    });
    runnerRef.current = runner;

    try {
      const result: SmRunResult = await runner.run();
      setSmResults((prev) => ({ ...prev, [smId]: result.steps }));
    } finally {
      runnerRef.current = null;
      setRunningSm(null);
    }
  };

  const abortMachine = () => {
    runnerRef.current?.abort();
  };

  // ── Display list with filters ──────────────────────────────────────────
  const displayItems = buildDisplayList(wsMessages, wsFilters);

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabs: { id: WsTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "messages", label: "Messages", icon: <MessageSquare className="h-3 w-3" />, badge: wsMessages.length || undefined },
    { id: "filters",  label: "Filters",  icon: <Filter className="h-3 w-3" />, badge: wsFilters.filter((r) => r.enabled).length || undefined },
    { id: "assertions", label: "Assertions", icon: <TestTube2 className="h-3 w-3" />, badge: wsStateMachines.length || undefined },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/10 shrink-0">
        <div className={cn("h-2 w-2 rounded-full shrink-0", wsConnected ? "bg-green-500" : "bg-muted-foreground/40")} />
        <span className="text-xs text-muted-foreground flex-1">
          {wsConnected ? "Connected" : "Not connected"} · {wsMessages.length} messages
        </span>
        {runningSm && (
          <span className="text-xs text-blue-500 animate-pulse">Running assertion…</span>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearWsMessages} title="Clear messages">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b shrink-0 bg-muted/5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors",
              tab === t.id
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.icon}
            {t.label}
            {t.badge !== undefined && (
              <span className="bg-muted text-muted-foreground rounded-full px-1 text-[10px] min-w-[16px] text-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── MESSAGES TAB ────────────────────────────────────────────────────── */}
      {tab === "messages" && (
        <>
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 font-mono text-xs"
          >
            {displayItems.length === 0 && (
              <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                {wsMessages.length === 0
                  ? "Connect and send messages to see them here"
                  : "All messages are hidden by active filter rules"}
              </div>
            )}
            {displayItems.map((item, idx) => {
              if (item.kind === "collapsed") {
                if (expandedCollapsed[idx]) {
                  return (
                    <div key={idx}>
                      <button
                        onClick={() => setExpandedCollapsed((p) => ({ ...p, [idx]: false }))}
                        className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1 hover:text-foreground"
                      >
                        <ChevronDown className="h-3 w-3" /> Collapse {item.msgs.length}× {item.label}
                      </button>
                      {item.msgs.map((msg) => (
                        <MessageRow key={msg.id} msg={msg} />
                      ))}
                    </div>
                  );
                }
                return (
                  <CollapsedRow
                    key={idx}
                    msgs={item.msgs}
                    label={item.label}
                    onExpand={() => setExpandedCollapsed((p) => ({ ...p, [idx]: true }))}
                  />
                );
              }
              return (
                <MessageRow key={item.msg.id} msg={item.msg} highlightCls={item.highlightCls} />
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Send input */}
          <div className="px-3 pb-3 pt-2 border-t bg-muted/5 shrink-0">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={wsConnected ? "Type a message…" : "Connect first to send messages"}
                disabled={!wsConnected}
                className="flex-1 font-mono text-xs resize-none min-h-[60px] max-h-[120px] bg-muted/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!wsConnected || !input.trim()}
                className="self-end h-8 w-8"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Enter to send · Shift+Enter for newline</p>
          </div>
        </>
      )}

      {/* ── FILTERS TAB ─────────────────────────────────────────────────────── */}
      {tab === "filters" && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              Rules are applied in order. First matching hide/collapse rule wins; all matching highlight rules stack.
            </p>
          </div>

          {wsFilters.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              No filter rules yet
            </div>
          )}

          {wsFilters.map((rule) => (
            <FilterRuleRow
              key={rule.id}
              rule={rule}
              onUpdate={(data) => updateWsFilter(rule.id, data)}
              onDelete={() => deleteWsFilter(rule.id)}
            />
          ))}

          <div className="flex gap-2 mt-3">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addNewFilter}>
              <Plus className="h-3.5 w-3.5" /> Add Filter
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addHeartbeatRule}>
              <Plus className="h-3.5 w-3.5" /> + Heartbeat Collapse
            </Button>
          </div>

          <div className="mt-4 p-3 rounded-md bg-muted/20 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Filter actions</p>
            <p><strong>Hide</strong> — remove from message list entirely</p>
            <p><strong>Collapse</strong> — group consecutive matches into a single expandable row</p>
            <p><strong>Highlight</strong> — show with a colored background</p>
            <p><strong>Show</strong> — override hide rules (useful for exceptions)</p>
          </div>
        </div>
      )}

      {/* ── ASSERTIONS TAB ──────────────────────────────────────────────────── */}
      {tab === "assertions" && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              Design time-ordered assertion scripts that send messages and verify responses.
            </p>
          </div>

          {wsStateMachines.length === 0 && (
            <div className="text-center py-6 text-muted-foreground text-xs space-y-2">
              <TestTube2 className="h-8 w-8 mx-auto opacity-30" />
              <p>No assertion machines yet</p>
              <p className="text-[10px]">Add a machine and define SEND → EXPECT → FORBID steps</p>
            </div>
          )}

          {wsStateMachines.map((sm) => (
            <StateMachineCard
              key={sm.id}
              sm={sm}
              stepResults={smResults[sm.id] ?? []}
              isRunning={runningSm === sm.id}
              onRun={() => runMachine(sm.id)}
              onAbort={abortMachine}
              onUpdateSm={(data) => updateWsStateMachine(sm.id, data)}
              onDeleteSm={() => deleteWsStateMachine(sm.id)}
              onAddStep={(type) => addStep(sm.id, type)}
              onUpdateStep={(stepId, data) => updateStep(sm.id, stepId, data)}
              onDeleteStep={(stepId) => deleteStep(sm.id, stepId)}
            />
          ))}

          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addNewMachine}>
              <Plus className="h-3.5 w-3.5" /> New Machine
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addExampleMachine}>
              <TestTube2 className="h-3.5 w-3.5" /> Load Example
            </Button>
          </div>

          <div className="mt-4 p-3 rounded-md bg-muted/20 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Step types</p>
            <p><span className="text-blue-500">SEND</span> — transmit a message to the server</p>
            <p><span className="text-green-500">EXPECT</span> — wait for a matching inbound message (with timeout)</p>
            <p><span className="text-red-500">FORBID</span> — assert no forbidden message was received in the current window</p>
            <p><span className="text-yellow-500">WAIT</span> — pause for a fixed duration</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Utility: single message row ───────────────────────────────────────────────

function MessageRow({ msg, highlightCls }: { msg: import("@/lib/types").WsMessage; highlightCls?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = msg.data.length > 200;
  const display = isLong && !expanded ? msg.data.slice(0, 200) + "…" : msg.data;

  return (
    <div
      className={cn(
        "flex items-start gap-2 py-1 px-2 rounded-sm group",
        msg.direction === "sent"     && "bg-blue-500/8",
        msg.direction === "received" && "bg-green-500/8",
        msg.direction === "error"    && "bg-red-500/8",
        msg.direction === "info"     && "text-muted-foreground",
        highlightCls,
      )}
    >
      <span className="shrink-0 mt-0.5">
        {msg.direction === "sent"     && <ArrowUp className="h-3 w-3 text-blue-500" />}
        {msg.direction === "received" && <ArrowDown className="h-3 w-3 text-green-500" />}
        {msg.direction === "info"     && <span className="text-[10px] text-muted-foreground">●</span>}
        {msg.direction === "error"    && <span className="text-[10px] text-red-500">✕</span>}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
        {timeStr(msg.timestamp)}
      </span>
      <span className={cn(
        "flex-1 break-all whitespace-pre-wrap leading-relaxed",
        msg.direction === "error" && "text-red-500"
      )}>
        {display}
        {isLong && (
          <button
            className="ml-1 text-[10px] text-blue-500 underline hover:no-underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "show less" : "show more"}
          </button>
        )}
      </span>
    </div>
  );
}
