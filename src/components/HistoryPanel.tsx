"use client";

import {Trash2} from "lucide-react";
import {getMethodColor, useAppStore} from "@/lib/store";
import {Button} from "@/components/ui/button";
import {ScrollArea} from "@/components/ui/scroll-area";
import {cn} from "@/lib/utils";
import type {HttpMethod} from "@/lib/types";

export function HistoryPanel() {
  const {history, clearHistory, openRequest, requests} = useAppStore();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          History
        </span>
        {history.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={clearHistory}
            title="Clear history"
          >
            <Trash2 className="h-3 w-3"/>
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {history.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">No requests yet</p>
          )}
          {history.map((item) => (
            <div
              key={item.id}
              className="group flex flex-col gap-0.5 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
              onClick={() => {
                if (item.requestId) {
                  const req = requests.find((r) => r.id === item.requestId);
                  if (req) openRequest(req.id);
                }
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className={cn("text-[10px] font-bold shrink-0", getMethodColor(item.method as HttpMethod))}>
                  {item.method}
                </span>
                <span className="text-xs truncate flex-1 text-foreground">{item.name}</span>
                {item.response && (
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-1.5 rounded",
                      item.response.status >= 200 && item.response.status < 300
                        ? "text-green-600 bg-green-100 dark:bg-green-900/30"
                        : "text-red-600 bg-red-100 dark:bg-red-900/30"
                    )}
                  >
                    {item.response.status}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground truncate font-mono pl-8">
                {item.url}
              </p>
              <p className="text-[10px] text-muted-foreground pl-8">
                {new Date(item.timestamp).toLocaleTimeString()}
                {item.response && ` · ${item.response.time}ms`}
              </p>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
