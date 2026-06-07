"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import { getActiveEnvVars, getMethodColor, useAppStore } from "@/lib/store";
import { executeRequest, resolveRequest } from "@/lib/http-client";
import { buildPm, runScript } from "@/lib/pm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  FunctionalRunReport,
  HttpMethod,
  PerformanceRunReport,
  PerfProgress,
  PerfStats,
  RequestRunResult,
  RunnerItem,
  TestResult,
} from "@/lib/types";

function NumInput({
  label,
  value,
  onChange,
  min,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs w-28 shrink-0 text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5 flex-1">
        <Input
          type="number"
          value={value}
          min={min ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-7 text-xs"
        />
        {suffix && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{suffix}</span>}
      </div>
    </div>
  );
}

export function RunnerPanel() {
  const {
    collections,
    requests,
    environments,
    activeEnvironmentId,
    runnerCollectionId,
    runnerMode,
    runnerItems,
    runnerPerfConfig,
    isRunnerRunning,
    pendingRerun,
    setRunnerCollectionId,
    setRunnerMode,
    setRunnerItems,
    updateRunnerPerfConfig,
    setRunReport,
    setIsRunnerRunning,
    setPerfLiveStats,
    setPendingRerun,
    setEnvironmentVariable,
  } = useAppStore();

  const [movingIndex, setMovingIndex] = useState<number | null>(null);

  const collection = collections.find((c) => c.id === runnerCollectionId);
  const envVars = getActiveEnvVars({ environments, activeEnvironmentId });

  const colRequests = runnerItems
    .map((item) => {
      const req = requests.find((r) => r.id === item.requestId);
      return req ? { req, item } : null;
    })
    .filter(Boolean) as { req: (typeof requests)[number]; item: RunnerItem }[];

  const enabledCount = runnerItems.filter((i) => i.enabled).length;

  // ── Move item up / down ────────────────────────────────────────────────────
  const moveItem = (fromIndex: number, delta: number) => {
    const toIndex = fromIndex + delta;
    if (toIndex < 0 || toIndex >= runnerItems.length) return;
    const next = [...runnerItems];
    [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
    setRunnerItems(next);
    // Briefly highlight the moved row
    setMovingIndex(toIndex);
    setTimeout(() => setMovingIndex(null), 350);
  };

  const toggleItem = (requestId: string) => {
    setRunnerItems(
      runnerItems.map((i) =>
        i.requestId === requestId ? { ...i, enabled: !i.enabled } : i
      )
    );
  };

  const toggleAll = () => {
    const allEnabled = runnerItems.every((i) => i.enabled);
    setRunnerItems(runnerItems.map((i) => ({ ...i, enabled: !allEnabled })));
  };

  // ── Run logic ───────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!collection) return;
    setIsRunnerRunning(true);
    setRunReport(null);
    setPerfLiveStats(null);

    if (runnerMode === "functional") {
      const enabled = colRequests.filter((x) => x.item.enabled);
      const startTime = Date.now();
      const results: RequestRunResult[] = [];

      for (const { req } of enabled) {
        const colVars = collection.variables ?? [];
        const activeEnv = activeEnvironmentId
          ? environments.find((e) => e.id === activeEnvironmentId)
          : null;

        try {
          // Pre-script
          const preCtx = {
            testResults: [] as TestResult[],
            headerOverrides: {} as Record<string, string>,
            variableOverrides: {} as Record<string, string>,
          };

          if (req.preScript?.trim()) {
            const preZapi = buildPm(
              preCtx,
              {
                getVar: (key) => envVars.find((v) => v.name === key)?.value,
                setVar: (key, value) => {
                  if (activeEnv) setEnvironmentVariable(activeEnv.id, key, value);
                },
              },
              Object.fromEntries(colVars.map((v) => [v.name, v.value])),
              undefined
            );
            runScript(req.preScript, preZapi);
          }

          const mergedEnvVars = [
            ...envVars,
            ...Object.entries(preCtx.variableOverrides).map(([name, value]) => ({
              id: name, name, value, enabled: true,
            })),
          ];

          const response = await executeRequest(req, colVars, mergedEnvVars, preCtx.headerOverrides);

          // Tests
          const testCtx = {
            testResults: [] as TestResult[],
            headerOverrides: {} as Record<string, string>,
            variableOverrides: {} as Record<string, string>,
          };

          if (req.tests?.trim()) {
            const testZapi = buildPm(
              testCtx,
              {
                getVar: (key) => mergedEnvVars.find((v) => v.name === key)?.value,
                setVar: (key, value) => {
                  if (activeEnv) setEnvironmentVariable(activeEnv.id, key, value);
                },
              },
              Object.fromEntries(colVars.map((v) => [v.name, v.value])),
              response
            );
            runScript(req.tests, testZapi);
          }

          const testsFailed = testCtx.testResults.some((t) => !t.passed);
          results.push({
            requestId: req.id,
            name: req.name,
            method: req.method,
            url: req.url,
            status: response.status,
            statusText: response.statusText,
            time: response.time,
            size: response.size,
            response,
            passed: response.status < 400 && !testsFailed,
            testResults: testCtx.testResults.length > 0 ? testCtx.testResults : undefined,
          });
        } catch (e) {
          results.push({
            requestId: req.id,
            name: req.name,
            method: req.method,
            url: req.url,
            error: String(e),
            passed: false,
          });
        }
      }

      const report: FunctionalRunReport = {
        id: crypto.randomUUID(),
        collectionId: collection.id,
        collectionName: collection.name,
        mode: "functional",
        startTime,
        endTime: Date.now(),
        results,
        runnerItems: runnerItems.filter((i) => i.enabled),
      };
      setRunReport(report);
    } else {
      // Performance mode
      const enabledReqList = colRequests.filter((x) => x.item.enabled);
      const enabledReqs = enabledReqList.map(({ req }) =>
        resolveRequest(req, collection.variables, envVars)
      );

      if (enabledReqs.length === 0) {
        setIsRunnerRunning(false);
        return;
      }

      const unlisten = await listen<PerfProgress>("perf:progress", (event) => {
        setPerfLiveStats(event.payload);
      });

      let stats: PerfStats | null = null;
      try {
        stats = await invoke<PerfStats>("run_performance_test", {
          config: {
            requests: enabledReqs.map((r) => ({
              url: r.url,
              method: r.method,
              headers: r.headers,
              body: r.body,
              name: r.url,
            })),
            concurrency: runnerPerfConfig.connections,
            duration_secs: runnerPerfConfig.duration,
            rate_limit: runnerPerfConfig.rateLimit,
            timeout_ms: runnerPerfConfig.timeout,
          },
        });
      } catch (e) {
        console.error("Performance test failed:", e);
      } finally {
        unlisten();
        setPerfLiveStats(null);
      }

      if (stats) {
        // JS validation pass: run each request once with pre-script + tests
        const jsTestErrors = new Array(enabledReqList.length).fill(0);
        const hasTests = enabledReqList.some(({ req }) => req.tests?.trim());

        if (hasTests) {
          const colVars = collection.variables ?? [];
          const activeEnv = activeEnvironmentId
            ? environments.find((e) => e.id === activeEnvironmentId)
            : null;

          for (let i = 0; i < enabledReqList.length; i++) {
            const { req } = enabledReqList[i];
            if (!req.tests?.trim()) continue;

            try {
              const preCtx = {
                testResults: [] as TestResult[],
                headerOverrides: {} as Record<string, string>,
                variableOverrides: {} as Record<string, string>,
              };

              if (req.preScript?.trim()) {
                const preZapi = buildPm(
                  preCtx,
                  {
                    getVar: (key) => envVars.find((v) => v.name === key)?.value,
                    setVar: (key, value) => {
                      if (activeEnv) setEnvironmentVariable(activeEnv.id, key, value);
                    },
                  },
                  Object.fromEntries(colVars.map((v) => [v.name, v.value])),
                  undefined
                );
                runScript(req.preScript, preZapi);
              }

              const mergedEnvVars = [
                ...envVars,
                ...Object.entries(preCtx.variableOverrides).map(([name, value]) => ({
                  id: name, name, value, enabled: true,
                })),
              ];

              const response = await executeRequest(req, colVars, mergedEnvVars, preCtx.headerOverrides);

              const testCtx = {
                testResults: [] as TestResult[],
                headerOverrides: {} as Record<string, string>,
                variableOverrides: {} as Record<string, string>,
              };
              const testZapi = buildPm(
                testCtx,
                {
                  getVar: (key) => mergedEnvVars.find((v) => v.name === key)?.value,
                  setVar: (key, value) => {
                    if (activeEnv) setEnvironmentVariable(activeEnv.id, key, value);
                  },
                },
                Object.fromEntries(colVars.map((v) => [v.name, v.value])),
                response
              );
              runScript(req.tests, testZapi);

              // Any assertion failure = 1 error for this request type
              if (testCtx.testResults.some((t) => !t.passed)) {
                jsTestErrors[i] = 1;
              }
            } catch {
              // Validation errors don't affect perf stats
            }
          }
        }

        const totalJsErrors = jsTestErrors.reduce((a, b) => a + b, 0);
        const updatedPerRequest = stats.perRequest.map((pr, i) => ({
          ...pr,
          name: enabledReqList[i]?.req.name ?? pr.name,
          errors: pr.errors + jsTestErrors[i],
        }));

        const report: PerformanceRunReport = {
          id: crypto.randomUUID(),
          mode: "performance",
          startTime: Date.now() - stats.durationMs,
          stats: {
            ...stats,
            errors: stats.errors + totalJsErrors,
            perRequest: updatedPerRequest,
          },
          runnerItems: runnerItems.filter((i) => i.enabled),
        };
        setRunReport(report);
      }
    }

    setIsRunnerRunning(false);
  };

  // Watch for pending rerun triggered from RunnerReport
  useEffect(() => {
    if (pendingRerun) {
      setPendingRerun(false);
      handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRerun]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Runner
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3 border-b">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Collection</Label>
          <Select
            value={runnerCollectionId ?? ""}
            onValueChange={(v) => setRunnerCollectionId(v || null)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Select collection…" />
            </SelectTrigger>
            <SelectContent>
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Mode</Label>
          <div className="flex rounded-md border overflow-hidden">
            {(["functional", "performance"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRunnerMode(m)}
                className={cn(
                  "flex-1 text-xs py-1.5 transition-colors capitalize",
                  runnerMode === m
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-muted-foreground"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {!collection ? (
          <div className="text-center py-10 text-xs text-muted-foreground">
            Select a collection to start
          </div>
        ) : (
          <div className="p-2">
            {/* Select-all header */}
            <div className="flex items-center gap-1.5 px-1 py-1 mb-1">
              <button
                type="button"
                onClick={toggleAll}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {enabledCount === runnerItems.length && runnerItems.length > 0 ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
              </button>
              <span className="text-xs text-muted-foreground">
                {enabledCount} / {runnerItems.length} selected
              </span>
            </div>

            {colRequests.map(({ req, item }, index) => (
              <div
                key={req.id}
                className={cn(
                  "flex items-center gap-1.5 px-1 py-1.5 rounded text-xs group select-none transition-all",
                  movingIndex === index ? "bg-primary/10" : "hover:bg-muted/30",
                  !item.enabled && "opacity-40"
                )}
              >
                {/* Up / Down order buttons */}
                <div className="flex flex-col shrink-0">
                  <button
                    type="button"
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    className="h-3.5 w-3.5 flex items-center justify-center text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, 1)}
                    disabled={index === colRequests.length - 1}
                    className="h-3.5 w-3.5 flex items-center justify-center text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => toggleItem(req.id)}
                  className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                >
                  {item.enabled ? (
                    <CheckSquare className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                </button>
                <span className={cn("text-[10px] font-bold w-10 shrink-0", getMethodColor(req.method as HttpMethod))}>
                  {req.method}
                </span>
                <span className="truncate flex-1 text-xs">{req.name}</span>
              </div>
            ))}

            {colRequests.length === 0 && (
              <div className="text-center py-6 text-xs text-muted-foreground">
                No requests in this collection
              </div>
            )}

            {/* Performance params */}
            {runnerMode === "performance" && (
              <div className="mt-3 pt-3 border-t space-y-2">
                <span className="text-xs text-muted-foreground font-medium">Load Test Config</span>
                <NumInput
                  label="Connections"
                  value={runnerPerfConfig.connections}
                  onChange={(v) => updateRunnerPerfConfig({ connections: Math.max(1, v) })}
                  min={1}
                />
                <NumInput
                  label="Duration"
                  value={runnerPerfConfig.duration}
                  onChange={(v) => updateRunnerPerfConfig({ duration: Math.max(1, v) })}
                  min={1}
                  suffix="seconds"
                />
                <NumInput
                  label="Rate Limit"
                  value={runnerPerfConfig.rateLimit}
                  onChange={(v) => updateRunnerPerfConfig({ rateLimit: Math.max(0, v) })}
                  min={0}
                  suffix="req/s (0=∞)"
                />
                <NumInput
                  label="Timeout"
                  value={runnerPerfConfig.timeout}
                  onChange={(v) => updateRunnerPerfConfig({ timeout: Math.max(100, v) })}
                  min={100}
                  suffix="ms"
                />
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="p-3 border-t">
        <Button
          className="w-full gap-2 transition-all"
          size="sm"
          disabled={isRunnerRunning || !collection || enabledCount === 0}
          onClick={handleRun}
        >
          {isRunnerRunning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Run {runnerMode === "performance" ? "Load Test" : "Collection"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
