"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KeyValue } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  readOnly?: boolean;
}

function uuid() {
  return crypto.randomUUID();
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  readOnly,
}: Props) {
  const update = (id: string, field: keyof KeyValue, value: string | boolean) => {
    onChange(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const remove = (id: string) => onChange(items.filter((item) => item.id !== id));

  const add = () =>
    onChange([...items, { id: uuid(), key: "", value: "", enabled: true }]);

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          {/* Checkbox replaces Switch */}
          <button
            type="button"
            role="checkbox"
            aria-checked={item.enabled}
            disabled={readOnly}
            onClick={() => !readOnly && update(item.id, "enabled", !item.enabled)}
            className={cn(
              "shrink-0 h-3.5 w-3.5 rounded-sm border transition-colors",
              item.enabled
                ? "bg-primary border-primary"
                : "bg-transparent border-muted-foreground/40 hover:border-muted-foreground/70",
              readOnly && "cursor-not-allowed opacity-50"
            )}
          >
            {item.enabled && (
              <svg viewBox="0 0 10 10" className="h-full w-full text-primary-foreground" fill="none">
                <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          {/* Key input — dashed border */}
          <Input
            value={item.key}
            onChange={(e) => update(item.id, "key", e.target.value)}
            placeholder={keyPlaceholder}
            readOnly={readOnly}
            className={cn(
              "flex-1 font-mono text-xs h-7",
              "border-dashed border-muted-foreground/30",
              "focus:border-solid focus:border-input focus-visible:ring-0 focus-visible:ring-offset-0",
              !item.enabled && "opacity-50"
            )}
          />

          {/* Value input — dashed border */}
          <Input
            value={item.value}
            onChange={(e) => update(item.id, "value", e.target.value)}
            placeholder={valuePlaceholder}
            readOnly={readOnly}
            className={cn(
              "flex-1 font-mono text-xs h-7",
              "border-dashed border-muted-foreground/30",
              "focus:border-solid focus:border-input focus-visible:ring-0 focus-visible:ring-offset-0",
              !item.enabled && "opacity-50"
            )}
          />

          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground/40 hover:text-destructive"
              onClick={() => remove(item.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground" onClick={add}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      )}
    </div>
  );
}
