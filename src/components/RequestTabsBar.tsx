"use client";

import { useState } from "react";
import { ChevronDown, Columns2, TerminalSquare, Rows2, X } from "lucide-react";
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
import type { HttpMethod } from "@/lib/types";

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
                  <span
                    className={cn(
                      "text-[10px] font-bold shrink-0",
                      getMethodColor(req.method as HttpMethod)
                    )}
                  >
                    {req.method}
                  </span>
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

          {/* Layout toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title={layoutMode === "vertical" ? "Switch to horizontal layout" : "Switch to vertical layout"}
            onClick={() => setLayoutMode(layoutMode === "vertical" ? "horizontal" : "vertical")}
          >
            {layoutMode === "vertical" ? (
              <Rows2 className="h-3.5 w-3.5" />
            ) : (
              <Columns2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <EnvironmentManager open={envManagerOpen} onClose={() => setEnvManagerOpen(false)} />
    </>
  );
}
