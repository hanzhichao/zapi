"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import type React from "react";
import {ArrowLeftRight, BookOpen, Clock, Code2, FolderOpen, Globe, Layers, Moon, Network, Play, Puzzle, Server, Settings, Sparkles, Sun, Variable, Zap,} from "lucide-react";
import {useAppStore} from "@/lib/store";
import {CollectionSidebar} from "@/components/CollectionSidebar";
import {RequestEditor, RequestUrlBar, RequestConfigTabs} from "@/components/RequestEditor";
import {ResponseViewer} from "@/components/ResponseViewer";
import {RequestTabsBar, LayoutCycleIcon, LAYOUT_LABELS} from "@/components/RequestTabsBar";
import {VariablesPanel} from "@/components/VariablesPanel";
import {HistoryPanel} from "@/components/HistoryPanel";
import {RunnerPanel} from "@/components/RunnerPanel";
import {RunnerReport} from "@/components/RunnerReport";
import {ConsolePanel} from "@/components/ConsolePanel";
import {SwitchHostsPanel} from "@/components/SwitchHostsPanel";
import {MockPanel} from "@/components/MockPanel";
import {WebSocketView} from "@/components/WebSocketView";
import {CodeSnippetPanel} from "@/components/CodeSnippetPanel";
import {AiPanel} from "@/components/AiPanel";
import {DocGeneratorDialog} from "@/components/DocGenerator";
import {ApiSpecPanel} from "@/components/ApiSpecPanel";
import {ProxyPanel} from "@/components/ProxyPanel";
import {PluginPanel} from "@/components/PluginPanel";
import {ResponseDiffPanel} from "@/components/ResponseDiff";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";

