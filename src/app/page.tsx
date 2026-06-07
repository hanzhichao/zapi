"use client";

import {useCallback, useRef, useState} from "react";
import {Clock, FolderOpen, GripVertical, Moon, Play, Settings, Sun, Variable, Zap,} from "lucide-react";
import {useAppStore} from "@/lib/store";
import {CollectionSidebar} from "@/components/CollectionSidebar";
import {RequestEditor, RequestUrlBar, RequestConfigTabs} from "@/components/RequestEditor";
import {ResponseViewer} from "@/components/ResponseViewer";
import {RequestTabsBar} from "@/components/RequestTabsBar";
import {VariablesPanel} from "@/components/VariablesPanel";
import {HistoryPanel} from "@/components/HistoryPanel";
import {RunnerPanel} from "@/components/RunnerPanel";
import {RunnerReport} from "@/components/RunnerReport";
import {ConsolePanel} from "@/components/ConsolePanel";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";

type SidebarTab = "collections" | "history" | "variables" | "runner";

function useDragResize(initial: number, min: number, max: number) {
  const [size, setSize] = useState(initial);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startSize = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startSize.current = size;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        setSize(Math.min(max, Math.max(min, startSize.current + delta)));
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [size, min, max]
  );

  return {size, onMouseDown};
}

function useVerticalDragResize(initial: number, min: number, max: number) {
  const [size, setSize] = useState(initial);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startSize = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startSize.current = size;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientY - startY.current;
        setSize(Math.min(max, Math.max(min, startSize.current + delta)));
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [size, min, max]
  );

  return {size, onMouseDown};
}

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });
  const toggle = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };
  return {dark, toggle};
}

function DragHandle({
                      direction,
                      onMouseDown,
                    }: {
  direction: "horizontal" | "vertical";
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "relative shrink-0 bg-border flex items-center justify-center group hover:bg-primary/20 transition-colors",
        direction === "horizontal"
          ? "w-1 cursor-col-resize hover:w-1"
          : "h-1 cursor-row-resize hover:h-1"
      )}
    >
      <div className="z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical
          className={cn(
            "text-muted-foreground h-4 w-4",
            direction === "vertical" && "rotate-90"
          )}
        />
      </div>
    </div>
  );
}

export default function Home() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("collections");
  const {dark, toggle} = useDarkMode();
  const layoutMode = useAppStore((s) => s.layoutMode);
  const consoleOpen = useAppStore((s) => s.consoleOpen);

  const sidebar = useDragResize(240, 160, 480);
  const requestPane = useVerticalDragResize(340, 160, 700);
  const requestPaneH = useDragResize(520, 280, 900);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground select-none">
        {/* Icon Sidebar */}
        <div className="flex flex-col items-center gap-1 w-10 border-r bg-muted/20 py-2 shrink-0">
          <div className="mb-2">
            <Zap className="h-5 w-5 text-primary"/>
          </div>
          {(
            [
              {id: "collections", icon: FolderOpen, label: "Collections"},
              {id: "history", icon: Clock, label: "History"},
              {id: "variables", icon: Variable, label: "Variables"},
              {id: "runner", icon: Play, label: "Runner"},
            ] as const
          ).map(({id, icon: Icon, label}) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    sidebarTab === id && "bg-accent text-accent-foreground"
                  )}
                  onClick={() => setSidebarTab(id)}
                >
                  <Icon className="h-4 w-4"/>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
          <div className="flex-1"/>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggle}>
                {dark ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{dark ? "Light mode" : "Dark mode"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings className="h-4 w-4"/>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>

        {/* Collections / History / Variables Sidebar */}
        <div
          className="flex-none h-full overflow-hidden border-r bg-background"
          style={{width: sidebar.size}}
        >
          {sidebarTab === "collections" && <CollectionSidebar/>}
          {sidebarTab === "history" && <HistoryPanel/>}
          {sidebarTab === "variables" && <VariablesPanel/>}
          {sidebarTab === "runner" && <RunnerPanel/>}
        </div>

        <DragHandle direction="horizontal" onMouseDown={sidebar.onMouseDown}/>

        {/* Main: Request + Response  OR  Runner Report */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {sidebarTab === "runner" ? (
            <RunnerReport/>
          ) : layoutMode === "horizontal" ? (
            /* Horizontal layout: tabs bar + URL bar full-width, params|response split below */
            <>
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <RequestTabsBar/>
                <RequestUrlBar/>
                <div className="flex flex-1 overflow-hidden min-h-0">
                  <div className="flex-none overflow-hidden flex flex-col border-r" style={{width: requestPaneH.size}}>
                    <div className="flex-1 overflow-hidden">
                      <RequestConfigTabs/>
                    </div>
                  </div>
                  <DragHandle direction="horizontal" onMouseDown={requestPaneH.onMouseDown}/>
                  <div className="flex-1 overflow-hidden">
                    <ResponseViewer/>
                  </div>
                </div>
              </div>
              {consoleOpen && <ConsolePanel/>}
            </>
          ) : (
            /* Vertical layout (default): request on top, response on bottom */
            <>
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div
                  className="flex-none overflow-hidden flex flex-col border-b"
                  style={{height: requestPane.size}}
                >
                  <RequestTabsBar/>
                  <div className="flex-1 overflow-hidden">
                    <RequestEditor/>
                  </div>
                </div>

                <DragHandle direction="vertical" onMouseDown={requestPane.onMouseDown}/>

                <div className="flex-1 overflow-hidden">
                  <ResponseViewer/>
                </div>
              </div>
              {consoleOpen && <ConsolePanel/>}
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
