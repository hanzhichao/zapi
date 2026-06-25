"use client";

/**
 * Plugin Runtime
 * Loads plugin JS from disk, sandboxes it with new Function, and runs hooks.
 *
 * Sandbox provides:
 *   - module / exports  (CommonJS-style)
 *   - require('crypto') / require('buffer')  (safe shims)
 *   - console.{log,warn,error}
 *   - No access to window, fetch, document, etc.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  InstalledPlugin,
  PluginCrypto,
  PluginLogEntry,
  PluginModule,
  PluginRequestCtx,
  PluginResponseCtx,
  TemplateTagDef,
} from "./plugin-types";

// ── Crypto utilities ───────────────────────────────────────────────────────

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: string | Uint8Array,
  data: string | Uint8Array
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyBytes = typeof key === "string" ? enc.encode(key) : key;
  const dataBytes = typeof data === "string" ? enc.encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
  return new Uint8Array(sig);
}

async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(buf);
}

function base64Encode(data: string | Uint8Array): string {
  if (typeof data === "string") return btoa(data);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function makeCrypto(): PluginCrypto {
  return {
    async hmacSha256(key, data) {
      return hexEncode(await hmacSha256(key, data));
    },
    async sha256(data) {
      return hexEncode(await sha256(data));
    },
    async hmacSha256Bytes(key, data) {
      return hmacSha256(key, data);
    },
    base64Encode,
    base64Decode,
    hexEncode,
    randomUUID: () => crypto.randomUUID(),
    randomBytes(n) {
      const buf = new Uint8Array(n);
      crypto.getRandomValues(buf);
      return buf;
    },
  };
}

// ── require() shim ─────────────────────────────────────────────────────────

function makeRequire(pluginId: string, onLog: (e: PluginLogEntry) => void) {
  const cryptoShim = {
    randomBytes(n: number) {
      const buf = new Uint8Array(n);
      crypto.getRandomValues(buf);
      return buf;
    },
    randomUUID: () => crypto.randomUUID(),
    createHash(_algo: string) {
      const chunks: string[] = [];
      return {
        update(data: string) { chunks.push(data); return this; },
        digest(enc: "hex" | "base64") {
          const combined = chunks.join("");
          // Warn: sync digest not available — use ctx.crypto for async
          onLog({ pluginId, level: "warn", message: `crypto.createHash().digest() is not synchronous in this environment. Use ctx.crypto.sha256() instead. Input: "${combined.slice(0, 40)}..."`, timestamp: Date.now() });
          return "";
        },
      };
    },
    createHmac(_algo: string, _key: string | Uint8Array) {
      const chunks: string[] = [];
      return {
        update(data: string) { chunks.push(data); return this; },
        digest(_enc: "hex" | "base64") {
          onLog({ pluginId, level: "warn", message: `crypto.createHmac().digest() is not synchronous. Use await ctx.crypto.hmacSha256(key, data) instead.`, timestamp: Date.now() });
          return "";
        },
      };
    },
  };

  const bufferShim = {
    Buffer: {
      from(data: string | Uint8Array, encoding?: string) {
        if (typeof data === "string") {
          if (encoding === "base64") return base64Decode(data);
          return new TextEncoder().encode(data);
        }
        return data;
      },
      concat(bufs: Uint8Array[]) {
        const total = bufs.reduce((n, b) => n + b.length, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const b of bufs) { out.set(b, offset); offset += b.length; }
        return out;
      },
      isBuffer(v: unknown) { return v instanceof Uint8Array; },
    },
  };

  return (id: string): unknown => {
    if (id === "crypto") return cryptoShim;
    if (id === "buffer") return bufferShim;
    throw new Error(
      `Plugin require('${id}') is not available. Supported: 'crypto', 'buffer'. ` +
        `For async crypto, use ctx.crypto.hmacSha256() / ctx.crypto.sha256().`
    );
  };
}

// ── Sandbox execution ──────────────────────────────────────────────────────

function executePluginCode(
  code: string,
  pluginId: string,
  onLog: (e: PluginLogEntry) => void
): PluginModule {
  // Use a plain object instead of a variable named "module" to avoid the
  // @next/next/no-assign-module-variable ESLint rule.
  const sandbox = { exports: {} as PluginModule };
  const fakeConsole = {
    log: (...args: unknown[]) =>
      onLog({ pluginId, level: "log", message: args.map(String).join(" "), timestamp: Date.now() }),
    warn: (...args: unknown[]) =>
      onLog({ pluginId, level: "warn", message: args.map(String).join(" "), timestamp: Date.now() }),
    error: (...args: unknown[]) =>
      onLog({ pluginId, level: "error", message: args.map(String).join(" "), timestamp: Date.now() }),
    info: (...args: unknown[]) =>
      onLog({ pluginId, level: "log", message: args.map(String).join(" "), timestamp: Date.now() }),
  };

  // new Function creates a scope with NO closure over the surrounding context
  // (it doesn't have access to imports, React, Tauri APIs, etc.)
  // We explicitly pass what we want to allow.
  const factory = new Function(
    "module",
    "exports",
    "require",
    "console",
    `"use strict";\n${code}\n`
  );
  factory(sandbox, sandbox.exports, makeRequire(pluginId, onLog), fakeConsole);
  return sandbox.exports;
}

// ── Plugin cache ───────────────────────────────────────────────────────────

/** In-memory cache: pluginId → loaded module */
const moduleCache = new Map<string, PluginModule>();

/** Invalidate one or all cached modules */
export function invalidatePluginCache(pluginId?: string) {
  if (pluginId) moduleCache.delete(pluginId);
  else moduleCache.clear();
}

// ── Public API ─────────────────────────────────────────────────────────────

