"use client";

import { useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Clock,
  Play,
  XCircle,
  Zap,
} from "lucide-react";
import { getMethodColor, useAppStore } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  FunctionalRunReport,
  HttpMethod,
  PerformanceRunReport,
  PerRequestStats,
  RequestRunResult,
} from "@/lib/types";

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function StatusBadge({ status }: { status?: number }) {
  if (!status) return <span className="text-destructive text-xs font-mono">Error</span>;
  const color =
    status < 300
      ? "text-green-600 dark:text-green-400"
      : status < 400
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";
  return <span className={cn("text-xs font-mono font-bold", color)}>{status}</span>;
}

function StatCard({
  label,
  value,
  sub,
  highlight,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="border rounded-xl p-3 text-center bg-card hover:bg-accent/30 transition-colors">
      <div className={cn(
        "text-xl font-bold tracking-tight",
        highlight && "text-primary",
        danger && "text-red-500"
      )}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{sub}</div>}
      <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider font-medium">{label}</div>
    </div>
  );
}

// ── Live stats display (shown while performance test is running) ──────────────

function LiveStatsDisplay() {
  const { perfLiveStats, runnerPerfConfig } = useAppStore();
  const stats = perfLiveStats;

  const elapsedPct = stats
    ? Math.min(100, (stats.elapsedMs / (runnerPerfConfig.duration * 1000)) * 100)
    : 0;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="flex items-center gap-3 text-primary">
        <Activity className="h-5 w-5 animate-pulse" />
        <span className="text-sm font-medium">Load test in progress…</span>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md">
        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
          <span>{stats ? (stats.elapsedMs / 1000).toFixed(1) : "0"}s elapsed</span>
          <span>{runnerPerfConfig.duration}s total</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${elapsedPct}%` }}
          />
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3 w-full max-w-md">
          <StatCard
            label="Req/s"
            value={stats.requestsPerSec.toFixed(1)}
            highlight
          />
          <StatCard
            label="Requests"
            value={stats.requestsTotal.toLocaleString()}
          />
          <StatCard
            label="Errors"
            value={stats.errors.toLocaleString()}
            danger={stats.errors > 0}
          />
          <StatCard
            label="Avg Latency"
            value={fmtMs(stats.avgLatencyMs)}
          />
          <StatCard
            label="Throughput"
            value={fmtBytes(stats.bytesPerSec) + "/s"}
          />
          <StatCard
            label="Error Rate"
            value={stats.requestsTotal > 0
              ? `${((stats.errors / stats.requestsTotal) * 100).toFixed(1)}%`
              : "0%"}
            danger={stats.errors > 0}
          />
        </div>
      )}
    </div>
  );
}

// ── Functional report ─────────────────────────────────────────────────────────

function ResponseDetailDialog({
  result,
  open,
  onClose,
}: {
  result: RequestRunResult;
  open: boolean;
  onClose: () => void;
}) {
  const hasTests = result.testResults && result.testResults.length > 0;
  const [tab, setTab] = useState<"body" | "headers" | "tests">("body");
  const { response } = result;

  const tabs = [
    { id: "body" as const, label: "Body" },
    { id: "headers" as const, label: "Headers" },
    ...(hasTests ? [{ id: "tests" as const, label: "Tests" }] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="text-sm flex items-center gap-2">
            <span className={cn("text-[11px] font-bold", getMethodColor(result.method as HttpMethod))}>
              {result.method}
            </span>
            {result.name}
          </DialogTitle>
        </DialogHeader>

        {/* Status bar */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono px-4 py-2 border-b bg-muted/20 shrink-0">
          {response ? (
            <>
              <StatusBadge status={response.status} />
              <span>{response.statusText}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{response.time} ms</span>
              <span>{fmtBytes(response.size)}</span>
              {hasTests && (
                <span className={cn(
                  "ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full",
                  result.testResults!.every(t => t.passed)
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-red-500/15 text-red-600 dark:text-red-400"
                )}>
                  {result.testResults!.filter(t => t.passed).length}/{result.testResults!.length} tests
                </span>
              )}
            </>
          ) : (
            <span className="text-destructive">{result.error}</span>
          )}
        </div>

        {response && (
          <>
            {/* Tab bar */}
            <div className="flex border-b shrink-0">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "text-xs px-4 py-2 border-b-2 transition-colors",
                    tab === t.id
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Scrollable content */}
            <ScrollArea className="flex-1 min-h-0">
              {tab === "body" && (
                <pre className="text-xs font-mono p-4 whitespace-pre-wrap break-all leading-relaxed">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(response.body), null, 2); }
                    catch { return response.body; }
                  })()}
                </pre>
              )}
              {tab === "headers" && (
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(response.headers).map(([k, v]) => (
                      <tr key={k} className="border-b hover:bg-muted/30">
                        <td className="px-4 py-1.5 font-mono text-blue-600 dark:text-blue-400 w-52 shrink-0">{k}</td>
                        <td className="px-4 py-1.5 font-mono break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "tests" && result.testResults && (
                <div className="p-4 space-y-2">
                  {result.testResults.map((t, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-3 px-3 py-2.5 rounded-lg border text-xs",
                        t.passed
                          ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900"
                          : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                      )}
                    >
                      {t.passed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                        : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                      <div>
                        <p className="font-medium">{t.name}</p>
                        {t.error && <p className="text-muted-foreground mt-0.5 font-mono">{t.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FunctionalReport({ report }: { report: FunctionalRunReport }) {
  const { setRunReport, setRunnerItems, setRunnerCollectionId, setPendingRerun } = useAppStore();
  const [detail, setDetail] = useState<RequestRunResult | null>(null);

  const handleRerun = () => {
    setRunnerCollectionId(report.collectionId);
    setRunnerItems(report.runnerItems);
    setRunReport(null);
    setPendingRerun(true);
  };

  const passed = report.results.filter((r) => r.passed).length;
  const failed = report.results.length - passed;
  const totalTime = report.endTime - report.startTime;
  const passRate = report.results.length
    ? Math.round((passed / report.results.length) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Summary */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/10">
        <div className="text-xs font-medium text-muted-foreground">{report.collectionName}</div>
        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="text-sm font-bold">{passed}</span>
          <span className="text-xs">passed</span>
        </div>
        <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
          <XCircle className="h-3.5 w-3.5" />
          <span className="text-sm font-bold">{failed}</span>
          <span className="text-xs">failed</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span className="text-xs">{totalTime} ms</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">{passRate}% pass rate</span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleRerun}>
            <Play className="h-3 w-3" /> Rerun
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted/50 flex">
        <div
          className="bg-green-500 h-full transition-all"
          style={{ width: `${passRate}%` }}
        />
      </div>

      <ScrollArea className="flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2 w-6" />
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-3 py-2 w-16">Status</th>
              <th className="text-right px-4 py-2 w-20">Time</th>
              <th className="text-right px-4 py-2 w-20">Size</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {report.results.map((r) => (
              <tr
                key={r.requestId}
                className="border-b hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => setDetail(r)}
              >
                <td className="px-4 py-2.5 w-6">
                  {r.passed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-bold shrink-0", getMethodColor(r.method as HttpMethod))}>
                      {r.method}
                    </span>
                    <span className="font-medium">{r.name}</span>
                    {r.testResults && r.testResults.length > 0 && (
                      <span className={cn(
                        "text-[9px] font-semibold px-1.5 py-0.5 rounded-full",
                        r.testResults.every(t => t.passed)
                          ? "bg-green-500/15 text-green-600 dark:text-green-400"
                          : "bg-red-500/15 text-red-600 dark:text-red-400"
                      )}>
                        {r.testResults.filter(t => t.passed).length}/{r.testResults.length} tests
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-sm">
                    {r.error ?? r.url}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                  {r.time != null ? `${r.time}ms` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                  {r.size != null ? fmtBytes(r.size) : "—"}
                </td>
                <td className="pr-4 py-2.5">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      {detail && (
        <ResponseDetailDialog result={detail} open onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

// ── Performance report ─────────────────────────────────────────────────────────

function PerRequestTable({ rows }: { rows: PerRequestStats[] }) {
  if (rows.length <= 1) return null;
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="bg-muted/40 px-4 py-2 text-xs font-semibold">Per-Request Breakdown</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-t text-muted-foreground text-[10px] uppercase tracking-wider">
            <th className="text-left px-4 py-2">Request</th>
            <th className="text-right px-4 py-2">Count</th>
            <th className="text-right px-4 py-2">Errors</th>
            <th className="text-right px-4 py-2">Avg</th>
            <th className="text-right px-4 py-2">p99</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2 font-medium truncate max-w-[200px]">{r.name}</td>
              <td className="px-4 py-2 text-right font-mono">{r.requestsTotal.toLocaleString()}</td>
              <td className={cn("px-4 py-2 text-right font-mono", r.errors > 0 && "text-red-500")}>
                {r.errors.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right font-mono">{fmtMs(r.avgLatencyMs)}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtMs(r.p99Ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerformanceReport({ report }: { report: PerformanceRunReport }) {
  const { setRunReport, setRunnerItems, setRunnerCollectionId, setPendingRerun } = useAppStore();

  const handleRerun = () => {
    setRunnerItems(report.runnerItems);
    setRunReport(null);
    setPendingRerun(true);
  };
  const { stats } = report;

  const latencyRows = [
    { label: "Min", value: stats.minLatencyMs },
    { label: "Average", value: stats.avgLatencyMs },
    { label: "p50 (median)", value: stats.p50Ms },
    { label: "p75", value: stats.p75Ms },
    { label: "p90", value: stats.p90Ms },
    { label: "p99", value: stats.p99Ms },
    { label: "p99.9", value: stats.p999Ms },
    { label: "Max", value: stats.maxLatencyMs },
  ];

  const errorRate = stats.requestsTotal
    ? ((stats.errors / stats.requestsTotal) * 100).toFixed(2)
    : "0";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-muted/10">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium">Load Test Report</span>
        <span className="text-xs text-muted-foreground">
          {(stats.durationMs / 1000).toFixed(1)}s · {stats.requestsTotal.toLocaleString()} requests
        </span>
        <div className="ml-auto">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleRerun}>
            <Play className="h-3 w-3" /> Rerun
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4 max-w-2xl">
          {/* Top stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Requests/sec" value={stats.requestsPerSec.toFixed(2)} highlight />
            <StatCard label="Total Requests" value={stats.requestsTotal.toLocaleString()} />
            <StatCard label="Errors" value={stats.errors.toLocaleString()} sub={`${errorRate}% rate`} danger={stats.errors > 0} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Avg Latency" value={fmtMs(stats.avgLatencyMs)} />
            <StatCard label="Data Transferred" value={fmtBytes(stats.bytesTotal)} />
            <StatCard label="Throughput" value={fmtBytes(stats.bytesPerSec) + "/s"} />
          </div>

          {/* Latency distribution */}
          <div className="border rounded-xl overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 text-xs font-semibold">Latency Distribution</div>
            <table className="w-full">
              <tbody>
                {latencyRows.map(({ label, value }) => (
                  <tr key={label} className="border-t hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 text-xs text-muted-foreground w-28">{label}</td>
                    <td className="px-4 py-2 text-xs font-mono font-medium text-right">
                      {fmtMs(value)}
                    </td>
                    <td className="px-4 py-2 w-48">
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/70 rounded-full transition-all"
                          style={{
                            width: `${stats.maxLatencyMs > 0 ? Math.min(100, (value / stats.maxLatencyMs) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-request table */}
          <PerRequestTable rows={stats.perRequest ?? []} />

          {/* Status codes */}
          {Object.keys(stats.statusCodes).length > 0 && (
            <div className="border rounded-xl overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 text-xs font-semibold">Status Codes</div>
              <table className="w-full">
                <tbody>
                  {Object.entries(stats.statusCodes)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([code, count]) => {
                      const pct = stats.requestsTotal
                        ? ((count / stats.requestsTotal) * 100).toFixed(1)
                        : "0";
                      const color =
                        Number(code) < 300
                          ? "text-green-600 dark:text-green-400"
                          : Number(code) < 400
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-red-600 dark:text-red-400";
                      return (
                        <tr key={code} className="border-t hover:bg-muted/20 transition-colors">
                          <td className={cn("px-4 py-2 text-xs font-mono font-bold w-16", color)}>
                            {code}
                          </td>
                          <td className="px-4 py-2 text-xs font-mono text-right">
                            {count.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground text-right w-16">
                            {pct}%
                          </td>
                          <td className="px-4 py-2 w-40">
                            <div className="h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-muted-foreground/40 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function RunnerReport() {
  const { runReport, isRunnerRunning, runnerMode, perfLiveStats } = useAppStore();

  if (isRunnerRunning) {
    if (runnerMode === "performance") {
      return <LiveStatsDisplay />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <div className="relative">
          <Play className="h-12 w-12 opacity-10" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-2.5 w-2.5 rounded-full bg-primary animate-ping" />
          </div>
        </div>
        <p className="text-sm">Running collection…</p>
      </div>
    );
  }

  if (!runReport) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Play className="h-12 w-12 opacity-10" />
        <div className="text-center">
          <p className="text-sm font-medium">Ready to run</p>
          <p className="text-xs mt-1 text-muted-foreground/70">
            Select a collection in the Runner panel and click Run
          </p>
        </div>
      </div>
    );
  }

  if (runReport.mode === "functional") {
    return <FunctionalReport report={runReport} />;
  }
  return <PerformanceReport report={runReport} />;
}
