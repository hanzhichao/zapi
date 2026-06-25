import type { ApiRequest, HttpMethod, KeyValue } from "./types";

/**
 * Parse a cURL command string into partial ApiRequest fields.
 * Handles: -X method, -H headers, -d/-b/--data body, URL, --user basic auth,
 * -u user:pass, -G/--get, --data-urlencode, -F form fields.
 */
export function parseCurl(curlStr: string): Partial<ApiRequest> & { url: string } {
  // Normalize: remove line continuations, collapse whitespace
  const normalized = curlStr
    .replace(/\\\n/g, " ")
    .replace(/\\\r\n/g, " ")
    .trim();

  // Tokenize respecting single/double quotes and escape sequences
  const tokens = tokenize(normalized);

  // Remove leading "curl"
  if (tokens[0]?.toLowerCase() === "curl") tokens.shift();

  let url = "";
  let method: HttpMethod | undefined;
  const headers: KeyValue[] = [];
  let bodyContent = "";
  let bodyType: "json" | "form" | "text" = "text";
  let username = "";
  let password = "";
  const formFields: KeyValue[] = [];

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (t === "-X" || t === "--request") {
      method = (tokens[++i] as HttpMethod) ?? "GET";
    } else if (t === "-H" || t === "--header") {
      const hdr = tokens[++i] ?? "";
      const idx = hdr.indexOf(":");
      if (idx > 0) {
        headers.push({ id: crypto.randomUUID(), key: hdr.slice(0, idx).trim(), value: hdr.slice(idx + 1).trim(), enabled: true });
      }
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary" || t === "-b") {
      const data = tokens[++i] ?? "";
      bodyContent = data.startsWith("@") ? `<file: ${data.slice(1)}>` : data;
      // Try to detect JSON
      const trimmed = bodyContent.trimStart();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) bodyType = "json";
      else if (bodyContent.includes("=") && !bodyContent.includes("\n")) bodyType = "form";
    } else if (t === "--data-urlencode") {
      const data = tokens[++i] ?? "";
      if (bodyContent) bodyContent += "&" + data;
      else bodyContent = data;
      bodyType = "form";
    } else if (t === "-F" || t === "--form") {
      const field = tokens[++i] ?? "";
      const idx = field.indexOf("=");
      if (idx > 0) {
        formFields.push({ id: crypto.randomUUID(), key: field.slice(0, idx), value: field.slice(idx + 1), enabled: true });
      }
    } else if (t === "-u" || t === "--user") {
      const creds = tokens[++i] ?? "";
      const idx = creds.indexOf(":");
      if (idx >= 0) { username = creds.slice(0, idx); password = creds.slice(idx + 1); }
      else username = creds;
    } else if (t === "-G" || t === "--get") {
      method = "GET";
    } else if (t === "--compressed" || t === "--insecure" || t === "-k" || t === "-s" || t === "--silent" || t === "-v" || t === "--verbose") {
      // ignore
    } else if (t === "--url") {
      url = tokens[++i] ?? "";
    } else if (!t.startsWith("-")) {
      // Bare URL
      if (!url) url = t;
    }

    i++;
  }

  // Determine method from body presence
  if (!method) {
    if (bodyContent || formFields.length > 0) method = "POST";
    else method = "GET";
  }

  // Build params from URL
  const params: KeyValue[] = [];
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.forEach((value, key) => {
      params.push({ id: crypto.randomUUID(), key, value, enabled: true });
    });
    // Clean URL of query params (they go in params)
    url = urlObj.origin + urlObj.pathname;
  } catch { /* keep URL as-is */ }

  const result: Partial<ApiRequest> & { url: string } = {
    url,
    method,
    params,
    headers,
    body: formFields.length > 0
      ? { type: "formdata", content: "", formData: formFields }
      : bodyType === "json"
        ? { type: "json", content: bodyContent, formData: [] }
        : bodyType === "form"
          ? { type: "form", content: bodyContent, formData: bodyContent.split("&").filter(Boolean).map((p) => { const [k, v] = p.split("="); return { id: crypto.randomUUID(), key: decodeURIComponent(k ?? ""), value: decodeURIComponent(v ?? ""), enabled: true }; }) }
          : { type: bodyContent ? "text" : "none", content: bodyContent, formData: [] },
    auth: username
      ? { type: "basic", basic: { username, password } }
      : { type: "none" },
  };

  return result;
}

/** Shell-like tokenizer that handles single/double quotes */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (ch === "'" ) {
      i++;
      while (i < input.length && input[i] !== "'") current += input[i++];
      i++; // closing quote
    } else if (ch === '"') {
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) { i++; current += input[i++]; }
        else current += input[i++];
      }
      i++;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { tokens.push(current); current = ""; }
      i++;
    } else {
      current += ch; i++;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
