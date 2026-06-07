"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConsoleLog } from "@/lib/types";

type Filter = "all" | "log" | "warn" | "error" | "request";

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

function LogEntry({ log }: { log: ConsoleLog }) {
  const isRequest = log.level === "request";
  const isResponse = log.level === "response";

  const levelStyle = {
    log: "text-foreground",
    info: "text-blue-500",
    warn: "text-yellow-500 bg-yellow-500/5",
    error: "text-red-500 bg-red-500/5",
    request: "text-blue-400",
    response: "text-green-400",
  }[log.level];

  return (
    <div className={cn("flex gap-2 px-3 py-0.5 hover:bg-muted/30 font-mono text-xs border-b border-border/30", levelStyle)}>
      <span className="text-muted-foreground/50 shrink-0 text-[10px] pt-px">{formatTime(log.timestamp)}</span>
      {isRequest && <ArrowUp className="h-3 w-3 shrink-0 mt-0.5" />}
      {isResponse && <ArrowDown className="h-3 w-3 shrink-0 mt-0.5" />}
      {!isRequest && !isResponse && (
        <span className={cn("shrink-0 text-[10px] uppercase font-bold w-8 pt-px", {
          "text-blue-400": log.level === "info",
          "text-yellow-400": log.level === "warn",
          "text-red-400": log.level === "error",
          "text-muted-foreground/50": log.level === "log",
        })}>
          {log.level}
        </span>
      )}
      <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
    </div>
  );
}

export function ConsolePanel() {
  const { consoleLogs, clearConsoleLogs, setConsoleOpen } = useAppStore();
  const [filter, setFilter] = useState<Filter>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = filter === "all"
    ? consoleLogs
    : filter === "request"
      ? consoleLogs.filter((l) => l.level === "request" || l.level === "response")
      : consoleLogs.filter((l) => l.level === filter);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [consoleLogs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 20);
  };

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "log", label: "Log" },
    { value: "warn", label: "Warn" },
    { value: "error", label: "Error" },
    { value: "request", label: "Requests" },
  ];

  const countBadge = (f: Filter) => {
    if (f === "all") return consoleLogs.length;
    if (f === "request") return consoleLogs.filter((l) => l.level === "request" || l.level === "response").length;
    return consoleLogs.filter((l) => l.level === f).length;
  };

  return (
    <div className="flex flex-col border-t bg-background" style={{ height: 220 }}>
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/10 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground px-1 mr-1">Console</span>
        {FILTERS.map((f) => {
          const count = countBadge(f.value);
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "text-xs px-2 py-0.5 rounded transition-colors",
                filter === f.value
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {f.label}
              {count > 0 && (
                <span className="ml-1 text-[9px] opacity-70">{count}</span>
              )}
            </button>
          );
        })}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          title="Clear console"
          onClick={clearConsoleLogs}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          title="Close console"
          onClick={() => setConsoleOpen(false)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No logs yet — send a request to see output here
          </div>
        ) : (
          filtered.map((log) => <LogEntry key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
}
