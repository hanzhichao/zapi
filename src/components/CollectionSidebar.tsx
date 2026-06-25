"use client";

import { useState, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { getMethodColor, useAppStore } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ApiRequest, Collection, HttpMethod, Protocol } from "@/lib/types";
import { cn } from "@/lib/utils";
import { parseOpenApi } from "@/lib/openapi-importer";
import { parsePostmanCollection } from "@/lib/postman-importer";
import { parseCurl } from "@/lib/curl-importer";
import { WorkspaceManager } from "@/components/WorkspaceManager";

// ── Protocol badge ───────────────────────────────────────────────────────────

function getProtocolBadge(request: ApiRequest): { label: string; className: string } {
  const proto = request.protocol;
  if (proto === "websocket") return { label: "WS", className: "text-green-500" };
  if (proto === "graphql") return { label: "GQL", className: "text-pink-500" };
  if (proto === "grpc") return { label: "gRPC", className: "text-purple-500" };
  if (proto === "soap") return { label: "SOAP", className: "text-orange-400" };
  // HTTP — show method
  return { label: request.method, className: getMethodColor(request.method) };
}

function RequestBadge({ request }: { request: ApiRequest }) {
  const { label, className } = getProtocolBadge(request);
  return (
    <span className={cn("text-[10px] font-bold w-10 shrink-0 leading-none", className)}>
      {label}
    </span>
  );
}

// ── Request item ─────────────────────────────────────────────────────────────