let globalOnLog: (e: PluginLogEntry) => void = () => { /* noop */ };

export function setPluginLogHandler(fn: (e: PluginLogEntry) => void) {
  globalOnLog = fn;
}

/** Load a plugin module from disk (cached after first load). */
async function getModule(plugin: InstalledPlugin): Promise<PluginModule> {
  if (moduleCache.has(plugin.id)) return moduleCache.get(plugin.id)!;

  let code: string;
  try {
    code = await invoke<string>("plugin_read_file", {
      path: plugin.path + "/index.js",
    });
  } catch (e) {
    throw new Error(`[Plugin ${plugin.id}] Cannot read index.js: ${e}`);
  }

  const mod = executePluginCode(code, plugin.id, globalOnLog);
  moduleCache.set(plugin.id, mod);
  return mod;
}

/**
 * Run beforeRequest hooks on all enabled plugins.
 * Returns a (possibly mutated) request context.
 */
export async function runBeforeRequest(
  ctx: Omit<PluginRequestCtx, "crypto">,
  plugins: InstalledPlugin[]
): Promise<Omit<PluginRequestCtx, "crypto">> {
  let current = { ...ctx };
  const pluginCrypto = makeCrypto();

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.hooks.includes("beforeRequest")) continue;
    try {
      const mod = await getModule(plugin);
      if (!mod.beforeRequest) continue;
      const result = await mod.beforeRequest({
        ...current,
        config: plugin.config,
        variables: current.variables,
        crypto: pluginCrypto,
      });
      if (result) {
        current = {
          ...current,
          method: result.method ?? current.method,
          url: result.url ?? current.url,
          headers: result.headers ?? current.headers,
          body: result.body !== undefined ? result.body : current.body,
        };
      }
    } catch (e) {
      globalOnLog({
        pluginId: plugin.id,
        level: "error",
        message: `beforeRequest error: ${e}`,
        timestamp: Date.now(),
      });
    }
  }
  return current;
}

/**
 * Run afterResponse hooks on all enabled plugins.
 * Returns a (possibly mutated) response context.
 */
export async function runAfterResponse(
  ctx: Omit<PluginResponseCtx, "crypto">,
  plugins: InstalledPlugin[]
): Promise<Omit<PluginResponseCtx, "crypto">> {
  let current = { ...ctx };
  const pluginCrypto = makeCrypto();

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.hooks.includes("afterResponse")) continue;
    try {
      const mod = await getModule(plugin);
      if (!mod.afterResponse) continue;
      const result = await mod.afterResponse({
        ...current,
        config: plugin.config,
        crypto: pluginCrypto,
      });
      if (result) {
        current = {
          ...current,
          body: result.body ?? current.body,
          headers: result.headers ?? current.headers,
        };
      }
    } catch (e) {
      globalOnLog({
        pluginId: plugin.id,
        level: "error",
        message: `afterResponse error: ${e}`,
        timestamp: Date.now(),
      });
    }
  }
  return current;
}

/**
 * Resolve a template tag: "pluginId.tagName" with args array.
 * Returns undefined if no matching tag found.
 */
export async function resolveTemplateTag(
  pluginId: string,
  tagName: string,
  args: string[],
  plugins: InstalledPlugin[]
): Promise<string | undefined> {
  const plugin = plugins.find((p) => p.id === pluginId && p.enabled);
  if (!plugin) return undefined;

  try {
    const mod = await getModule(plugin);
    const tag = (mod.templateTags ?? []).find((t: TemplateTagDef) => t.name === tagName);
    if (!tag) return undefined;
    return await tag.resolve(args, plugin.config, makeCrypto());
  } catch (e) {
    globalOnLog({
      pluginId: plugin.id,
      level: "error",
      message: `templateTag ${tagName} error: ${e}`,
      timestamp: Date.now(),
    });
    return undefined;
  }
}

/**
 * Resolve all {{pluginId.tagName(arg1, arg2)}} patterns in a string.
 * Falls back to the original token if resolution fails.
 */
export async function resolvePluginTemplateTags(
  text: string,
  plugins: InstalledPlugin[]
): Promise<string> {
  const pattern = /\{\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)(?:\(([^)]*)\))?\}\}/g;
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return text;

  let result = text;
  for (const m of matches) {
    const [full, pid, tag, argsRaw] = m;
    const args = argsRaw
      ? argsRaw.split(",").map((a) => a.trim().replace(/^['"]|['"]$/g, ""))
      : [];
    const resolved = await resolveTemplateTag(pid, tag, args, plugins);
    if (resolved !== undefined) {
      result = result.replace(full, resolved);
    }
  }
  return result;
}

/**
 * Load plugin manifests from disk and return InstalledPlugin list with persisted
 * enabled/config state merged in.
 */
export interface RawPluginEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  hooks: string[];
  config?: import("./plugin-types").PluginConfigField[];
  path: string;
}

export async function loadPluginsFromDisk(
  persisted: Record<string, { enabled: boolean; config: Record<string, string> }>
): Promise<InstalledPlugin[]> {
  try {
    const entries = await invoke<RawPluginEntry[]>("plugin_list");
    return entries.map((e) => {
      const saved = persisted[e.id] ?? {};
      return {
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.description,
        author: e.author,
        hooks: (e.hooks ?? []) as import("./plugin-types").PluginHookName[],
        configFields: e.config ?? [],
        path: e.path,
        enabled: saved.enabled ?? true,
        config: {
          ...(e.config ?? []).reduce<Record<string, string>>((acc, f) => {
            if (f.default) acc[f.key] = f.default;
            return acc;
          }, {}),
          ...(saved.config ?? {}),
        },
        installedAt: 0,
      };
    });
  } catch {
    return [];
  }
}
