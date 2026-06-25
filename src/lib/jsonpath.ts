/**
 * Minimal JSONPath evaluator supporting the most common subset:
 *   $            – root
 *   .key         – object property
 *   ['key']      – bracket notation
 *   [0]          – array index
 *   [*]          – wildcard (returns array of all matches)
 *   ..key        – recursive descent
 *
 * Returns the first match (string coerced) or null.
 * For wildcard paths returns comma-joined matches.
 */
export function jsonpathGet(data: unknown, path: string): string | null {
  if (!path || path === "$") return serialize(data);
  const results = evaluate(data, path.trim());
  if (results.length === 0) return null;
  if (results.length === 1) return serialize(results[0]);
  return results.map(serialize).join(", ");
}

function serialize(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function evaluate(data: unknown, path: string): unknown[] {
  // Normalise: always start with $
  const p = path.startsWith("$") ? path : `$.${path}`;
  const tokens = tokenise(p);
  return applyTokens([data], tokens);
}

type Token =
  | { kind: "root" }
  | { kind: "key"; name: string }
  | { kind: "index"; idx: number }
  | { kind: "wildcard" }
  | { kind: "recursive"; name: string };

function tokenise(path: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = path.length;

  while (i < len) {
    if (path[i] === "$") {
      tokens.push({ kind: "root" });
      i++;
    } else if (path[i] === ".") {
      if (path[i + 1] === ".") {
        // recursive descent
        i += 2;
        const start = i;
        while (i < len && path[i] !== "." && path[i] !== "[") i++;
        tokens.push({ kind: "recursive", name: path.slice(start, i) });
      } else {
        i++;
        const start = i;
        while (i < len && path[i] !== "." && path[i] !== "[") i++;
        const name = path.slice(start, i);
        if (name === "*") tokens.push({ kind: "wildcard" });
        else if (name) tokens.push({ kind: "key", name });
      }
    } else if (path[i] === "[") {
      i++;
      const start = i;
      while (i < len && path[i] !== "]") i++;
      const inner = path.slice(start, i).trim().replace(/^['"]|['"]$/g, "");
      i++; // consume ]
      if (inner === "*") tokens.push({ kind: "wildcard" });
      else if (/^\d+$/.test(inner)) tokens.push({ kind: "index", idx: parseInt(inner, 10) });
      else tokens.push({ kind: "key", name: inner });
    } else {
      i++;
    }
  }
  return tokens;
}

function applyTokens(nodes: unknown[], tokens: Token[]): unknown[] {
  let current = nodes;
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const node of current) {
      switch (token.kind) {
        case "root":
          next.push(node);
          break;
        case "key":
          if (node && typeof node === "object" && !Array.isArray(node)) {
            const v = (node as Record<string, unknown>)[token.name];
            if (v !== undefined) next.push(v);
          }
          break;
        case "index":
          if (Array.isArray(node) && token.idx < node.length) {
            next.push(node[token.idx]);
          }
          break;
        case "wildcard":
          if (Array.isArray(node)) {
            next.push(...node);
          } else if (node && typeof node === "object") {
            next.push(...Object.values(node as Record<string, unknown>));
          }
          break;
        case "recursive":
          collectRecursive(node, token.name, next);
          break;
      }
    }
    current = next;
  }
  return current;
}

function collectRecursive(node: unknown, name: string, acc: unknown[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectRecursive(item, name, acc);
  } else {
    const obj = node as Record<string, unknown>;
    if (name in obj) acc.push(obj[name]);
    for (const val of Object.values(obj)) collectRecursive(val, name, acc);
  }
}
