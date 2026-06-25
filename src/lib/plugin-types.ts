// ── Plugin System Types ────────────────────────────────────────────────────

/** Fields in plugin.json manifest */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  /** Hooks this plugin implements */
  hooks: PluginHookName[];
  /** Configurable fields shown in Plugin Manager */
  config?: PluginConfigField[];
}

export type PluginHookName =
  | "beforeRequest"   // modify request before sending
  | "afterResponse"   // inspect / transform response
  | "templateTag";    // custom {{pluginId.tagName(...)}} variables

export interface PluginConfigField {
  key: string;
  label: string;
  type: "string" | "secret" | "number" | "boolean" | "select";
  options?: string[];       // for type="select"
  default?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
}

// ── Plugin state (stored in Zustand) ──────────────────────────────────────

/** An installed plugin's persisted state */
export interface InstalledPlugin {
  /** Matches plugin.json id */
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  hooks: PluginHookName[];
  configFields: PluginConfigField[];
  /** Absolute path to the plugin folder on disk */
  path: string;
  enabled: boolean;
  /** User-supplied config values (key → value) */
  config: Record<string, string>;
  installedAt: number;
}

// ── Plugin execution context ───────────────────────────────────────────────

export interface PluginRequestCtx {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  /** Plugin's own config */
  config: Record<string, string>;
  /** Resolved env/collection variables */
  variables: Record<string, string>;
  /** Crypto utilities for signing */
  crypto: PluginCrypto;
}

export interface PluginResponseCtx {
  request: Omit<PluginRequestCtx, "crypto">;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  config: Record<string, string>;
  crypto: PluginCrypto;
}

/** Async crypto utilities injected into every plugin context */
export interface PluginCrypto {
  /** Returns hex string */
  hmacSha256(key: string | Uint8Array, data: string | Uint8Array): Promise<string>;
  /** Returns hex string */
  sha256(data: string | Uint8Array): Promise<string>;
  /** Returns hex string */
  hmacSha256Bytes(key: string | Uint8Array, data: string | Uint8Array): Promise<Uint8Array>;
  base64Encode(data: string | Uint8Array): string;
  base64Decode(data: string): Uint8Array;
  hexEncode(data: Uint8Array): string;
  randomUUID(): string;
  randomBytes(n: number): Uint8Array;
}

// ── Plugin module (what index.js exports) ─────────────────────────────────

export interface TemplateTagDef {
  /** Tag name, used as {{pluginId.tagName}} */
  name: string;
  displayName?: string;
  description?: string;
  args?: Array<{ name: string; type: "string" | "number"; default?: string }>;
  resolve(args: string[], config: Record<string, string>, crypto: PluginCrypto): Promise<string>;
}

export interface PluginModule {
  beforeRequest?(ctx: PluginRequestCtx): Promise<Partial<Omit<PluginRequestCtx, "config" | "variables" | "crypto">> | void>;
  afterResponse?(ctx: PluginResponseCtx): Promise<Partial<Pick<PluginResponseCtx, "body" | "headers">> | void>;
  templateTags?: TemplateTagDef[];
}

// ── Log entry emitted by plugins ───────────────────────────────────────────

export interface PluginLogEntry {
  pluginId: string;
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}
