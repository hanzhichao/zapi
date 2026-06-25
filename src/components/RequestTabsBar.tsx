"use client";

import { useState } from "react";
import { ChevronDown, TerminalSquare, X } from "lucide-react";
import type { LayoutMode } from "@/lib/types";
import { getMethodColor, useAppStore } from "@/lib/store";
import { EnvironmentManager } from "@/components/EnvironmentManager";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ApiRequest, HttpMethod } from "@/lib/types";

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  vertical: "上下分割", horizontal: "左右分割", hidden: "隐藏响应", fullscreen: "全屏响应",
};

export function LayoutCycleIcon({ mode }: { mode: LayoutMode }) {
  if (mode === "vertical") return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
      <rect x="1" y="1" width="12" height="5" rx="1.5" fill="currentColor" opacity="0.85" />
      <rect x="1" y="8" width="12" height="5" rx="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
  if (mode === "horizontal") return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
      <rect x="1" y="1" width="5" height="12" rx="1.5" fill="currentColor" opacity="0.85" />
      <rect x="8" y="1" width="5" height="12" rx="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
  if (mode === "hidden") return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
      <rect x="1" y="1" width="12" height="12" rx="1.5" fill="currentColor" opacity="0.85" />
      <line x1="1" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
    </svg>
  );
  // fullscreen
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
      <rect x="1" y="1" width="12" height="12" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

function getTabBadge(req: ApiRequest): { label: string; className: string } {
  const proto = req.protocol;
  if (proto === "websocket") return { label: "WS",   className: "text-green-500" };
  if (proto === "graphql")   return { label: "GQL",  className: "text-pink-500" };
  if (proto === "grpc")      return { label: "gRPC", className: "text-purple-500" };
  if (proto === "soap")      return { label: "SOAP", className: "text-orange-400" };
  return { label: req.method, className: getMethodColor(req.method as HttpMethod) };
}

export function RequestTabsBar() {
  const {
    openRequestIds,
    activeRequestId,
    requests,
    environments,
    activeEnvironmentId,
    setActiveRequest,
    closeRequest,
    layoutMode,
    setLayoutMode,
    setActiveEnvironment,
    consoleOpen,
    setConsoleOpen,
  } = useAppStore();

  const [envManagerOpen, setEnvManagerOpen] = useState(false);

  const activeEnv = environments.find((e) => e.id === activeEnvironmentId);

  return (
    <>
      <div className="flex items-center border-b bg-muted/10 min-h-0">
        {/* Tabs */}
        <div className="flex items-center flex-1 overflow-x-auto scrollbar-none min-w-0">
          {openRequestIds.length === 0 ? (
            <div className="px-4 py-2 text-xs text-muted-foreground/50 italic select-none">
              No open requests
            </div>
          ) : (
            openRequestIds.map((id) => {
              const req = requests.find((r) => r.id === id);
              if (!req) return null;
              const isActive = activeRequestId === id;

              return (
                <div
                  key={id}
                  className={cn(
                    "group flex items-center gap-1.5 px-3 py-2 border-r cursor-pointer min-w-0 max-w-44 shrink-0 transition-colors",
                    isActive
                      ? "bg-background border-b-2 border-b-primary -mb-px text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                  onClick={() => setActiveRequest(id)}
                >
                  {(() => { const b = getTabBadge(req); return (
                    <span className={cn("text-[10px] font-bold shrink-0", b.className)}>
                      {b.label}
                    </span>
                  ); })()}
                  <span className="text-xs truncate flex-1">{req.name}</span>
                  <button
                    className="h-3.5 w-3.5 shrink-0 rounded-sm opacity-0 group-hover:opacity-60 hover:!opacity-100 flex items-center justify-center hover:bg-muted-foreground/20 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeRequest(id);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Toolbar: Environment + Layout */}
        <div className="flex items-center gap-1 px-2 shrink-0 border-l">
          {/* Environment selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 text-xs gap-1 max-w-36 font-normal",
                  activeEnv ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  activeEnv ? "bg-green-500" : "bg-muted-foreground/40"
                )} />
                <span className="truncate">{activeEnv?.name ?? "No Environment"}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                className={cn("text-xs", !activeEnvironmentId && "text-primary")}
                onClick={() => setActiveEnvironment(null)}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full mr-2", !activeEnvironmentId ? "bg-primary" : "bg-muted")} />
                No Environment
              </DropdownMenuItem>
              {environments.map((env) => (
                <DropdownMenuItem
                  key={env.id}
                  className={cn("text-xs", activeEnvironmentId === env.id && "text-primary")}
                  onClick={() => setActiveEnvironment(env.id)}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full mr-2", activeEnvironmentId === env.id ? "bg-primary" : "bg-muted")} />
                  <span className="flex-1 truncate">{env.name}</span>
                  <span className="text-muted-foreground ml-2">{env.variables.length}v</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs" onClick={() => setEnvManagerOpen(true)}>
                Manage Environments…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Console toggle */}
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", consoleOpen ? "text-primary" : "text-muted-foreground hover:text-foreground")}
            title="Toggle Console"
            onClick={() => setConsoleOpen(!consoleOpen)}
          >
            <TerminalSquare className="h-3.5 w-3.5" />
          </Button>

          {/* Layout cycle button — vertical → horizontal → hidden → fullscreen */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title={`布局: ${LAYOUT_LABELS[layoutMode]} → 点击切换`}
            onClick={() => {
              const cycle: LayoutMode[] = ["vertical", "horizontal", "hidden", "fullscreen"];
              const idx = cycle.indexOf(layoutMode as LayoutMode);
              setLayoutMode(cycle[(idx + 1) % cycle.length]);
            }}
          >
            <LayoutCycleIcon mode={layoutMode as LayoutMode} />
          </Button>
        </div>
      </div>

      <EnvironmentManager open={envManagerOpen} onClose={() => setEnvManagerOpen(false)} />
    </>
  );
}
