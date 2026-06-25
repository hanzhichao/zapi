"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/store";
import type { HistoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Diff algorithm ────────────────────────────────────────────────────────────

type DiffOp = "equal" | "insert" | "delete";
interface DiffLine { op: DiffOp; text: string; lineNo?: number }

/** Myers diff on lines */
function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const m = aLines.length;
  const n = bLines.length;

  // Simple LCS-based diff via DP (good enough for API responses)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0, j = 0;
  let lineNoA = 1, lineNoB = 1;

  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) {
      result.push({ op: "equal", text: aLines[i], lineNo: lineNoA });
      i++; j++; lineNoA++; lineNoB++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ op: "insert", text: bLines[j], lineNo: lineNoB });
      j++; lineNoB++;
    } else {
      result.push({ op: "delete", text: aLines[i], lineNo: lineNoA });
      i++; lineNoA++;
    }
  }
  return result;
}

function prettyJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

// ── Stats comparison ──────────────────────────────────────────────────────────

function StatRow({ label, a, b }: { label: string; a: string; b: string }) {
  const changed = a !== b;
  return (
    <div className="flex items-center gap-2 text-xs py-1 border-b border-border/40">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <span className={cn("flex-1", changed && "text-red-500 line-through")}>{a}</span>
      <ArrowLeftRight className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className={cn("flex-1", changed && "text-emerald-500 font-medium")}>{b}</span>
    </div>
  );
}

// ── Diff view ─────────────────────────────────────────────────────────────────

function DiffView({ left, right }: { left: string; right: string }) {
  const diffs = useMemo(() => diffLines(prettyJson(left), prettyJson(right)), [left, right]);

  const added = diffs.filter((d) => d.op === "insert").length;
  const removed = diffs.filter((d) => d.op === "delete").length;

  if (added === 0 && removed === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-emerald-500 gap-2">
        <span className="text-xl">✓</span> Responses are identical
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/20 border-b text-xs">
        <span className="text-emerald-500 font-medium">+{added} added</span>
        <span className="text-red-500 font-medium">−{removed} removed</span>
      </div>
      <div className="font-mono text-[11px] leading-5">
        {diffs.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              "flex px-3 py-0.5 group",
              line.op === "insert" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              line.op === "delete" && "bg-red-500/10 text-red-700 dark:text-red-300",
              line.op === "equal" && "text-foreground/80"
            )}
          >
            <span className={cn(
              "w-4 shrink-0 text-center select-none text-[10px]",
              line.op === "insert" && "text-emerald-500",
              line.op === "delete" && "text-red-500",
              line.op === "equal" && "text-transparent group-hover:text-muted-foreground"
            )}>
              {line.op === "insert" ? "+" : line.op === "delete" ? "−" : " "}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ResponseDiffPanel() {
  const { history, response } = useAppStore();
  const [leftId, setLeftId] = useState<string>("current");
  const [rightId, setRightId] = useState<string>(history[0]?.id ?? "");
  const [section, setSection] = useState<"stats" | "body" | "headers">("body");
  const [showAll, setShowAll] = useState(false);

  const historyWithResponses = history.filter((h) => h.response);
  const displayHistory = showAll ? historyWithResponses : historyWithResponses.slice(0, 20);

  const getItem = (id: string): HistoryItem | null => {
    if (id === "current") {
      if (!response) return null;
      return {
        id: "current",
        name: "Current Response",
        method: "GET",
        url: "",
        params: [],
        headers: [],
        body: { type: "none", content: "", formData: [] },
        auth: { type: "none" },
        response,
        timestamp: Date.now(),
      };
    }
    return history.find((h) => h.id === id) ?? null;
  };

  const leftItem = getItem(leftId);
  const rightItem = getItem(rightId);

  const leftResp = leftItem?.response;
  const rightResp = rightItem?.response;

  const itemLabel = (h: HistoryItem) =>
    `${h.method} ${h.name} — ${new Date(h.timestamp).toLocaleTimeString()}`;

  return (
    <div className="flex flex-col h-full">
      {/* Selector bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap">
        <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

        {/* Left */}
        <Select value={leftId} onValueChange={setLeftId}>
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0 max-w-52">
            <SelectValue placeholder="Left response…" />
          </SelectTrigger>
          <SelectContent>
            {response && <SelectItem value="current" className="text-xs font-medium">Current Response</SelectItem>}
            {displayHistory.map((h) => (
              <SelectItem key={h.id} value={h.id} className="text-xs">{itemLabel(h)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">vs</span>

        {/* Right */}
        <Select value={rightId} onValueChange={setRightId}>
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0 max-w-52">
            <SelectValue placeholder="Right response…" />
          </SelectTrigger>
          <SelectContent>
            {response && <SelectItem value="current" className="text-xs font-medium">Current Response</SelectItem>}
            {displayHistory.map((h) => (
              <SelectItem key={h.id} value={h.id} className="text-xs">{itemLabel(h)}</SelectItem>
            ))}
            {historyWithResponses.length > 20 && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full text-center text-xs text-muted-foreground py-1 hover:bg-accent"
              >
                Show all ({historyWithResponses.length})…
              </button>
            )}
          </SelectContent>
        </Select>

        {/* Section tabs */}
        <div className="flex rounded-lg border p-0.5 shrink-0">
          {(["stats", "body", "headers"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={cn(
                "px-2.5 py-0.5 text-xs rounded transition-colors capitalize",
                section === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {!leftResp || !rightResp ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Select two responses to compare
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {section === "stats" && (
            <div className="p-3 space-y-1">
              <StatRow label="Status" a={`${leftResp.status} ${leftResp.statusText}`} b={`${rightResp.status} ${rightResp.statusText}`} />
              <StatRow label="Time" a={`${leftResp.time}ms`} b={`${rightResp.time}ms`} />
              <StatRow label="Size" a={`${(leftResp.size / 1024).toFixed(1)} KB`} b={`${(rightResp.size / 1024).toFixed(1)} KB`} />
              <StatRow label="Content-Type" a={leftResp.contentType} b={rightResp.contentType} />
            </div>
          )}

          {section === "body" && (
            <DiffView left={leftResp.body} right={rightResp.body} />
          )}

          {section === "headers" && (
            <DiffView
              left={Object.entries(leftResp.headers).map(([k, v]) => `${k}: ${v}`).sort().join("\n")}
              right={Object.entries(rightResp.headers).map(([k, v]) => `${k}: ${v}`).sort().join("\n")}
            />
          )}
        </ScrollArea>
      )}
    </div>
  );
}