function RequestItem({ request }: { request: ApiRequest }) {
  const { activeRequestId, openRequest, deleteRequest, duplicateRequest, updateRequest } = useAppStore();
  const isActive = activeRequestId === request.id;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(request.name);

  const handleRename = () => {
    if (name.trim()) updateRequest(request.id, { name: name.trim() });
    setRenaming(false);
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer hover:bg-accent text-sm",
        isActive && "bg-accent text-accent-foreground"
      )}
      onClick={() => openRequest(request.id)}
    >
      <RequestBadge request={request} />
      {renaming ? (
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="h-5 text-xs flex-1"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate text-xs">{request.name}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => { setName(request.name); setRenaming(true); }}>
            <Edit3 className="mr-2 h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => duplicateRequest(request.id)}>
            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => deleteRequest(request.id)}>
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Protocol-specific new request entries ────────────────────────────────────

interface ProtocolEntry { label: string; protocol: Protocol; method?: HttpMethod; badge: string; badgeClass: string }

const PROTOCOL_ENTRIES: ProtocolEntry[] = [
  { label: "HTTP Request",      protocol: "http",      method: "GET",  badge: "GET",  badgeClass: "text-emerald-500" },
  { label: "WebSocket",         protocol: "websocket",               badge: "WS",   badgeClass: "text-green-500" },
  { label: "GraphQL",           protocol: "graphql",   method: "POST", badge: "GQL",  badgeClass: "text-pink-500" },
  { label: "gRPC",              protocol: "grpc",                     badge: "gRPC", badgeClass: "text-purple-500" },
  { label: "SOAP / WebService", protocol: "soap",      method: "POST", badge: "SOAP", badgeClass: "text-orange-400" },
];

// ── Folder item ───────────────────────────────────────────────────────────────

function FolderItem({ folderId, collectionId, name }: { folderId: string; collectionId: string; name: string }) {
  const { requests, expandedFolders, toggleFolder, addRequest, deleteFolder, updateFolder } = useAppStore();
  const isExpanded = expandedFolders.has(folderId);
  const folderRequests = requests.filter((r) => r.folderId === folderId).sort((a, b) => a.seq - b.seq);

  const [renaming, setRenaming] = useState(false);
  const [folderName, setFolderName] = useState(name);

  const handleRename = () => {
    if (folderName.trim()) updateFolder(folderId, { name: folderName.trim() });
    setRenaming(false);
  };

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer hover:bg-accent"
        onClick={() => toggleFolder(folderId)}
      >
        {isExpanded
          ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        {renaming ? (
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }}
            className="h-5 text-xs flex-1"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate text-xs">{name}</span>
        )}
        <div className="flex opacity-0 group-hover:opacity-100 gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => e.stopPropagation()}>
                <Plus className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider py-1">New Request</DropdownMenuLabel>
              {PROTOCOL_ENTRIES.map((entry) => (
                <DropdownMenuItem
                  key={entry.protocol}
                  onClick={(e) => { e.stopPropagation(); addRequest(collectionId, folderId, { protocol: entry.protocol, method: entry.method }); }}
                >
                  <span className={cn("text-[10px] font-bold w-8 shrink-0", entry.badgeClass)}>{entry.badge}</span>
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => { setFolderName(name); setRenaming(true); }}>
                <Edit3 className="mr-2 h-3.5 w-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => deleteFolder(folderId)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {isExpanded && (
        <div className="ml-3 border-l border-border pl-2 mt-0.5 space-y-0.5">
          {folderRequests.map((req) => (
            <RequestItem key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Import dialog ─────────────────────────────────────────────────────────────

function ImportDialog({
  open,
  onOpenChange,
  collectionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  collectionId: string;
}) {
  const { addCollection, importRequests } = useAppStore();
  const [tab, setTab] = useState<"openapi" | "postman" | "curl">("openapi");
  const [curlText, setCurlText] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setError(""); setSuccess(""); setCurlText(""); };

  const handleFile = async (file: File, type: "openapi" | "postman") => {
    try {
      const content = await file.text();
      if (type === "openapi") {
        const result = parseOpenApi(content);
        const col = addCollection(result.collectionName);
        // Add baseUrl variable if present
        if (result.variables.length > 0) {
          const vars = result.variables.map((v) => ({
            id: crypto.randomUUID(), name: v.name, value: v.value, enabled: true,
          }));
          useAppStore.getState().updateCollection(col.id, { variables: vars });
        }
        importRequests(col.id, result.requests);
        setSuccess(`Imported ${result.requests.length} requests into "${result.collectionName}"`);
      } else {
        const result = parsePostmanCollection(content);
        const col = addCollection(result.collectionName);
        if (result.variables.length > 0) {
          const vars = result.variables.map((v) => ({
            id: crypto.randomUUID(), name: v.name, value: v.value, enabled: true,
          }));
          useAppStore.getState().updateCollection(col.id, { variables: vars });
        }
        importRequests(col.id, result.requests);
        setSuccess(`Imported ${result.requests.length} requests into "${result.collectionName}"`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  const handleCurlImport = () => {
    try {
      const parsed = parseCurl(curlText.trim());
      if (!parsed.url) { setError("No URL found in cURL command"); return; }
      const store = useAppStore.getState();
      const req = store.addRequest(collectionId, undefined, {
        protocol: "http",
        method: parsed.method ?? "GET",
        name: parsed.url,
      });
      store.updateRequest(req.id, {
        url: parsed.url,
        params: parsed.params ?? [],
        headers: parsed.headers ?? [],
        body: parsed.body ?? { type: "none", content: "", formData: [] },
        auth: parsed.auth ?? { type: "none" },
      });
      setSuccess("cURL imported as new request");
      setCurlText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "cURL parse failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b pb-2">
          {(["openapi", "postman", "curl"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); reset(); }}
              className={cn(
                "px-3 py-1 text-xs rounded font-medium transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "openapi" ? "OpenAPI / Swagger" : t === "postman" ? "Postman Collection" : "cURL"}
            </button>
          ))}
        </div>

        {(tab === "openapi" || tab === "postman") && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {tab === "openapi"
                ? "Upload an OpenAPI 3.x or Swagger 2.0 file (JSON or YAML). A new collection will be created."
                : "Upload a Postman Collection v2.0 or v2.1 JSON file. A new collection will be created."}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={tab === "openapi" ? ".json,.yaml,.yml" : ".json"}
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, tab); }}
            />
            <Button
              variant="outline"
              className="w-full h-24 border-dashed flex flex-col gap-1.5"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Click to select file</span>
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {success && <p className="text-xs text-emerald-500">{success}</p>}
          </div>
        )}

        {tab === "curl" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste a cURL command to import it as a new request in the current collection.
            </p>
            <Textarea
              placeholder={`curl -X POST 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"John"}'`}
              value={curlText}
              onChange={(e) => setCurlText(e.target.value)}
              className="font-mono text-xs h-32 resize-none"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            {success && <p className="text-xs text-emerald-500">{success}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }}>Close</Button>
          {tab === "curl" && (
            <Button onClick={handleCurlImport} disabled={!curlText.trim()}>Import</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Collection item ────────────────────────────────────────────────────────────

function CollectionItem({ collection }: { collection: Collection }) {
  const {
    requests, folders, expandedCollections, toggleCollection,
    addRequest, addFolder, deleteCollection, updateCollection,
  } = useAppStore();
  const isExpanded = expandedCollections.has(collection.id);
  const colRequests = requests.filter((r) => r.collectionId === collection.id && !r.folderId).sort((a, b) => a.seq - b.seq);
  const colFolders = folders.filter((f) => f.collectionId === collection.id && !f.parentId);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(collection.name);
  const [addFolderDialog, setAddFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [importDialog, setImportDialog] = useState(false);

  const handleRename = () => {
    if (name.trim()) updateCollection(collection.id, { name: name.trim() });
    setRenaming(false);
  };

  const handleAddFolder = () => {
    if (folderName.trim()) {
      addFolder(collection.id, folderName.trim());
      setFolderName("");
      setAddFolderDialog(false);
    }
  };

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer hover:bg-accent"
        onClick={() => toggleCollection(collection.id)}
      >
        <button className="shrink-0 text-muted-foreground">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {renaming ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }}
            className="h-5 text-xs flex-1"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate text-xs font-semibold">{collection.name}</span>
        )}
        <div className="flex opacity-0 group-hover:opacity-100 gap-0.5">
          {/* Quick add HTTP request */}
          <Button
            variant="ghost" size="icon" className="h-5 w-5" title="New HTTP Request (⌘N)"
            onClick={(e) => { e.stopPropagation(); addRequest(collection.id); }}
          >
            <Plus className="h-3 w-3" />
          </Button>
          {/* Collection more menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider py-1">New Request</DropdownMenuLabel>
              {PROTOCOL_ENTRIES.map((entry) => (
                <DropdownMenuItem
                  key={entry.protocol}
                  onClick={() => addRequest(collection.id, undefined, { protocol: entry.protocol, method: entry.method })}
                >
                  <span className={cn("text-[10px] font-bold w-8 shrink-0", entry.badgeClass)}>{entry.badge}</span>
                  {entry.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAddFolderDialog(true)}>
                <FolderPlus className="mr-2 h-3.5 w-3.5" /> New Folder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportDialog(true)}>
                <Upload className="mr-2 h-3.5 w-3.5" /> Import Requests…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setName(collection.name); setRenaming(true); }}>
                <Edit3 className="mr-2 h-3.5 w-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => deleteCollection(collection.id)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded && (
        <div className="ml-3 border-l border-border pl-2 mt-0.5 space-y-0.5">
          {colFolders.map((folder) => (
            <FolderItem key={folder.id} folderId={folder.id} collectionId={collection.id} name={folder.name} />
          ))}
          {colRequests.map((req) => (
            <RequestItem key={req.id} request={req} />
          ))}
        </div>
      )}

      {/* Add folder dialog */}
      <Dialog open={addFolderDialog} onOpenChange={setAddFolderDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
          <Input
            placeholder="Folder name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddFolderDialog(false)}>Cancel</Button>
            <Button onClick={handleAddFolder}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <ImportDialog open={importDialog} onOpenChange={setImportDialog} collectionId={collection.id} />
    </div>
  );
}

// ── Root sidebar ───────────────────────────────────────────────────────────────

export function CollectionSidebar() {
  const { collections, addCollection } = useAppStore();
  const [newColDialog, setNewColDialog] = useState(false);
  const [colName, setColName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [globalImport, setGlobalImport] = useState(false);

  const handleAddCollection = () => {
    if (colName.trim()) {
      addCollection(colName.trim());
      setColName("");
      setNewColDialog(false);
    }
  };

  const filteredCollections = searchQuery.trim()
    ? collections.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : collections;

  // For global import we use the first collection or create one
  const globalImportCollectionId = collections[0]?.id ?? "";

  return (
    <div className="flex flex-col h-full">
      {/* Workspace switcher */}
      <WorkspaceManager />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Collections</span>
        <div className="flex gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Import" onClick={() => setGlobalImport(true)}>
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="New Collection" onClick={() => setNewColDialog(true)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search collections…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 pl-6 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filteredCollections.map((col) => (
            <CollectionItem key={col.id} collection={col} />
          ))}
          {filteredCollections.length === 0 && !searchQuery && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              <p>No collections yet</p>
              <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setNewColDialog(true)}>
                Create your first collection
              </Button>
            </div>
          )}
          {filteredCollections.length === 0 && searchQuery && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              No results for &quot;{searchQuery}&quot;
            </div>
          )}
        </div>
      </ScrollArea>

      {/* New Collection dialog */}
      <Dialog open={newColDialog} onOpenChange={setNewColDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Collection</DialogTitle></DialogHeader>
          <Input
            placeholder="Collection name"
            value={colName}
            onChange={(e) => setColName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddCollection()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewColDialog(false)}>Cancel</Button>
            <Button onClick={handleAddCollection}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Global Import dialog (for when no collection is selected) */}
      {globalImportCollectionId && (
        <ImportDialog open={globalImport} onOpenChange={setGlobalImport} collectionId={globalImportCollectionId} />
      )}
    </div>
  );
}
