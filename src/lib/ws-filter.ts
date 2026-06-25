/**
 * WebSocket message filter engine.
 *
 * Provides:
 *  - evaluateJsonPath(data, path)  – minimal JSONPath evaluator
 *  - matchMessage(msg, rule)       – check if a WsMessage matches a WsFilterRule
 *  - applyFilters(msgs, rules)     – build the display list (hide/collapse/highlight)
 */

import type { WsMessage } from "./types";
import type { WsFilterRule } from "./ws-sm-types";

// ── JSONPath evaluator (minimal, no external deps) ────────────────────────────
//
// Supported syntax:
//   $.field           → property access
//   $.a.b.c           → nested
//   $[0]              → array index
//   $[*]              → all array elements
//   $..field          → recursive descent
//   $.arr[*].status   → all elements' .status

function tokenize(path: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      if (path[i + 1] === ".") {
        tokens.push("..");
        i += 2;
        let field = "";
        while (i < path.length && path[i] !== "." && path[i] !== "[") {
          field += path[i++];
        }
        if (field) tokens.push(field);
      } else {
        i++;
        let field = "";
        while (i < path.length && path[i] !== "." && path[i] !== "[") {
          field += path[i++];
        }
        if (field) tokens.push(field);
      }
    } else if (path[i] === "[") {
      i++;
      let idx = "";
      while (i < path.length && path[i] !== "]") idx += path[i++];
      i++; // skip ]
      tokens.push(`[${idx.trim()}]`);
    } else {
      let field = "";
      while (i < path.length && path[i] !== "." && path[i] !== "[") {
        field += path[i++];
      }
      if (field) tokens.push(field);
    }
  }
  return tokens;
}

function evalTokens(data: unknown, tokens: string[]): unknown[] {
  if (tokens.length === 0) return [data];
  const [head, ...rest] = tokens;

  if (head === "..") {
    const result: unknown[] = [];
    collectRecursive(data, rest, result);
    return result;
  }

  if (head.startsWith("[") && head.endsWith("]")) {
    const inner = head.slice(1, -1);
    if (inner === "*") {
      if (!Array.isArray(data)) return [];
      return (data as unknown[]).flatMap((item) => evalTokens(item, rest));
    }
    const idx = parseInt(inner, 10);
    if (!Array.isArray(data) || isNaN(idx)) return [];
    return evalTokens((data as unknown[])[idx], rest);
  }

  if (typeof data !== "object" || data === null) return [];
  const obj = data as Record<string, unknown>;
  if (!(head in obj)) return [];
  return evalTokens(obj[head], rest);
}

function collectRecursive(data: unknown, tokens: string[], out: unknown[]) {
  out.push(...evalTokens(data, tokens));
  if (Array.isArray(data)) {
    for (const item of data as unknown[]) collectRecursive(item, tokens, out);
  } else if (typeof data === "object" && data !== null) {
    for (const v of Object.values(data as Record<string, unknown>)) {
      collectRecursive(v, tokens, out);
    }
  }
}

/**
 * Evaluate a JSONPath against a parsed JSON value.
 * Returns array of matched values (empty = no match).
 */
export function evaluateJsonPath(data: unknown, path: string): unknown[] {
  if (!path.startsWith("$")) return [];
  const tokens = tokenize(path.slice(1));
  return evalTokens(data, tokens);
}

// ── Match engine ─────────────────────────────────────────────────────────────

/**
 * Test whether a WS message matches a filter rule's condition.
 * Returns true if the message matches (action should be applied).
 */
export function matchMessage(msg: WsMessage, rule: WsFilterRule): boolean {
  // Direction guard
  if (rule.direction === "inbound" && msg.direction !== "received") return false;
  if (rule.direction === "outbound" && msg.direction !== "sent") return false;

  return matchData(msg.data, rule);
}

