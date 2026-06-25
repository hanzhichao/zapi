// ── WebSocket Filter & State Machine types ──────────────────────────────────

// ── Filter Rules ─────────────────────────────────────────────────────────────

export type WsFilterAction = "show" | "hide" | "collapse" | "highlight";
export type WsMatcherType = "contains" | "regex" | "jsonpath" | "equals" | "jsonpath-exists";

export type WsFilterDirection = "all" | "inbound" | "outbound";

export const HIGHLIGHT_COLORS = [
  { label: "Red",    value: "red",    cls: "bg-red-500/20 border-l-2 border-red-500"    },
  { label: "Yellow", value: "yellow", cls: "bg-yellow-500/20 border-l-2 border-yellow-500" },
  { label: "Green",  value: "green",  cls: "bg-green-500/20 border-l-2 border-green-500"  },
  { label: "Blue",   value: "blue",   cls: "bg-blue-500/20 border-l-2 border-blue-500"   },
  { label: "Purple", value: "purple", cls: "bg-purple-500/20 border-l-2 border-purple-500"},
] as const;

export type HighlightColor = "red" | "yellow" | "green" | "blue" | "purple";

/** A single filter rule applied to every incoming/outgoing message */
export interface WsFilterRule {
  id: string;
  name: string;
  enabled: boolean;
  direction: WsFilterDirection;
  matcher: WsMatcherType;
  /** The pattern: text / regex / JSONPath expression */
  pattern: string;
  /** For jsonpath: the expected value (equality check). Empty = just check exists */
  jsonpathExpected?: string;
  /** What to do when the rule matches */
  action: WsFilterAction;
  /** For highlight action */
  color?: HighlightColor;
  /** For collapse: group label (e.g. "heartbeat") */
  collapseLabel?: string;
}

// ── State Machine ─────────────────────────────────────────────────────────────

export type SmStepType = "send" | "expect" | "forbid" | "wait";

export interface SmStep {
  id: string;
  type: SmStepType;

  // ── SEND ──────────────────────────────────────────────────────────────────
  /** Message to send (JSON string or plain text) */
  message?: string;

  // ── EXPECT / FORBID ───────────────────────────────────────────────────────
  matcher?: WsMatcherType;
  /** Pattern text, regex, or JSONPath */
  pattern?: string;
  /** For jsonpath matcher: expected value string */
  jsonpathExpected?: string;

  // ── Timing ────────────────────────────────────────────────────────────────
  /** EXPECT: must match within N ms (default 10 000) */
  timeoutMs?: number;
  /** WAIT: pause N ms */
  waitMs?: number;

  // ── Meta ──────────────────────────────────────────────────────────────────
  description?: string;

  // ── FORBID window semantics ───────────────────────────────────────────────
  /**
   * "since-last" (default): check messages since the previous SEND or EXPECT
   * "since-start":          check all messages in this run
   */
  forbidWindow?: "since-last" | "since-start";
}

export interface WsStateMachine {
  id: string;
  name: string;
  description?: string;
  steps: SmStep[];
  createdAt: number;
}

// ── Runner result ─────────────────────────────────────────────────────────────

export type SmStepStatus = "pending" | "running" | "pass" | "fail" | "skip";

export interface SmStepResult {
  stepId: string;
  status: SmStepStatus;
  message?: string;
  /** Actual WS message that triggered pass/fail */
  actualData?: string;
  elapsedMs?: number;
}

export interface SmRunResult {
  machineId: string;
  status: "running" | "pass" | "fail" | "aborted";
  startedAt: number;
  endedAt?: number;
  steps: SmStepResult[];
}
