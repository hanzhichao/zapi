"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Globe,
  Plus,
  RefreshCw,
  RotateCcw,
  Play,
  Pencil,
  Trash2,
  Save,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface HostsProfile {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

type MsgState = { type: "error" | "success"; text: string } | null;

export function SwitchHostsPanel() {
  const [profiles, setProfiles] = useState<HostsProfile[]>([]);
  const [currentHosts, setCurrentHosts] = useState("");
  const [hasBackup, setHasBackup] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<MsgState>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");

  // Current hosts viewer dialog
  const [viewOpen, setViewOpen] = useState(false);

  const flash = useCallback((text: string, type: "error" | "success" = "success") => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [profileList, content, backup] = await Promise.all([
        invoke<HostsProfile[]>("hosts_list_profiles"),
        invoke<string>("hosts_get_content"),
        invoke<string | null>("hosts_get_backup"),
      ]);
      setProfiles(profileList);
      setCurrentHosts(content);
      setHasBackup(backup !== null);
    } catch (e) {
      flash(String(e), "error");
    }
  }, [flash]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyProfile = async (profile: HostsProfile) => {
    setBusy(true);
    try {
      await invoke("hosts_apply", { content: profile.content });
      setActiveId(profile.id);
      setCurrentHosts(profile.content);
      setHasBackup(true);
      flash(`Applied "${profile.name}"`);
    } catch (e) {
      flash(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const backup = await invoke<string | null>("hosts_get_backup");
      if (!backup) { flash("No backup found", "error"); return; }
      await invoke("hosts_restore");
      setCurrentHosts(backup);
      setActiveId(null);
      setHasBackup(false);
      flash("Restored original hosts");
    } catch (e) {
      flash(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const openNew = () => {
    setEditId(null);
    setEditName("");
    setEditContent(currentHosts);
    setEditOpen(true);
  };

  const openEdit = (p: HostsProfile) => {
    setEditId(p.id);
    setEditName(p.name);
    setEditContent(p.content);
    setEditOpen(true);
  };

  const saveProfile = async () => {
    const name = editName.trim();
    if (!name) return;
    const id = editId ?? `profile_${Date.now()}`;
    try {
      await invoke("hosts_save_profile", { id, name, content: editContent });
      setEditOpen(false);
      await refresh();
      flash(`Saved "${name}"`);
    } catch (e) {
      flash(String(e), "error");
    }
  };

  const deleteProfile = async (p: HostsProfile) => {
    try {
      await invoke("hosts_delete_profile", { id: p.id });
      if (activeId === p.id) setActiveId(null);
      await refresh();
    } catch (e) {
      flash(String(e), "error");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold flex-1">Hosts Manager</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" title="New profile" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" title="Refresh" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Status message */}
      {msg && (
        <div className={cn(
          "mx-2 mt-1.5 px-2 py-1 rounded text-xs shrink-0",
          msg.type === "error"
            ? "bg-red-500/10 text-red-600 dark:text-red-400"
            : "bg-green-500/10 text-green-600 dark:text-green-400"
        )}>
          {msg.text}
        </div>
      )}

      {/* Backup row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20 shrink-0">
        <span className={cn("text-xs flex-1", hasBackup ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
          {hasBackup ? "✓ Backup available" : "No backup"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-1.5 gap-1"
          onClick={() => setViewOpen(true)}
        >
          View
        </Button>
        {hasBackup && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs px-1.5 gap-1"
            onClick={restore}
            disabled={busy}
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </Button>
        )}
      </div>

      {/* sudo notice */}
      <div className="flex items-start gap-1.5 px-3 py-1.5 border-b bg-amber-500/5 shrink-0">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <span className="text-xs text-muted-foreground leading-tight">
          Applying a profile requires administrator permission.
        </span>
      </div>

      {/* Profiles list */}
      <div className="flex-1 overflow-y-auto py-1">
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Profiles
          </span>
        </div>

        {profiles.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center leading-relaxed">
            No profiles yet.
            <br />
            Click <strong>+</strong> to create one from
            <br />
            the current hosts file.
          </div>
        )}

        {profiles.map((p) => (
          <div
            key={p.id}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 group hover:bg-accent/50 rounded-sm mx-1",
              activeId === p.id && "bg-primary/10"
            )}
          >
            <div className={cn(
              "h-2 w-2 rounded-full shrink-0 transition-colors",
              activeId === p.id ? "bg-green-500" : "bg-border"
            )} />
            <span className="flex-1 text-xs truncate" title={p.name}>
              {p.name}
            </span>
            <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                title="Edit"
                onClick={() => openEdit(p)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                title="Delete"
                onClick={() => deleteProfile(p)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-6 w-6 text-primary"
                title="Apply"
                onClick={() => applyProfile(p)}
                disabled={busy}
              >
                <Play className="h-3 w-3 fill-current" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / New profile dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl flex flex-col overflow-hidden p-0 gap-0 max-h-[85vh]">
          <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
            <DialogTitle>{editId ? "Edit Profile" : "New Profile"}</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-2 shrink-0">
            <Input
              placeholder="Profile name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="flex-1 min-h-0 px-4 pb-2">
            <Textarea
              placeholder={"# /etc/hosts\n127.0.0.1   localhost\n::1         localhost"}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="h-full min-h-[280px] font-mono text-xs resize-none"
            />
          </div>
          <DialogFooter className="px-4 pb-4 shrink-0">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveProfile} disabled={!editName.trim()}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View current hosts dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl flex flex-col overflow-hidden p-0 gap-0 max-h-[85vh]">
          <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
            <DialogTitle>Current /etc/hosts</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-4 pb-4">
            <Textarea
              readOnly
              value={currentHosts}
              className="h-full min-h-[320px] font-mono text-xs resize-none bg-muted/30"
            />
          </div>
          <DialogFooter className="px-4 pb-4 shrink-0">
            <Button variant="outline" onClick={() => {
              setEditId(null);
              setEditName("");
              setEditContent(currentHosts);
              setViewOpen(false);
              setEditOpen(true);
            }}>
              Save as Profile
            </Button>
            <Button onClick={() => setViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
