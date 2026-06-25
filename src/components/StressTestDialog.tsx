"use client";

/**
 * Single-Request Stress Test dialog.
 * Opens from the ▾ dropdown next to the Send button.
 *
 * Config: connections (concurrency) · total requests OR duration · rate-limit · timeout
 * Runs concurrent fetch requests via executeRequest, collects latency samples,
 * and shows real-time RPS / avg latency / error count + a mini-chart.
 * Results shown after completion with percentiles and status-code distribution.
 */

import { useState, useRef, useCallback } from "react";
import {
  X, Play, Square, Gauge, AlertCircle, CheckCircle2,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { useAppStore, getActiveEnvVars } from "@/lib/store";
import { executeRequest } from "@/lib/http-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StressTestConfig, StressTestResult, StressTestSample } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Percentile helper ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Mini bar chart ────────────────────────────────────────────────────────────

function MiniChart({ samples }: { samples: StressTestSample[] }) {
  if (samples.length < 2) return null;

  // Downsample to 60 buckets
  const BUCKETS = 60;
  const step   = Math.ceil(samples.length / BUCKETS);
  const buckets: { rps: number; avgMs: number; errors: number }[] = [];

  for (let i = 0; i < samples.length; i += step) {
    const slice = samples.slice(i, i + step);
    const ok    = slice.filter((s) => !s.error);
    const durationSec = step > 0 ? (slice[slice.length - 1].timestamp - slice[0].timestamp + 1) / 1000 : 1;
    buckets.push({
      rps:    ok.length / Math.max(durationSec, 0.001),
      avgMs:  ok.length ? ok.reduce((a, b) => a + b.latency, 0) / ok.length : 0,
      errors: slice.filter((s) => !!s.error).length,
    });
  }

  const maxRps = Math.max(...buckets.map((b) => b.rps), 1);

  return (
    <div className="flex items-end gap-px h-12 w-full mt-2">
      {buckets.map((b, i) => (
        <div
          key={i}
          className={cn(
            "flex-1 min-w-0 rounded-t-sm transition-all",
            b.errors > 0 ? "bg-red-400/70" : "bg-primary/60"
          )}
          style={{ height: `${Math.max(2, (b.rps / maxRps) * 100)}%` }}
          title={`RPS: ${b.rps.toFixed(1)}  Avg: ${Math.round(b.avgMs)}ms  Errors: ${b.errors}`}
        />
      ))}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center bg-muted/30 rounded-lg px-3 py-2 min-w-0">
      <span className={cn("text-lg font-bold tabular-nums leading-tight", color ?? "text-foreground")}>{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {sub && <span className="text-[9px] text-muted-foreground/60">{sub}</span>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StressTestDialog({ onClose }: { onClose: () => void }) {
  const { activeRequestId, requests, collections, environments, activeEnvironmentId } = useAppStore();
  const request  = requests.find((r) => r.id === activeRequestId);
  const envVars  = getActiveEnvVars({ environments, activeEnvironmentId });
  const colVars  = collections.find((c) => c.id === request?.collectionId)?.variables ?? [];

  const [config, setConfig] = useState<StressTestConfig>({
    connections: 10,
    duration: 10,
    totalRequests: 0,
    rateLimit: 0,
    timeout: 5000,
  });

  const [running, setRunning]       = useState(false);
  const [result,  setResult]        = useState<StressTestResult | null>(null);
  const [live,    setLive]          = useState({ total: 0, rps: 0, avgMs: 0, errors: 0, elapsed: 0 });
  const [showConfig, setShowConfig] = useState(true);

  const abortRef     = useRef(false);
  const samplesRef   = useRef<StressTestSample[]>([]);
  const startTimeRef = useRef(0);

  const run = useCallback(async () => {
    if (!request) return;

    abortRef.current   = false;
    samplesRef.current = [];
    startTimeRef.current = Date.now();
    setRunning(true);
    setResult(null);
    setShowConfig(false);

    const useDuration  = config.duration > 0 && config.totalRequests === 0;
    const endTime      = useDuration ? startTimeRef.current + config.duration * 1000 : Infinity;
    const maxRequests  = !useDuration ? config.totalRequests : Infinity;
    const minInterval  = config.rateLimit > 0 ? 1000 / config.rateLimit : 0;

    let completedTotal = 0;
    let lastLiveUpdate = Date.now();

    // Semaphore-based concurrency pool
    const semaphore = { active: 0 };

    const doRequest = async (): Promise<void> => {
      if (abortRef.current) return;
      semaphore.active++;
      const t0 = Date.now();

      try {
        const res = await executeRequest(request, colVars, envVars, {});
        const latency = Date.now() - t0;
        samplesRef.current.push({ timestamp: t0, latency, status: res.status });
      } catch {
        const latency = Date.now() - t0;
        samplesRef.current.push({ timestamp: t0, latency, status: 0, error: "network" });
      } finally {
        semaphore.active--;
        completedTotal++;
      }

      // Live stats update (max 4/s)
      if (Date.now() - lastLiveUpdate > 250) {
        lastLiveUpdate = Date.now();
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const ok    = samplesRef.current.filter((s) => !s.error);
        const rps   = elapsed > 0 ? completedTotal / elapsed : 0;
        const avgMs = ok.length ? ok.reduce((a, b) => a + b.latency, 0) / ok.length : 0;
        setLive({ total: completedTotal, rps, avgMs, errors: samplesRef.current.filter((s) => s.error).length, elapsed });
      }
    };

    // Drive the request loop
    const runLoop = async () => {
      while (!abortRef.current) {
        const elapsed = Date.now() - startTimeRef.current;
        if (useDuration && Date.now() >= endTime) break;
        if (!useDuration && completedTotal >= maxRequests) break;

        // Wait if at concurrency limit
        if (semaphore.active >= config.connections) {
          await new Promise((r) => setTimeout(r, 10));
          continue;
        }

        // Rate limit
        if (minInterval > 0) {
          const expectedTotal = Math.floor(elapsed / minInterval);
          if (completedTotal + semaphore.active > expectedTotal) {
            await new Promise((r) => setTimeout(r, 10));
            continue;
          }
        }

        void doRequest();
      }

      // Wait for all in-flight requests to complete
      while (semaphore.active > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    await runLoop();

    // Compute final stats
    const samples = samplesRef.current;
    const durationMs = Date.now() - startTimeRef.current;
    const ok = samples.filter((s) => !s.error);
    const latencies = ok.map((s) => s.latency).sort((a, b) => a - b);
    const statusCodes: Record<string, number> = {};
    for (const s of samples) {
      const key = String(s.status || "error");
      statusCodes[key] = (statusCodes[key] ?? 0) + 1;
    }

    // Downsample samples for display
    const MAX_DISPLAY = 500;
    const displaySamples = samples.length > MAX_DISPLAY
      ? samples.filter((_, i) => i % Math.ceil(samples.length / MAX_DISPLAY) === 0)
      : samples;

    const finalResult: StressTestResult = {
      total: samples.length,
      success: ok.length,
      errors: samples.length - ok.length,
      rps: samples.length / (durationMs / 1000),
      avgLatency: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      minLatency: latencies[0] ?? 0,
      maxLatency: latencies[latencies.length - 1] ?? 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      durationMs,
      statusCodes,
      samples: displaySamples,
    };

    setResult(finalResult);
    setRunning(false);
  }, [request, config, envVars, colVars]);

  const stop = () => { abortRef.current = true; };

  if (!request) return null;

  const successRate = result
    ? ((result.success / Math.max(result.total, 1)) * 100).toFixed(1)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-background border rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Stress Test</span>
            <span className="text-xs text-muted-foreground font-mono">
              {request.method} {request.url.length > 40 ? "…" + request.url.slice(-38) : request.url}
            </span>
          </div>
          <button onClick={onClose} className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">

            {/* Config section */}
            <div>
              <button
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground mb-3"
                onClick={() => setShowConfig((v) => !v)}
              >
                {showConfig ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Configuration
              </button>

              {showConfig && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Concurrent Connections</Label>
                    <Input
                      type="number" min={1} max={200}
                      value={config.connections}
                      onChange={(e) => setConfig((c) => ({ ...c, connections: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">Parallel requests at a time (1–200)</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Duration (seconds)</Label>
                    <Input
                      type="number" min={0}
                      value={config.duration}
                      onChange={(e) => setConfig((c) => ({ ...c, duration: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">0 = use total requests instead</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Total Requests</Label>
                    <Input
                      type="number" min={0}
                      value={config.totalRequests}
                      onChange={(e) => setConfig((c) => ({ ...c, totalRequests: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">0 = use duration instead</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Rate Limit (req/s)</Label>
                    <Input
                      type="number" min={0}
                      value={config.rateLimit}
                      onChange={(e) => setConfig((c) => ({ ...c, rateLimit: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">0 = no limit (max speed)</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Timeout (ms)</Label>
                    <Input
                      type="number" min={100}
                      value={config.timeout}
                      onChange={(e) => setConfig((c) => ({ ...c, timeout: Math.max(100, parseInt(e.target.value) || 5000) }))}
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">Per-request timeout</p>
                  </div>

                  <div className="flex items-end">
                    <div className="p-2 rounded bg-muted/30 text-[10px] text-muted-foreground w-full">
                      <span className="font-medium">Mode: </span>
                      {config.duration > 0 && config.totalRequests === 0
                        ? `Run for ${config.duration}s`
                        : config.totalRequests > 0
                        ? `Send ${config.totalRequests} total requests`
                        : "Set duration or total requests"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Live stats during run */}
            {running && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-muted-foreground">Running…</span>
                  <span className="text-xs text-muted-foreground">{live.elapsed.toFixed(1)}s elapsed</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <StatCard label="Total" value={String(live.total)} />
                  <StatCard label="RPS" value={live.rps.toFixed(1)} color="text-primary" />
                  <StatCard label="Avg Latency" value={formatMs(live.avgMs)} />
                  <StatCard label="Errors" value={String(live.errors)} color={live.errors > 0 ? "text-red-500" : undefined} />
                </div>
                <MiniChart samples={samplesRef.current} />
              </div>
            )}

            {/* Final results */}
            {result && !running && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {result.errors === 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : result.errors === result.total ? (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                  )}
                  <span className="text-sm font-medium">
                    {result.errors === 0 ? "All requests succeeded" :
                     result.errors === result.total ? "All requests failed" :
                     `${result.success} succeeded, ${result.errors} failed`}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    Duration: {formatMs(result.durationMs)}
                  </span>
                </div>

                {/* Key metrics */}
                <div className="grid grid-cols-4 gap-2">
                  <StatCard label="Total Reqs" value={String(result.total)} />
                  <StatCard label="RPS" value={result.rps.toFixed(1)} color="text-primary" />
                  <StatCard label="Success Rate" value={`${successRate}%`} color={parseFloat(successRate ?? "0") >= 99 ? "text-green-500" : "text-yellow-500"} />
                  <StatCard label="Errors" value={String(result.errors)} color={result.errors > 0 ? "text-red-500" : "text-green-500"} />
                </div>

                {/* Latency percentiles */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Latency Percentiles</p>
                  <div className="grid grid-cols-5 gap-2">
                    <StatCard label="Min" value={formatMs(result.minLatency)} />
                    <StatCard label="P50" value={formatMs(result.p50)} />
                    <StatCard label="Avg" value={formatMs(result.avgLatency)} />
                    <StatCard label="P95" value={formatMs(result.p95)} />
                    <StatCard label="P99" value={formatMs(result.p99)} color={result.p99 > 1000 ? "text-red-500" : result.p99 > 500 ? "text-yellow-500" : "text-green-500"} />
                  </div>
                </div>

                {/* Status codes */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Status Codes</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(result.statusCodes)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([code, count]) => (
                        <div
                          key={code}
                          className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium",
                            code === "0" || code === "error" ? "bg-red-500/15 text-red-700 dark:text-red-400" :
                            code.startsWith("2") ? "bg-green-500/15 text-green-700 dark:text-green-400" :
                            code.startsWith("3") ? "bg-blue-500/15 text-blue-700 dark:text-blue-400" :
                            code.startsWith("4") ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" :
                            "bg-red-500/15 text-red-700 dark:text-red-400"
                          )}
                        >
                          <span>{code === "0" ? "ERR" : code}</span>
                          <span className="opacity-70">×{count}</span>
                          <span className="opacity-50">({((count / result.total) * 100).toFixed(0)}%)</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Mini chart */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Throughput Over Time</p>
                  <MiniChart samples={result.samples} />
                  <p className="text-[10px] text-muted-foreground mt-1">Each bar = relative RPS. Red = errors.</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <div className="text-xs text-muted-foreground">
            {running ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Running stress test…
              </span>
            ) : result ? (
              `Completed — ${result.total} requests in ${formatMs(result.durationMs)}`
            ) : (
              "Configure and run the stress test"
            )}
          </div>
          <div className="flex gap-2">
            {running ? (
              <Button variant="destructive" size="sm" className="gap-1.5 h-8" onClick={stop}>
                <Square className="h-3.5 w-3.5 fill-current" /> Stop
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Close</Button>
                <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={run} disabled={!request.url}>
                  <Play className="h-3.5 w-3.5 fill-current" /> Run Test
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
