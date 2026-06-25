/**
 * Lightweight Mock.js-style @notation resolver.
 * Supports: @username @email @name @first @last @phone @id @uuid @integer @float
 *           @boolean @date @datetime @timestamp @url @ip @color @word @sentence
 *           @paragraph @title @image @pick @string @increment
 *
 * Usage:  resolveMockValue("@email")  →  "user42@example.com"
 *         generateMockFromSchema(params)  →  Record<string, unknown>
 */

import type { ApiParamSchema, ApiResponseScenario } from "./types";

// ── Tiny PRNG (seeded per call so results vary) ────────────────────────────

function rand(min = 0, max = 1): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

// ── Word banks ─────────────────────────────────────────────────────────────

const FIRST_NAMES = ["Alice", "Bob", "Charlie", "Diana", "Eva", "Frank", "Grace", "Henry", "Iris", "Jake", "Kate", "Leo", "Mia", "Noah", "Olivia", "Paul", "Quinn", "Rose", "Sam", "Tina"];
const LAST_NAMES  = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White"];
const DOMAINS     = ["example.com", "test.org", "mail.net", "demo.io", "fake.dev", "sample.co"];
const WORDS       = ["apple", "bridge", "cloud", "delta", "echo", "forest", "globe", "harbor", "idea", "jungle", "kite", "lamp", "moon", "noble", "ocean", "peak", "quest", "river", "stone", "tower", "unity", "value", "wave", "xenon", "yield", "zenith"];
const ADJECTIVES  = ["quick", "bright", "calm", "dark", "eager", "fast", "giant", "happy", "icy", "jolly", "keen", "lazy", "merry", "nice", "old", "pure", "quiet", "rapid", "slow", "tiny"];
const TLDS        = ["com", "net", "org", "io", "dev", "app", "co"];
const STATUS_MSGS = ["OK", "Success", "Created", "Accepted", "No Content"];

let _increment = 1;

// ── Core resolver ──────────────────────────────────────────────────────────

/**
 * Resolve a @mock-notation string to an actual value.
 * Returns the original string unchanged if it doesn't start with "@".
 */
