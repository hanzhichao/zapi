"use client";

import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceFileData {
  version: 1;
  collections: unknown[];
  folders: unknown[];
  requests: unknown[];
  history: unknown[];
  environments: unknown[];
  activeEnvironmentId: string | null;
  layoutMode: string;
  mockEndpoints: unknown[];
  mockServerPort: number;
  aiSettings: unknown;
  apiSpecs: unknown[];
  pluginPersistedState: Record<string, unknown>;
  wsFilters: unknown[];
  wsStateMachines: unknown[];
  openRequestIds?: string[];
  activeRequestId?: string | null;
}

export interface AppConfig {
  lastWorkspacePath: string | null;
  recentWorkspaces: Array<{ path: string; name: string }>;
  openRequestIds?: string[];
  activeRequestId?: string | null;
  windowWidth?: number;
  windowHeight?: number;
}

// ── Low-level Tauri FS wrappers ────────────────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function wsFileRead(path: string): Promise<string | null> {
  return invoke<string | null>("workspace_file_read", { path });
}

export async function wsFileWrite(path: string, content: string): Promise<void> {
  return invoke("workspace_file_write", { path, content });
}

export async function wsEnsureDir(path: string): Promise<void> {
  return invoke("workspace_ensure_dir", { path });
}

export async function pickDirectory(): Promise<string | null> {
  return invoke<string | null>("workspace_pick_directory");
}

async function getAppDataDir(): Promise<string> {
  return invoke<string>("get_app_data_dir");
}

// ── Workspace helpers ─────────────────────────────────────────────────────────

export function workspaceFileName(workspacePath: string): string {
  return `${workspacePath}/.zapi/workspace.json`;
}

export async function readWorkspace(workspacePath: string): Promise<WorkspaceFileData | null> {
  try {
    const text = await wsFileRead(workspaceFileName(workspacePath));
    if (!text) return null;
    return JSON.parse(text) as WorkspaceFileData;
  } catch {
    return null;
  }
}

export async function writeWorkspace(workspacePath: string, data: WorkspaceFileData): Promise<void> {
  await wsEnsureDir(`${workspacePath}/.zapi`);
  await wsFileWrite(workspaceFileName(workspacePath), JSON.stringify(data, null, 2));
}

// ── App config (recent workspaces list) ───────────────────────────────────────

export async function readAppConfig(): Promise<AppConfig> {
  if (!isTauri()) return { lastWorkspacePath: null, recentWorkspaces: [] };
  try {
    const dir = await getAppDataDir();
    const text = await wsFileRead(`${dir}/config.json`);
    if (!text) return { lastWorkspacePath: null, recentWorkspaces: [] };
    return JSON.parse(text) as AppConfig;
  } catch {
    return { lastWorkspacePath: null, recentWorkspaces: [] };
  }
}

export async function writeAppConfig(config: AppConfig): Promise<void> {
  if (!isTauri()) return;
  try {
    const dir = await getAppDataDir();
    await wsEnsureDir(dir);
    await wsFileWrite(`${dir}/config.json`, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Failed to write app config:", err);
  }
}

export function workspaceNameFromPath(dirPath: string): string {
  const normalized = dirPath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? dirPath;
}
