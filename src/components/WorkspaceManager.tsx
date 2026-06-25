"use client";

import { ChevronDown, FolderOpen, FolderPlus, Clock } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { workspaceNameFromPath } from "@/lib/workspace";

export function WorkspaceManager() {
  const { workspacePath, recentWorkspaces, openWorkspacePicker, createWorkspace, loadWorkspace } =
    useAppStore();

  const currentName = workspacePath ? workspaceNameFromPath(workspacePath) : null;

  const handleNew = async () => {
    const { pickDirectory } = await import("@/lib/workspace");
    const dir = await pickDirectory();
    if (dir) await createWorkspace(dir);
  };

  if (!workspacePath) {
    return (
      <div className="px-3 py-2 border-b bg-muted/5 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground flex-1">No workspace open</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground"
          onClick={openWorkspacePicker}
          title="Open or create a workspace folder"
        >
          <FolderOpen className="h-3 w-3" />
          Open
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground"
          onClick={handleNew}
          title="Create new workspace in a folder"
        >
          <FolderPlus className="h-3 w-3" />
          New
        </Button>
      </div>
    );
  }

  return (
    <div className="px-2 py-1.5 border-b bg-muted/5 flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={cn(
            "flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-1 rounded",
            "text-xs text-left hover:bg-accent transition-colors"
          )}>
            <FolderOpen className="h-3 w-3 text-primary shrink-0" />
            <span className="font-medium truncate flex-1">{currentName}</span>
            <ChevronDown className="h-3 w-3 opacity-40 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="px-2 py-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Current Workspace</p>
            <p className="text-xs text-foreground font-medium mt-0.5 truncate">{currentName}</p>
            <p className="text-[10px] text-muted-foreground truncate">{workspacePath}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs gap-2" onClick={openWorkspacePicker}>
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            Open Workspace…
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs gap-2" onClick={handleNew}>
            <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
            New Workspace…
          </DropdownMenuItem>
          {recentWorkspaces.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] py-1 flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3 w-3" />
                Recent Workspaces
              </DropdownMenuLabel>
              {recentWorkspaces
                .filter((w) => w.path !== workspacePath)
                .slice(0, 8)
                .map((w) => (
                  <DropdownMenuItem
                    key={w.path}
                    className="text-xs flex-col items-start gap-0.5"
                    onClick={() => loadWorkspace(w.path)}
                  >
                    <span className="font-medium">{w.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate w-full">{w.path}</span>
                  </DropdownMenuItem>
                ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