export function resolveMockValue(raw: string): unknown {
  if (!raw.startsWith("@")) return raw;

  // Parse name and optional args: @integer(1,100)
  const match = /^@([a-zA-Z]+)(?:\(([^)]*)\))?$/.exec(raw.trim());
  if (!match) return raw;

  const [, name, argsRaw] = match;
  const args = argsRaw ? argsRaw.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")) : [];
  const n = (i: number, def = 0) => parseFloat(args[i] ?? String(def));

  switch (name.toLowerCase()) {
    // ── Identity / IDs ───────────────────────────────────────────────────
    case "id":
      return randInt(1, 99999);
    case "uuid":
      return crypto.randomUUID();
    case "increment":
      return _increment++;
    case "objectid": {
      const hex = Array.from({ length: 24 }, () => randInt(0, 15).toString(16)).join("");
      return hex;
    }

    // ── People ────────────────────────────────────────────────────────────
    case "first":
      return pick(FIRST_NAMES);
    case "last":
      return pick(LAST_NAMES);
    case "name":
      return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    case "username": {
      const first = pick(FIRST_NAMES).toLowerCase();
      const num   = randInt(1, 999);
      return `${first}${num}`;
    }
    case "email": {
      const user = `${pick(FIRST_NAMES).toLowerCase()}${randInt(1, 999)}`;
      return `${user}@${pick(DOMAINS)}`;
    }
    case "phone": {
      const area = randInt(100, 999);
      const mid  = randInt(100, 999);
      const end  = randInt(1000, 9999);
      return `+1-${area}-${mid}-${end}`;
    }
    case "avatar":
      return `https://i.pravatar.cc/150?u=${randInt(1, 1000)}`;

    // ── Numbers ──────────────────────────────────────────────────────────
    case "integer":
    case "int": {
      const lo = n(0, 0);
      const hi = n(1, 100);
      return randInt(lo, hi);
    }
    case "float":
    case "number": {
      const lo   = n(0, 0);
      const hi   = n(1, 1);
      const prec = n(2, 2);
      return parseFloat(rand(lo, hi).toFixed(prec));
    }
    case "boolean":
    case "bool":
      return Math.random() > 0.5;

    // ── Dates ─────────────────────────────────────────────────────────────
    case "date": {
      const d = new Date(Date.now() - randInt(0, 365 * 3) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    case "datetime": {
      const d = new Date(Date.now() - randInt(0, 365 * 3) * 86400000);
      return d.toISOString();
    }
    case "timestamp":
    case "now":
      return Date.now();

    // ── Network / Web ─────────────────────────────────────────────────────
    case "url": {
      const slug = pick(ADJECTIVES) + "-" + pick(WORDS);
      return `https://${slug}.${pick(TLDS)}`;
    }
    case "ip": {
      return [randInt(1,254), randInt(0,255), randInt(0,255), randInt(1,254)].join(".");
    }
    case "ipv6": {
      const seg = () => randInt(0, 65535).toString(16).padStart(4, "0");
      return Array.from({ length: 8 }, seg).join(":");
    }
    case "image": {
      const w = n(0, 640);
      const h = n(1, 480);
      return `https://picsum.photos/${Math.floor(w)||640}/${Math.floor(h)||480}?r=${randInt(1,9999)}`;
    }
    case "color": {
      const hex = randInt(0, 0xffffff).toString(16).padStart(6, "0");
      return `#${hex}`;
    }

    // ── Text ──────────────────────────────────────────────────────────────
    case "word":
      return pick(WORDS);
    case "string": {
      const len = n(0, 8);
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      return Array.from({ length: Math.floor(len) || 8 }, () => chars[randInt(0, chars.length - 1)]).join("");
    }
    case "sentence": {
      const wordCount = n(0, 8);
      const wc = Math.floor(wordCount) || randInt(5, 12);
      const ws = Array.from({ length: wc }, () => pick(WORDS)).join(" ");
      return ws.charAt(0).toUpperCase() + ws.slice(1) + ".";
    }
    case "paragraph": {
      const sentCount = n(0, 3);
      const sc = Math.floor(sentCount) || randInt(2, 4);
      return Array.from({ length: sc }, () => {
        const wc = randInt(6, 14);
        const ws = Array.from({ length: wc }, () => pick(WORDS)).join(" ");
        return ws.charAt(0).toUpperCase() + ws.slice(1) + ".";
      }).join(" ");
    }
    case "title": {
      const wc = randInt(2, 5);
      return Array.from({ length: wc }, () => pick(WORDS))
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    // ── Misc ──────────────────────────────────────────────────────────────
    case "pick": {
      // @pick(a,b,c) → one of a, b, c
      if (!args.length) return raw;
      return pick(args);
    }
    case "status":
      return pick(STATUS_MSGS);
    case "country":
      return pick(["US", "CN", "UK", "DE", "FR", "JP", "AU", "CA", "BR", "IN"]);
    case "currency":
      return pick(["USD", "EUR", "CNY", "GBP", "JPY", "AUD", "CAD"]);
    case "lang":
      return pick(["en", "zh", "de", "fr", "ja", "es", "pt", "ko"]);

    default:
      return raw;
  }
}

// ── Schema → mock object generator ────────────────────────────────────────

/**
 * Generate a mock JSON object from a flat/nested ApiParamSchema[].
 */
export function generateMockFromSchema(
  params: ApiParamSchema[],
  depth = 0,
): Record<string, unknown> {
  if (depth > 6) return {};
  const result: Record<string, unknown> = {};

  for (const p of params) {
    if (!p.name) continue;
    result[p.name] = generateMockValue(p, depth);
  }
  return result;
}

function generateMockValue(p: ApiParamSchema, depth: number): unknown {
  // If there's an explicit default/mock value, use it (resolve @notation)
  const raw = p.defaultValue?.trim();
  if (raw && raw !== "") {
    const resolved = resolveMockValue(raw);
    if (resolved !== raw) return resolved;  // was @notation, use resolved
    // else it's a literal – still use it below for primitives
  }

  switch (p.type) {
    case "object":
      return p.children?.length
        ? generateMockFromSchema(p.children, depth + 1)
        : {};
    case "array":
      if (p.children?.length) {
        return Array.from({ length: randInt(1, 3) }, () =>
          generateMockFromSchema(p.children, depth + 1)
        );
      }
      return [resolveMockValue("@word"), resolveMockValue("@word")];
    case "integer":
    case "number":
      if (raw) return parseFloat(raw) || resolveMockValue("@integer");
      return resolveMockValue("@integer");
    case "boolean":
      if (raw) return raw === "true";
      return resolveMockValue("@boolean");
    case "string":
    default:
      if (raw) return resolveMockValue(raw);
      // infer mock by field name heuristics
      return inferByName(p.name);
  }
}

function inferByName(name: string): unknown {
  const n = name.toLowerCase();
  if (n.includes("email")) return resolveMockValue("@email");
  if (n.includes("username") || n.includes("name")) return resolveMockValue("@username");
  if (n.includes("phone") || n.includes("mobile") || n.includes("tel")) return resolveMockValue("@phone");
  if (n.includes("url") || n.includes("link") || n.includes("href") || n.includes("src")) return resolveMockValue("@url");
  if (n.includes("avatar") || n.includes("photo") || n.includes("pic") || n.includes("image")) return resolveMockValue("@image");
  if (n.includes("color") || n.includes("colour")) return resolveMockValue("@color");
  if (n.includes("uuid")) return resolveMockValue("@uuid");
  if (n.endsWith("_id") || n.endsWith("id")) return resolveMockValue("@id");
  if (n.includes("_at") || n.includes("_date") || n.endsWith("date")) return resolveMockValue("@datetime");
  if (n.includes("title") || n.includes("subject")) return resolveMockValue("@title");
  if (n.includes("desc") || n.includes("content") || n.includes("body") || n.includes("text") || n.includes("remark")) return resolveMockValue("@sentence");
  if (n.includes("count") || n.includes("total") || n.includes("num") || n.includes("amount") || n.includes("qty")) return resolveMockValue("@integer(0,1000)");
  if (n.includes("price") || n.includes("fee") || n.includes("cost") || n.includes("balance")) return resolveMockValue("@float(0,9999,2)");
  if (n.includes("status")) return resolveMockValue("@pick(active,inactive,pending)");
  if (n.includes("country")) return resolveMockValue("@country");
  if (n.includes("lang") || n.includes("locale")) return resolveMockValue("@lang");
  return resolveMockValue("@word");
}

/**
 * Generate a mock response body JSON string for a scenario.
 */
export function generateMockResponse(scenario: ApiResponseScenario): string {
  _increment = 1;  // reset per generation
  const obj = generateMockFromSchema(scenario.schema);
  return JSON.stringify(obj, null, 2);
}

/** List all known @tokens for autocomplete */
export const MOCK_TOKENS = [
  "@id", "@uuid", "@increment", "@objectid",
  "@first", "@last", "@name", "@username", "@email", "@phone", "@avatar",
  "@integer", "@integer(1,100)", "@float", "@float(0,100,2)", "@boolean",
  "@date", "@datetime", "@timestamp", "@now",
  "@url", "@ip", "@image", "@image(640,480)", "@color",
  "@word", "@string", "@string(8)", "@sentence", "@paragraph", "@title",
  "@pick(a,b,c)",
  "@status", "@country", "@currency", "@lang",
];
