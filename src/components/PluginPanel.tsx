"use client";

/**
 * Plugin Manager Panel
 * Lets users install, enable/disable, and configure plugins.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  Package,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import {
  invalidatePluginCache,
  loadPluginsFromDisk,
  setPluginLogHandler,
} from "@/lib/plugin-runtime";
import type { InstalledPlugin, PluginLogEntry } from "@/lib/plugin-types";

// ── Hook colour map ─────────────────────────────────────────────────────────

const HOOK_BADGE: Record<string, string> = {
  beforeRequest: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  afterResponse: "bg-green-500/15 text-green-600 dark:text-green-400",
  templateTag: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
};

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
      <Package className="h-14 w-14 text-muted-foreground/30" />
      <div>
        <p className="font-medium text-sm">No plugins installed</p>
        <p className="text-xs text-muted-foreground mt-1">
          Install a plugin folder to extend zapi with custom hooks and template tags.
        </p>
      </div>
      <Button size="sm" onClick={onInstall}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Install Plugin
      </Button>
    </div>
  );
}

// ── Plugin list item ────────────────────────────────────────────────────────

function PluginRow({
  plugin,
  selected,
  onSelect,
  onToggle,
  onDelete,
}: {
  plugin: InstalledPlugin;
  selected: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-accent/50 border-b border-border/40 transition-colors",
        selected && "bg-accent"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{plugin.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">v{plugin.version}</span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{plugin.description}</p>
        <div className="flex gap-1 mt-1 flex-wrap">
          {plugin.hooks.map((h) => (
            <span
              key={h}
              className={cn("text-[10px] rounded px-1 py-0.5 font-mono", HOOK_BADGE[h] ?? "bg-muted")}
            >
              {h}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        <Switch
          checked={plugin.enabled}
          onCheckedChange={(v) => { onToggle(v); }}
          onClick={(e) => e.stopPropagation()}
          className="scale-[0.7]"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Config editor ───────────────────────────────────────────────────────────

function ConfigEditor({ plugin, onChange }: { plugin: InstalledPlugin; onChange: (config: Record<string, string>) => void }) {
  const [local, setLocal] = useState<Record<string, string>>(plugin.config);

  useEffect(() => setLocal(plugin.config), [plugin.config]);

  const save = () => onChange(local);

  if (plugin.configFields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground p-4">
        This plugin has no configurable options.
      </p>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {plugin.configFields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <Label className="text-xs">
            {f.label}
            {f.required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          {f.type === "boolean" ? (
            <Switch
              checked={local[f.key] === "true"}
              onCheckedChange={(v) => setLocal((s) => ({ ...s, [f.key]: v ? "true" : "false" }))}
            />
          ) : f.type === "select" ? (
            <select
              value={local[f.key] ?? f.default ?? ""}
              onChange={(e) => setLocal((s) => ({ ...s, [f.key]: e.target.value }))}
              className="text-xs bg-background border rounded px-2 py-1"
            >
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <Input
              type={f.type === "secret" ? "password" : "text"}
              value={local[f.key] ?? f.default ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setLocal((s) => ({ ...s, [f.key]: e.target.value }))}
              className="text-xs h-7"
            />
          )}
          {f.description && <p className="text-[10px] text-muted-foreground">{f.description}</p>}
        </div>
      ))}
      <Button size="sm" className="w-full mt-1" onClick={save}>
        <Check className="h-3.5 w-3.5 mr-1" />
        Save Config
      </Button>
    </div>
  );
}

// ── Log viewer ──────────────────────────────────────────────────────────────

function LogViewer({
  logs,
  pluginId,
  onClear,
}: {
  logs: PluginLogEntry[];
  pluginId: string;
  onClear: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const filtered = logs.filter((l) => l.pluginId === pluginId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
        <span className="text-xs text-muted-foreground font-mono">Plugin Console</span>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5">
        {filtered.length === 0 && (
          <p className="text-muted-foreground p-2">No output yet. Plugin logs appear here.</p>
        )}
        {filtered.map((l, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2 leading-relaxed",
              l.level === "error" && "text-red-500",
              l.level === "warn" && "text-yellow-500"
            )}
          >
            <span className="text-muted-foreground shrink-0">
              {new Date(l.timestamp).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className="break-all">{l.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Detail panel ────────────────────────────────────────────────────────────

type DetailTab = "info" | "config" | "logs";

function PluginDetail({
  plugin,
  logs,
  onConfigChange,
  onClearLogs,
}: {
  plugin: InstalledPlugin;
  logs: PluginLogEntry[];
  onConfigChange: (config: Record<string, string>) => void;
  onClearLogs: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("info");

  const tabBtn = (t: DetailTab, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={cn(
        "flex items-center gap-1 px-3 py-1.5 text-xs border-b-2 transition-colors",
        tab === t
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tabs */}
      <div className="flex items-center border-b bg-muted/10 shrink-0">
        {tabBtn("info", <BookOpen className="h-3 w-3" />, "Info")}
        {tabBtn("config", <Zap className="h-3 w-3" />, "Config")}
        {tabBtn("logs", <Terminal className="h-3 w-3" />, "Logs")}
        {logs.filter((l) => l.pluginId === plugin.id && l.level === "error").length > 0 && (
          <span className="ml-auto mr-3 text-[10px] bg-red-500/20 text-red-500 rounded px-1">
            {logs.filter((l) => l.pluginId === plugin.id && l.level === "error").length} errors
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "info" && (
          <div className="p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-sm">{plugin.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{plugin.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground mb-0.5">Version</div>
                <div className="font-mono">{plugin.version}</div>
              </div>
              <div className="bg-muted/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground mb-0.5">Author</div>
                <div className="truncate">{plugin.author ?? "—"}</div>
              </div>
              <div className="bg-muted/30 rounded p-2 col-span-2">
                <div className="text-[10px] text-muted-foreground mb-0.5">Plugin ID</div>
                <div className="font-mono">{plugin.id}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Hooks</div>
              <div className="flex gap-1.5 flex-wrap">
                {plugin.hooks.map((h) => (
                  <span key={h} className={cn("text-[11px] rounded px-1.5 py-0.5 font-mono", HOOK_BADGE[h] ?? "bg-muted")}>
                    {h}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground bg-muted/20 rounded p-2 font-mono break-all">
              {plugin.path}
            </div>
          </div>
        )}

        {tab === "config" && (
          <ConfigEditor plugin={plugin} onChange={onConfigChange} />
        )}

        {tab === "logs" && (
          <div className="h-full">
            <LogViewer logs={logs} pluginId={plugin.id} onClear={onClearLogs} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Install guide dialog ────────────────────────────────────────────────────

function InstallGuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Plugin Development Guide
          </h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="p-4 space-y-4 text-xs">
          <section>
            <h3 className="font-semibold text-sm mb-1.5">Plugin Structure</h3>
            <p className="text-muted-foreground mb-2">A plugin is a folder with two files:</p>
            <pre className="bg-muted/40 rounded p-3 font-mono text-[11px]">{`my-plugin/
  plugin.json   ← manifest
  index.js      ← CommonJS module`}</pre>
          </section>

          <section>
            <h3 className="font-semibold text-sm mb-1.5">plugin.json</h3>
            <pre className="bg-muted/40 rounded p-3 font-mono text-[11px] overflow-x-auto">{`{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": "Your Name",
  "hooks": ["beforeRequest", "afterResponse", "templateTag"],
  "config": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "secret",
      "required": true,
      "description": "Your API key"
    }
  ]
}`}</pre>
          </section>

          <section>
            <h3 className="font-semibold text-sm mb-1.5">index.js — Hooks</h3>
            <pre className="bg-muted/40 rounded p-3 font-mono text-[11px] overflow-x-auto whitespace-pre">{`module.exports = {
  // Modify request before it's sent
  async beforeRequest(ctx) {
    ctx.headers['X-Timestamp'] = Date.now().toString();
    return ctx;      // return modified ctx
    // or return nothing to leave unchanged
  },

  // Inspect / transform response
  async afterResponse(ctx) {
    console.log('Status:', ctx.status);
    return { body: ctx.body };
  },

  // Custom {{my-plugin.now}} template tag
  templateTags: [{
    name: 'now',
    description: 'Unix timestamp',
    async resolve(args, config, crypto) {
      return Date.now().toString();
    }
  }]
};`}</pre>
          </section>

          <section>
            <h3 className="font-semibold text-sm mb-1.5">ctx.crypto — Async Crypto Utils</h3>
            <pre className="bg-muted/40 rounded p-3 font-mono text-[11px] overflow-x-auto">{`// HMAC-SHA256 (hex output)
const sig = await ctx.crypto.hmacSha256(key, data);

// SHA-256 hash (hex output)
const hash = await ctx.crypto.sha256(data);

// Base64 encode/decode
const b64 = ctx.crypto.base64Encode(data);
const raw = ctx.crypto.base64Decode(b64);

// Random
const id  = ctx.crypto.randomUUID();
const buf = ctx.crypto.randomBytes(16);`}</pre>
          </section>

          <section>
            <h3 className="font-semibold text-sm mb-1.5">Template Tags</h3>
            <p className="text-muted-foreground mb-1.5">
              Use your tags in URL, headers, body anywhere in the request editor:
            </p>
            <pre className="bg-muted/40 rounded p-3 font-mono text-[11px]">{`{{my-plugin.now}}
{{my-plugin.sign("GET", "/api/v1/users")}}
{{uuid.v4}}`}</pre>
          </section>

          <section>
            <h3 className="font-semibold text-sm mb-1.5">Installing</h3>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Click <strong className="text-foreground">Install Plugin</strong> in the toolbar</li>
              <li>Select your plugin folder</li>
              <li>The plugin is copied into zapi&apos;s plugin directory</li>
              <li>Enable the plugin with the toggle</li>
            </ol>
          </section>

          <section>
            <p className="text-muted-foreground">
              Check the <code className="bg-muted px-1 rounded">examples/plugins/</code> directory in
              the zapi repo for ready-to-use example plugins.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export function PluginPanel() {
  const plugins = useAppStore((s) => s.plugins);
  const setPlugins = useAppStore((s) => s.setPlugins);
  const setPluginEnabled = useAppStore((s) => s.setPluginEnabled);
  const setPluginConfig = useAppStore((s) => s.setPluginConfig);
  const pluginLogs = useAppStore((s) => s.pluginLogs);
  const addPluginLog = useAppStore((s) => s.addPluginLog);
  const clearPluginLogs = useAppStore((s) => s.clearPluginLogs);
  const pluginPersistedState = useAppStore((s) => s.pluginPersistedState);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [installPath, setInstallPath] = useState("");
  const [installDialogOpen, setInstallDialogOpen] = useState(false);

  const selected = plugins.find((p) => p.id === selectedId) ?? null;

  // Wire up the plugin log handler
  useEffect(() => {
    setPluginLogHandler(addPluginLog);
  }, [addPluginLog]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadPluginsFromDisk(pluginPersistedState);
      setPlugins(loaded);
      if (loaded.length > 0 && !loaded.find((p) => p.id === selectedId)) {
        setSelectedId(loaded[0].id);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [pluginPersistedState, selectedId, setPlugins]);

  // Load on mount
  // Load plugins on mount only (refresh is stable via useCallback)
  useEffect(() => { void refresh(); }, [refresh]);

  const handleInstall = () => {
    setInstallPath("");
    setInstallDialogOpen(true);
  };

  const confirmInstall = async () => {
    if (!installPath.trim()) return;
    setInstalling(true);
    try {
      await invoke("plugin_install", { srcPath: installPath.trim() });
      invalidatePluginCache();
      setInstallDialogOpen(false);
      await refresh();
    } catch (e) {
      alert(`Install failed: ${e}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) { setDeleteConfirm(id); return; }
    try {
      await invoke("plugin_delete", { id });
      invalidatePluginCache(id);
      await refresh();
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      alert(`Delete failed: ${e}`);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleToggle = (id: string, enabled: boolean) => {
    setPluginEnabled(id, enabled);
    invalidatePluginCache(id);
  };

  const handleConfigChange = (id: string, config: Record<string, string>) => {
    setPluginConfig(id, config);
    invalidatePluginCache(id);
  };

  const openPluginsFolder = async () => {
    try { await invoke("plugin_open_dir"); } catch { /* ignore */ }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: plugin list */}
      <div className="flex flex-col w-60 shrink-0 border-r overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-2 py-2 border-b bg-muted/10 shrink-0">
          <span className="text-xs font-medium flex-1 pl-1">Plugins</span>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={refresh}
            title="Refresh"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={openPluginsFolder}
            title="Open plugins folder"
          >
            <FolderOpen className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => setGuideOpen(true)}
            title="Plugin development guide"
          >
            <BookOpen className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            className="h-6 text-xs px-2"
            onClick={handleInstall}
            disabled={installing}
            title="Install plugin from folder"
          >
            <Plus className="h-3 w-3 mr-0.5" />
            Install
          </Button>
        </div>

        {/* Plugin list */}
        <div className="flex-1 overflow-y-auto">
          {plugins.length === 0 ? (
            <EmptyState onInstall={handleInstall} />
          ) : (
            plugins.map((p) => (
              <div key={p.id} className="relative">
                <PluginRow
                  plugin={p}
                  selected={selectedId === p.id}
                  onSelect={() => setSelectedId(p.id)}
                  onToggle={(enabled) => handleToggle(p.id, enabled)}
                  onDelete={() => void handleDelete(p.id)}
                />
                {deleteConfirm === p.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/95 z-10 gap-2 px-3">
                    <span className="text-xs text-destructive font-medium">Delete plugin?</span>
                    <Button size="sm" variant="destructive" className="h-6 text-xs px-2"
                      onClick={() => void handleDelete(p.id)}>Yes</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                      onClick={() => setDeleteConfirm(null)}>No</Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Stats footer */}
        {plugins.length > 0 && (
          <div className="px-3 py-1.5 border-t bg-muted/10 text-[10px] text-muted-foreground">
            {plugins.filter((p) => p.enabled).length} / {plugins.length} enabled
          </div>
        )}
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <PluginDetail
            plugin={selected}
            logs={pluginLogs}
            onConfigChange={(cfg) => handleConfigChange(selected.id, cfg)}
            onClearLogs={clearPluginLogs}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 h-full">
            <ChevronRight className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">Select a plugin to view its details</p>
          </div>
        )}
      </div>

      {guideOpen && <InstallGuideDialog onClose={() => setGuideOpen(false)} />}

      {installDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-background border rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Folder className="h-4 w-4 text-primary" />
                Install Plugin from Folder
              </h2>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInstallDialogOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Enter the absolute path to a plugin folder containing{" "}
                <code className="bg-muted px-1 rounded">plugin.json</code> and{" "}
                <code className="bg-muted px-1 rounded">index.js</code>.
              </p>
              <Input
                value={installPath}
                onChange={(e) => setInstallPath(e.target.value)}
                placeholder="/path/to/my-plugin  or  ~/plugins/my-plugin"
                className="text-xs font-mono h-8"
                onKeyDown={(e) => { if (e.key === "Enter") void confirmInstall(); }}
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">
                Tip: find example plugins in{" "}
                <code className="bg-muted px-1 rounded">examples/plugins/</code> in the zapi repo.
                Click <strong>Open Folder</strong> in the toolbar to see where plugins are stored.
              </p>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="ghost" size="sm" onClick={() => setInstallDialogOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void confirmInstall()} disabled={!installPath.trim() || installing}>
                {installing ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Install
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Re-export for use in http-client / RequestEditor ──────────────────────
export { Badge };
