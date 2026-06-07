"use client";

import {Plus, Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Switch} from "@/components/ui/switch";
import type {KeyValue} from "@/lib/types";

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
    onChange(items.map((item) => (item.id === id ? {...item, [field]: value} : item)));
  };

  const remove = (id: string) => onChange(items.filter((item) => item.id !== id));

  const add = () =>
    onChange([...items, {id: uuid(), key: "", value: "", enabled: true}]);

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <Switch
            checked={item.enabled}
            onCheckedChange={(v) => update(item.id, "enabled", v)}
            disabled={readOnly}
            className="shrink-0"
          />
          <Input
            value={item.key}
            onChange={(e) => update(item.id, "key", e.target.value)}
            placeholder={keyPlaceholder}
            readOnly={readOnly}
            className="flex-1 font-mono text-xs"
          />
          <Input
            value={item.value}
            onChange={(e) => update(item.id, "value", e.target.value)}
            placeholder={valuePlaceholder}
            readOnly={readOnly}
            className="flex-1 font-mono text-xs"
          />
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => remove(item.id)}
            >
              <Trash2 className="h-3.5 w-3.5"/>
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={add}>
          <Plus className="h-3 w-3"/> Add
        </Button>
      )}
    </div>
  );
}
