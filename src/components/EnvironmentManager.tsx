"use client";

import { useState } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CollectionVariable, Environment } from "@/lib/types";
import { cn } from "@/lib/utils";

function uuid() {
  return crypto.randomUUID();
}

function VariableRow({
  variable,
  onUpdate,
  onDelete,
}: {
  variable: CollectionVariable;
  onUpdate: (data: Partial<CollectionVariable>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={variable.enabled}
        onCheckedChange={(v) => onUpdate({ enabled: v })}
        className="shrink-0"
      />
      <Input
        value={variable.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        placeholder="Variable name"
        className="flex-1 h-7 text-xs font-mono bg-muted/20"
      />
      <Input
        value={variable.value}
        onChange={(e) => onUpdate({ value: e.target.value })}
        placeholder="Initial value"
        className="flex-1 h-7 text-xs font-mono bg-muted/20"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function EnvironmentEditor({
  env,
  onClose,
}: {
  env: Environment;
  onClose: () => void;
}) {
  const { updateEnvironment } = useAppStore();
  const [name, setName] = useState(env.name);
  const [variables, setVariables] = useState<CollectionVariable[]>(env.variables);

  const save = () => {
    updateEnvironment(env.id, { name: name.trim() || env.name, variables });
    onClose();
  };

  const addVar = () => {
    setVariables((v) => [...v, { id: uuid(), name: "", value: "", enabled: true }]);
  };

  const updateVar = (id: string, data: Partial<CollectionVariable>) => {
    setVariables((v) => v.map((x) => (x.id === id ? { ...x, ...data } : x)));
  };

  const deleteVar = (id: string) => {
    setVariables((v) => v.filter((x) => x.id !== id));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Environment</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>

        <div className="flex-1 flex flex-col gap-2 min-h-0">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Variables</Label>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={addVar}>
              <Plus className="h-3 w-3" /> Add Variable
            </Button>
          </div>

          {variables.length > 0 && (
            <div className="flex items-center gap-2 px-0.5">
              <div className="w-9 shrink-0" />
              <span className="flex-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Name</span>
              <span className="flex-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Value</span>
              <div className="w-6 shrink-0" />
            </div>
          )}

          <ScrollArea className="flex-1 pr-1">
            <div className="space-y-1.5">
              {variables.map((v) => (
                <VariableRow
                  key={v.id}
                  variable={v}
                  onUpdate={(data) => updateVar(v.id, data)}
                  onDelete={() => deleteVar(v.id)}
                />
              ))}
              {variables.length === 0 && (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No variables yet. Click &quot;Add Variable&quot; to create one.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EnvironmentManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { environments, addEnvironment, deleteEnvironment, activeEnvironmentId, setActiveEnvironment } =
    useAppStore();
  const [editing, setEditing] = useState<Environment | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = () => {
    if (newName.trim()) {
      const env = addEnvironment(newName.trim());
      setNewName("");
      setCreating(false);
      setEditing(env);
    }
  };

  if (editing) {
    return <EnvironmentEditor env={editing} onClose={() => setEditing(null)} />;
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Environments</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {/* No environment option */}
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
              !activeEnvironmentId ? "bg-primary/10 border border-primary/20" : "hover:bg-accent border border-transparent"
            )}
            onClick={() => setActiveEnvironment(null)}
          >
            <div className={cn("h-2 w-2 rounded-full", !activeEnvironmentId ? "bg-primary" : "bg-muted")} />
            <span className="text-sm flex-1 text-muted-foreground italic">No Environment</span>
          </div>

          {environments.map((env) => (
            <div
              key={env.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors group",
                activeEnvironmentId === env.id ? "bg-primary/10 border border-primary/20" : "hover:bg-accent border border-transparent"
              )}
              onClick={() => setActiveEnvironment(env.id)}
            >
              <div className={cn("h-2 w-2 rounded-full shrink-0", activeEnvironmentId === env.id ? "bg-primary" : "bg-muted")} />
              <span className="text-sm flex-1 truncate">{env.name}</span>
              <span className="text-xs text-muted-foreground">{env.variables.length} vars</span>
              <div className="flex opacity-0 group-hover:opacity-100 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => { e.stopPropagation(); setEditing(env); }}
                >
                  <Edit3 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); deleteEnvironment(env.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {creating ? (
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Environment name"
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <Button size="sm" onClick={handleCreate}>Create</Button>
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New Environment
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