/** Core matcher — tests raw data string against rule condition */
export function matchData(
  data: string,
  rule: Pick<WsFilterRule, "matcher" | "pattern" | "jsonpathExpected">
): boolean {
  const { matcher, pattern, jsonpathExpected } = rule;
  if (!pattern) return false;

  switch (matcher) {
    case "contains":
      return data.includes(pattern);

    case "equals":
      return data === pattern;

    case "regex": {
      try {
        return new RegExp(pattern).test(data);
      } catch {
        return false;
      }
    }

    case "jsonpath":
    case "jsonpath-exists": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return false;
      }
      const values = evaluateJsonPath(parsed, pattern);
      if (values.length === 0) return false;
      if (matcher === "jsonpath-exists") return true;
      // Check against expected value
      if (!jsonpathExpected) return values.length > 0;
      const expected = jsonpathExpected.trim();
      return values.some((v) => String(v) === expected || JSON.stringify(v) === expected);
    }

    default:
      return false;
  }
}

// ── Display-list builder ──────────────────────────────────────────────────────

export type DisplayItem =
  | {
      kind: "message";
      msg: WsMessage;
      highlightCls?: string;
    }
  | {
      kind: "collapsed";
      msgs: WsMessage[];
      label: string;
      ruleId: string;
    };

/**
 * Apply all enabled filter rules to a message list and return display items.
 *
 * Rules are applied in order; the FIRST matching rule wins for hide/collapse.
 * Multiple highlight rules can stack (last one wins for color).
 */
export function buildDisplayList(
  messages: WsMessage[],
  rules: WsFilterRule[]
): DisplayItem[] {
  const enabled = rules.filter((r) => r.enabled);

  const items: DisplayItem[] = [];
  let collapseBuffer: WsMessage[] = [];
  let collapseRule: WsFilterRule | null = null;

  const flushCollapse = () => {
    if (collapseBuffer.length > 0 && collapseRule) {
      items.push({
        kind: "collapsed",
        msgs: [...collapseBuffer],
        label: collapseRule.collapseLabel || collapseRule.name,
        ruleId: collapseRule.id,
      });
      collapseBuffer = [];
      collapseRule = null;
    }
  };

  for (const msg of messages) {
    let action: WsFilterRule["action"] | null = null;
    let matchedRule: WsFilterRule | null = null;
    let highlightCls: string | undefined;

    for (const rule of enabled) {
      if (matchMessage(msg, rule)) {
        if (rule.action === "highlight") {
          // Apply highlight (don't stop processing other rules for hide/collapse)
          const colorMap: Record<string, string> = {
            red:    "bg-red-500/20 border-l-2 border-red-500",
            yellow: "bg-yellow-500/20 border-l-2 border-yellow-500",
            green:  "bg-green-500/20 border-l-2 border-green-500",
            blue:   "bg-blue-500/20 border-l-2 border-blue-500",
            purple: "bg-purple-500/20 border-l-2 border-purple-500",
          };
          highlightCls = colorMap[rule.color ?? "yellow"];
        } else if (!action) {
          action = rule.action;
          matchedRule = rule;
        }
      }
    }

    if (action === "hide") {
      // Flush any pending collapse, skip this message
      flushCollapse();
      continue;
    }

    if (action === "collapse") {
      const prevId = collapseRule ? collapseRule.id : undefined;
      const nextId = matchedRule ? matchedRule.id : undefined;
      if (prevId !== undefined && prevId === nextId) {
        // Continue collapsing same group
        collapseBuffer.push(msg);
      } else {
        flushCollapse();
        collapseBuffer = [msg];
        collapseRule = matchedRule;
      }
      continue;
    }

    // Not hidden/collapsed — flush any pending collapse first
    flushCollapse();
    items.push({ kind: "message", msg, highlightCls });
  }

  flushCollapse();
  return items;
}

// ── Heartbeat auto-detect helpers ─────────────────────────────────────────────

const HEARTBEAT_PATTERNS = [
  "ping", "pong", "heartbeat", "hb", "keepalive", "keep-alive", "ka",
];

/**
 * Return a reasonable default filter rule that collapses heartbeat messages.
 * Detects: ping/pong, heartbeat keywords, or {"type":"ping"} JSON patterns.
 */
export function createHeartbeatFilterRule(): WsFilterRule {
  return {
    id: `hb-${Date.now()}`,
    name: "Auto-collapse Heartbeats",
    enabled: true,
    direction: "all",
    matcher: "regex",
    pattern: `(?i)\\b(${HEARTBEAT_PATTERNS.join("|")})\\b`,
    action: "collapse",
    collapseLabel: "heartbeat",
  };
}