type SidebarTab = "collections" | "history" | "variables" | "runner" | "hosts" | "mock" | "ai" | "specs" | "proxy" | "plugins";
type ResponseTab = "response" | "code" | "diff";

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
        "relative shrink-0 group select-none z-10",
        "transition-colors duration-100",
        direction === "horizontal"
          ? "w-1 cursor-col-resize hover:w-1.5 bg-border hover:bg-primary/30"
          : "h-1 cursor-row-resize hover:h-1.5 bg-border hover:bg-primary/30"
      )}
    >
      {/* Center grip dots */}
      <div className={cn(
        "absolute inset-0 flex items-center justify-center",
        "opacity-0 group-hover:opacity-100 transition-opacity duration-100"
      )}>
        <div className={cn(
          "flex gap-[3px]",
          direction === "horizontal" ? "flex-col" : "flex-row"
        )}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-1 w-1 rounded-full bg-primary/60" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("collections");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [responseTab, setResponseTab] = useState<ResponseTab>("response");
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const {dark, toggle} = useDarkMode();
  const layoutMode = useAppStore((s) => s.layoutMode);
  const consoleOpen = useAppStore((s) => s.consoleOpen);
  const activeRequest = useAppStore((s) => s.requests.find((r) => r.id === s.activeRequestId));
  const isWebSocket = activeRequest?.protocol === "websocket";
  const { collections, addRequest, loadWorkspace } = useAppStore();

  // Restore session on startup (workspace, open requests, window size)
  useEffect(() => {
    import("@/lib/workspace").then(({ readAppConfig }) => {
      readAppConfig().then((config) => {
        // Restore window size
        if (config.windowWidth && config.windowHeight) {
          import("@tauri-apps/api/window").then(({ getCurrentWindow, PhysicalSize }) => {
            getCurrentWindow().setSize(new PhysicalSize(config.windowWidth!, config.windowHeight!))
              .catch(console.error);
          }).catch(console.error);
        }
        if (config.lastWorkspacePath) {
          // openRequestIds + activeRequestId are restored inside loadWorkspace
          loadWorkspace(config.lastWorkspacePath).catch(console.error);
        } else if (config.openRequestIds?.length) {
          // No workspace — restore open requests from app config
          const s = useAppStore.getState();
          const validIds = new Set(s.requests.map((r) => r.id));
          const openIds = config.openRequestIds.filter((id) => validIds.has(id));
          const activeId = config.activeRequestId && validIds.has(config.activeRequestId)
            ? config.activeRequestId
            : (openIds[openIds.length - 1] ?? null);
          if (openIds.length) {
            useAppStore.setState({ openRequestIds: openIds, activeRequestId: activeId });
          }
        }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save window size to config on resize (debounced)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const [{ getCurrentWindow }, { readAppConfig, writeAppConfig }] = await Promise.all([
            import("@tauri-apps/api/window"),
            import("@/lib/workspace"),
          ]);
          const size = await getCurrentWindow().innerSize();
          const cfg = await readAppConfig();
          await writeAppConfig({ ...cfg, windowWidth: size.width, windowHeight: size.height });
        } catch { /* not in Tauri context */ }
      }, 600);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      // ⌘+Enter → send request
      if (e.key === "Enter") {
        e.preventDefault();
        window.dispatchEvent(new Event("zapi:send"));
        return;
      }
      // ⌘+N → new request in active collection
      if (e.key === "n") {
        e.preventDefault();
        const colId = collections[0]?.id;
        if (colId) addRequest(colId);
        setSidebarTab("collections");
        return;
      }
      // ⌘+B → toggle sidebar
      if (e.key === "b") {
        e.preventDefault();
        setSidebarVisible((v) => !v);
        return;
      }
      // ⌘+L → focus URL bar
      if (e.key === "l") {
        e.preventDefault();
        const urlInput = document.querySelector<HTMLInputElement>("input[placeholder*='URL'], input[placeholder*='ws://'], input[placeholder*='grpc://'], input[placeholder*='graphql'], input[placeholder*='soap']");
        if (urlInput) { urlInput.focus(); urlInput.select(); }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [collections, addRequest]);

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
              {id: "hosts", icon: Globe, label: "Hosts Manager"},
              {id: "mock", icon: Server, label: "Mock Server"},
              {id: "ai", icon: Sparkles, label: "AI Assistant"},
              {id: "specs", icon: Layers, label: "API Interfaces"},
              {id: "proxy", icon: Network, label: "Proxy Capture"},
              {id: "plugins", icon: Puzzle, label: "Plugin Manager"},
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

        {/* Collections / History / Variables Sidebar — hidden in specs/proxy/plugins mode */}
        {sidebarVisible && sidebarTab !== "specs" && sidebarTab !== "proxy" && sidebarTab !== "plugins" && <div
          className="flex-none h-full overflow-hidden border-r bg-background"
          style={{width: sidebar.size}}
        >
          {sidebarTab === "collections" && <CollectionSidebar/>}
          {sidebarTab === "history" && <HistoryPanel/>}
          {sidebarTab === "variables" && <VariablesPanel/>}
          {sidebarTab === "runner" && <RunnerPanel/>}
          {sidebarTab === "hosts" && <SwitchHostsPanel/>}
          {sidebarTab === "mock" && <MockPanel/>}
          {sidebarTab === "ai" && <AiPanel/>}
        </div>}

        {sidebarVisible && sidebarTab !== "specs" && sidebarTab !== "proxy" && sidebarTab !== "plugins" && <DragHandle direction="horizontal" onMouseDown={sidebar.onMouseDown}/>}

        {/* Main: Request + Response  OR  Runner Report  OR  API Spec Panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {sidebarTab === "plugins" ? (
            <PluginPanel/>
          ) : sidebarTab === "proxy" ? (
            <ProxyPanel/>
          ) : sidebarTab === "specs" ? (
            <ApiSpecPanel/>
          ) : sidebarTab === "runner" ? (
            <RunnerReport/>
          ) : layoutMode === "horizontal" ? (
            /* Horizontal layout */
            <>
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <RequestTabsBar/>
                <RequestUrlBar/>
                <div className="flex flex-1 overflow-hidden min-h-0">
                  <div className="flex-none overflow-hidden flex flex-col border-r" style={{width: requestPaneH.size}}>
                    <div className="flex-1 overflow-hidden"><RequestConfigTabs/></div>
                  </div>
                  <DragHandle direction="horizontal" onMouseDown={requestPaneH.onMouseDown}/>
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <ResponseTabBar tab={responseTab} setTab={setResponseTab} isWs={isWebSocket} hasRequest={!!activeRequest} onDocGen={() => setDocDialogOpen(true)}/>
                    <div className="flex-1 overflow-hidden">
                      <ResponseContent tab={responseTab} isWs={isWebSocket} activeRequest={activeRequest}/>
                    </div>
                  </div>
                </div>
              </div>
              {consoleOpen && <ConsolePanel/>}
            </>
          ) : layoutMode === "fullscreen" ? (
            /* Fullscreen response — covers entire content area */
            <>
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <ResponseTabBar tab={responseTab} setTab={setResponseTab} isWs={isWebSocket} hasRequest={!!activeRequest} onDocGen={() => setDocDialogOpen(true)}/>
                <div className="flex-1 overflow-hidden">
                  <ResponseContent tab={responseTab} isWs={isWebSocket} activeRequest={activeRequest}/>
                </div>
              </div>
              {consoleOpen && <ConsolePanel/>}
            </>
          ) : layoutMode === "hidden" ? (
            /* Hidden response — request takes all space */
            <>
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <RequestTabsBar/>
                <div className="flex-1 overflow-hidden"><RequestEditor/></div>
                {/* Thin response strip at bottom */}
                <ResponseTabBar tab={responseTab} setTab={setResponseTab} isWs={isWebSocket} hasRequest={!!activeRequest} onDocGen={() => setDocDialogOpen(true)} hideContent/>
              </div>
              {consoleOpen && <ConsolePanel/>}
            </>
          ) : (
            /* Vertical layout (default) */
            <>
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="flex-none overflow-hidden flex flex-col" style={{height: requestPane.size}}>
                  <RequestTabsBar/>
                  <div className="flex-1 overflow-hidden"><RequestEditor/></div>
                </div>
                <DragHandle direction="vertical" onMouseDown={requestPane.onMouseDown}/>
                <div className="flex-1 overflow-hidden flex flex-col">
                  <ResponseTabBar tab={responseTab} setTab={setResponseTab} isWs={isWebSocket} hasRequest={!!activeRequest} onDocGen={() => setDocDialogOpen(true)}/>
                  <div className="flex-1 overflow-hidden">
                    <ResponseContent tab={responseTab} isWs={isWebSocket} activeRequest={activeRequest}/>
                  </div>
                </div>
              </div>
              {consoleOpen && <ConsolePanel/>}
            </>
          )}
        </div>
      </div>
      <DocGeneratorDialog open={docDialogOpen} onClose={() => setDocDialogOpen(false)} />
    </TooltipProvider>
  );
}

