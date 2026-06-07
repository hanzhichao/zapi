"use client";

import {useState} from "react";
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
  Trash2,
} from "lucide-react";
import {getMethodColor, useAppStore} from "@/lib/store";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,} from "@/components/ui/dialog";
import type {ApiRequest, Collection, HttpMethod} from "@/lib/types";
import {cn} from "@/lib/utils";

function MethodBadge({method}: { method: HttpMethod }) {
  return (
    <span className={cn("text-[10px] font-bold w-10 shrink-0", getMethodColor(method))}>
      {method}
    </span>
  );
}

function RequestItem({request}: { request: ApiRequest }) {
  const {activeRequestId, openRequest, deleteRequest, duplicateRequest, updateRequest} =
    useAppStore();
  const isActive = activeRequestId === request.id;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(request.name);

  const handleRename = () => {
    if (name.trim()) updateRequest(request.id, {name: name.trim()});
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
      <MethodBadge method={request.method}/>
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
            <MoreHorizontal className="h-3 w-3"/>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => {
            setName(request.name);
            setRenaming(true);
          }}>
            <Edit3 className="mr-2 h-3.5 w-3.5"/> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => duplicateRequest(request.id)}>
            <Copy className="mr-2 h-3.5 w-3.5"/> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator/>
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => deleteRequest(request.id)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5"/> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CollectionItem({collection}: { collection: Collection }) {
  const {
    requests,
    folders,
    expandedCollections,
    toggleCollection,
    addRequest,
    addFolder,
    deleteCollection,
    updateCollection,
  } = useAppStore();
  const isExpanded = expandedCollections.has(collection.id);
  const colRequests = requests
    .filter((r) => r.collectionId === collection.id && !r.folderId)
    .sort((a, b) => a.seq - b.seq);
  const colFolders = folders.filter((f) => f.collectionId === collection.id && !f.parentId);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(collection.name);
  const [addFolderDialog, setAddFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");

  const handleRename = () => {
    if (name.trim()) updateCollection(collection.id, {name: name.trim()});
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
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5"/> : <ChevronRight className="h-3.5 w-3.5"/>}
        </button>
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
          <span className="flex-1 truncate text-xs font-semibold">{collection.name}</span>
        )}
        <div className="flex opacity-0 group-hover:opacity-100 gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            title="Add Request"
            onClick={(e) => {
              e.stopPropagation();
              addRequest(collection.id);
            }}
          >
            <Plus className="h-3 w-3"/>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3 w-3"/>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => addRequest(collection.id)}>
                <Plus className="mr-2 h-3.5 w-3.5"/> Add Request
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAddFolderDialog(true)}>
                <FolderPlus className="mr-2 h-3.5 w-3.5"/> Add Folder
              </DropdownMenuItem>
              <DropdownMenuSeparator/>
              <DropdownMenuItem onClick={() => {
                setName(collection.name);
                setRenaming(true);
              }}>
                <Edit3 className="mr-2 h-3.5 w-3.5"/> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator/>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => deleteCollection(collection.id)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5"/> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded && (
        <div className="ml-3 border-l border-border pl-2 mt-0.5 space-y-0.5">
          {colFolders.map((folder) => (
            <FolderItem key={folder.id} folderId={folder.id} collectionId={collection.id} name={folder.name}/>
          ))}
          {colRequests.map((req) => (
            <RequestItem key={req.id} request={req}/>
          ))}
        </div>
      )}

      <Dialog open={addFolderDialog} onOpenChange={setAddFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
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
    </div>
  );
}

function FolderItem({
                      folderId,
                      collectionId,
                      name,
                    }: {
  folderId: string;
  collectionId: string;
  name: string;
}) {
  const {requests, expandedFolders, toggleFolder, addRequest, deleteFolder, updateFolder} =
    useAppStore();
  const isExpanded = expandedFolders.has(folderId);
  const folderRequests = requests
    .filter((r) => r.folderId === folderId)
    .sort((a, b) => a.seq - b.seq);

  const [renaming, setRenaming] = useState(false);
  const [folderName, setFolderName] = useState(name);

  const handleRename = () => {
    if (folderName.trim()) updateFolder(folderId, {name: folderName.trim()});
    setRenaming(false);
  };

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer hover:bg-accent"
        onClick={() => toggleFolder(folderId)}
      >
        {isExpanded ? (
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>
        ) : (
          <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>
        )}
        {renaming ? (
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
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
          <span className="flex-1 truncate text-xs">{name}</span>
        )}
        <div className="flex opacity-0 group-hover:opacity-100 gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={(e) => {
              e.stopPropagation();
              addRequest(collectionId, folderId);
            }}
          >
            <Plus className="h-3 w-3"/>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-3 w-3"/>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => {
                setFolderName(name);
                setRenaming(true);
              }}>
                <Edit3 className="mr-2 h-3.5 w-3.5"/> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator/>
              <DropdownMenuItem className="text-destructive" onClick={() => deleteFolder(folderId)}>
                <Trash2 className="mr-2 h-3.5 w-3.5"/> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {isExpanded && (
        <div className="ml-3 border-l border-border pl-2 mt-0.5 space-y-0.5">
          {folderRequests.map((req) => (
            <RequestItem key={req.id} request={req}/>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollectionSidebar() {
  const {collections, addCollection} = useAppStore();
  const [newColDialog, setNewColDialog] = useState(false);
  const [colName, setColName] = useState("");

  const handleAddCollection = () => {
    if (colName.trim()) {
      addCollection(colName.trim());
      setColName("");
      setNewColDialog(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Collections</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setNewColDialog(true)}>
          <Plus className="h-3.5 w-3.5"/>
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {collections.map((col) => (
            <CollectionItem key={col.id} collection={col}/>
          ))}
          {collections.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              <p>No collections yet</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-xs"
                onClick={() => setNewColDialog(true)}
              >
                Create your first collection
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={newColDialog} onOpenChange={setNewColDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Collection</DialogTitle>
          </DialogHeader>
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
    </div>
  );
}
