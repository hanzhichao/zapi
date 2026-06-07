"use client";

import {useState} from "react";
import {Plus, Trash2} from "lucide-react";
import {useAppStore} from "@/lib/store";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Switch} from "@/components/ui/switch";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {ScrollArea} from "@/components/ui/scroll-area";

export function VariablesPanel() {
  const {collections, addVariable, updateVariable, deleteVariable} = useAppStore();
  const [selectedColId, setSelectedColId] = useState<string>(collections[0]?.id ?? "");

  const collection = collections.find((c) => c.id === selectedColId);

  const handleAdd = () => {
    if (!selectedColId) return;
    addVariable(selectedColId, {name: "", value: "", enabled: true});
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Variables
        </span>
      </div>
      <div className="px-3 py-2 border-b">
        <Select value={selectedColId} onValueChange={setSelectedColId}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Select collection"/>
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
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">
          {collection?.variables.map((v) => (
            <div key={v.id} className="flex items-center gap-2">
              <Switch
                checked={v.enabled}
                onCheckedChange={(checked) =>
                  updateVariable(selectedColId, v.id, {enabled: checked})
                }
                className="shrink-0"
              />
              <Input
                value={v.name}
                onChange={(e) => updateVariable(selectedColId, v.id, {name: e.target.value})}
                placeholder="Variable name"
                className="flex-1 font-mono text-xs h-7"
              />
              <Input
                value={v.value}
                onChange={(e) => updateVariable(selectedColId, v.id, {value: e.target.value})}
                placeholder="Value"
                className="flex-1 font-mono text-xs h-7"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => deleteVariable(selectedColId, v.id)}
              >
                <Trash2 className="h-3.5 w-3.5"/>
              </Button>
            </div>
          ))}
          {(!collection || collection.variables.length === 0) && (
            <p className="text-xs text-muted-foreground py-2">No variables defined.</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 mt-1"
            onClick={handleAdd}
            disabled={!selectedColId}
          >
            <Plus className="h-3 w-3"/> Add Variable
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