// ── Response content helper ─────────────────────────────────────────────────

function ResponseContent({
  tab,
  isWs,
  activeRequest,
}: {
  tab: ResponseTab;
  isWs: boolean;
  activeRequest: import("@/lib/types").ApiRequest | undefined;
}) {
  if (isWs) return <WebSocketView />;
  if (tab === "code" && activeRequest) return <CodeSnippetPanel request={activeRequest} />;
  if (tab === "diff") return <ResponseDiffPanel />;
  return <ResponseViewer />;
}

// ── Response Tab Bar component ────────────────────────────────────────────────

function ResponseTabBar({
  tab, setTab, isWs, hasRequest, onDocGen, hideContent = false,
}: {
  tab: ResponseTab;
  setTab: (t: ResponseTab) => void;
  isWs: boolean;
  hasRequest: boolean;
  onDocGen: () => void;
  hideContent?: boolean;
}) {
  const layoutMode = useAppStore((s) => s.layoutMode);
  const setLayoutMode = useAppStore((s) => s.setLayoutMode);

  const tabBtn = (t: ResponseTab, label: React.ReactNode, hidden?: boolean) =>
    hidden ? null : (
      <button
        onClick={() => setTab(t)}
        className={cn(
          "px-3 h-full text-xs font-medium border-b-2 transition-colors flex items-center gap-1 shrink-0",
          tab === t
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
      </button>
    );

  const cycleLayout = () => {
    const cycle = ["vertical", "horizontal", "hidden", "fullscreen"] as const;
    const idx = cycle.indexOf(layoutMode as typeof cycle[number]);
    setLayoutMode(cycle[(idx + 1) % cycle.length]);
  };

  return (
    <div className={cn(
      "flex items-center border-b bg-muted/10 shrink-0",
      hideContent ? "h-8" : "h-9"
    )}>
      {!hideContent && (
        <>
          {tabBtn("response", "Response")}
          {!isWs && hasRequest && tabBtn("code", <><Code2 className="h-3 w-3" />Code</>)}
          {tabBtn("diff", <><ArrowLeftRight className="h-3 w-3" />Diff</>)}
        </>
      )}
      {hideContent && (
        <span className="px-3 text-[10px] text-muted-foreground/60 italic">Response hidden</span>
      )}
      <div className="flex-1" />

      {/* Layout cycle — always visible in fullscreen so user can exit */}
      {layoutMode === "fullscreen" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title={`布局: ${LAYOUT_LABELS[layoutMode as import("@/lib/types").LayoutMode]} → 点击切换`}
          onClick={cycleLayout}
        >
          <LayoutCycleIcon mode={layoutMode as import("@/lib/types").LayoutMode} />
        </Button>
      )}

      {/* DocGen */}
      {!hideContent && (
        <button
          onClick={onDocGen}
          className="px-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors border-l h-full"
          title="Generate API Documentation"
        >
          <BookOpen className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
