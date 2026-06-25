import yaml from "js-yaml";
import type { ApiRequest, HttpMethod, KeyValue, RequestBody } from "./types";

type ImportedRequest = Omit<ApiRequest, "id" | "collectionId" | "seq" | "createdAt" | "updatedAt">;

export interface ImportResult {
  collectionName: string;
  requests: ImportedRequest[];
  variables: { name: string; value: string }[];
}

type AnyObj = Record<string, unknown>;

function asObj(v: unknown): AnyObj { return (v && typeof v === "object" ? v : {}) as AnyObj; }
function asStr(v: unknown): string { return typeof v === "string" ? v : ""; }
function asArr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function asBool(v: unknown): boolean { return typeof v === "boolean" ? v : !!v; }

export function parseOpenApi(content: string): ImportResult {
  let doc: AnyObj;
  try {
    doc = yaml.load(content) as AnyObj;
  } catch {
    try {
      doc = JSON.parse(content) as AnyObj;
    } catch {
      throw new Error("Cannot parse file: must be valid JSON or YAML");
    }
  }

  const isSwagger2 = asStr(doc.swagger).startsWith("2");
  const isOpenApi3 = asStr(doc.openapi).startsWith("3");

  if (!isSwagger2 && !isOpenApi3) {
    throw new Error("Unsupported format: must be OpenAPI 3.x or Swagger 2.0");
  }

  const info = asObj(doc.info);
  const collectionName: string = asStr(info.title) || "Imported API";

  // Determine base URL variable
  const variables: { name: string; value: string }[] = [];
  let baseUrl = "";

  if (isOpenApi3) {
    const servers = asArr(doc.servers);
    const server = asObj(servers[0]);
    if (server.url) {
      baseUrl = asStr(server.url);
      variables.push({ name: "baseUrl", value: baseUrl });
    }
  } else if (isSwagger2) {
    const schemes = asArr(doc.schemes);
    const scheme = asStr(schemes[0]) || "https";
    const host = asStr(doc.host);
    const basePath = asStr(doc.basePath);
    if (host) {
      baseUrl = `${scheme}://${host}${basePath}`;
      variables.push({ name: "baseUrl", value: baseUrl });
    }
  }

  const paths: AnyObj = asObj(doc.paths);
  const requests: ImportedRequest[] = [];

  const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pi = asObj(pathItem);

    for (const method of HTTP_METHODS) {
      const operation = asObj(pi[method.toLowerCase()]);
      if (!operation || Object.keys(operation).length === 0) continue;

      const opId = asStr(operation.operationId);
      const summary = asStr(operation.summary) || asStr(operation.description);
      const name = opId || summary || `${method} ${path}`;

      // Build URL with path params as {{param}}
      const urlPath = path.replace(/\{(\w+)\}/g, "{{$1}}");
      const url = "{{baseUrl}}" + urlPath;

      // Query params
      const params: KeyValue[] = [];
      const headers: KeyValue[] = [];

      const opParams = asArr(operation.parameters).length > 0 ? asArr(operation.parameters) : asArr(pi.parameters);
      for (const param of opParams) {
        const resolvedParam = resolveRef(doc, param);
        if (!resolvedParam) continue;

        const pname = asStr(resolvedParam.name);
        const pin = asStr(resolvedParam.in);
        const schema = asObj(resolvedParam.schema);
        const pexample = resolvedParam.example ?? schema.example ?? schema.default ?? "";
        const pval = String(pexample ?? "");

        if (pin === "query") {
          params.push({ id: crypto.randomUUID(), key: pname, value: pval, enabled: asBool(resolvedParam.required), description: asStr(resolvedParam.description) });
        } else if (pin === "header" && pname.toLowerCase() !== "authorization") {
          headers.push({ id: crypto.randomUUID(), key: pname, value: pval, enabled: true });
        }
      }

      // Body
      let body: RequestBody = { type: "none", content: "", formData: [] };
      const requestBody = resolveRef(doc, operation.requestBody);
      if (requestBody) {
        const bodyContent = asObj(requestBody.content);
        if (bodyContent["application/json"]) {
          const jsonSchema = asObj(asObj(bodyContent["application/json"]).schema);
          body = { type: "json", content: schemaToExample(jsonSchema, doc), formData: [] };
        } else if (bodyContent["application/xml"]) {
          body = { type: "xml", content: "", formData: [] };
        } else if (bodyContent["application/x-www-form-urlencoded"]) {
          body = { type: "form", content: "", formData: [] };
        } else if (bodyContent["multipart/form-data"]) {
          body = { type: "formdata", content: "", formData: [] };
        }
      }

      // Description from responses
      const responses = asObj(operation.responses);
      const responseSummaries = Object.entries(responses)
        .map(([code, resp]) => {
          const r = resolveRef(doc, resp);
          return `${code}: ${r ? asStr(r.description) : ""}`;
        })
        .join("\n");

      const description = [
        asStr(operation.description) || summary,
        responseSummaries ? `\nResponses:\n${responseSummaries}` : "",
      ].filter(Boolean).join("\n");

      requests.push({
        folderId: undefined,
        name,
        method: method as HttpMethod,
        url,
        params,
        headers,
        body,
        auth: { type: "none" },
        description,
      });
    }
  }

  return { collectionName, requests, variables };
}

function resolveRef(doc: AnyObj, obj: unknown): AnyObj | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as AnyObj;
  if ("$ref" in o) {
    const ref = asStr(o.$ref);
    const parts = ref.replace(/^#\//, "").split("/");
    let cur: AnyObj = doc;
    for (const part of parts) {
      cur = asObj(cur[part]);
      if (!cur || Object.keys(cur).length === 0) return null;
    }
    return cur;
  }
  return o;
}

function schemaToExample(schema: AnyObj, doc: AnyObj, depth = 0): string {
  if (!schema || depth > 5) return "{}";
  const resolved = resolveRef(doc, schema);
  if (!resolved) return "{}";

  if (resolved.example !== undefined) return JSON.stringify(resolved.example, null, 2);

  const type = asStr(resolved.type);

  if (type === "object" || resolved.properties) {
    const props = asObj(resolved.properties);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      const resolvedProp = resolveRef(doc, val);
      if (!resolvedProp) continue;
      const ptype = asStr(resolvedProp.type);
      if (resolvedProp.example !== undefined) out[key] = resolvedProp.example;
      else if (ptype === "string") out[key] = resolvedProp.default ?? "";
      else if (ptype === "integer" || ptype === "number") out[key] = resolvedProp.default ?? 0;
      else if (ptype === "boolean") out[key] = resolvedProp.default ?? false;
      else if (ptype === "array") out[key] = [];
      else if (ptype === "object") {
        try { out[key] = JSON.parse(schemaToExample(resolvedProp, doc, depth + 1)); } catch { out[key] = {}; }
      }
    }
    return JSON.stringify(out, null, 2);
  }

  if (type === "array") {
    const items = asObj(resolved.items);
    const itemExample = schemaToExample(items, doc, depth + 1);
    return `[\n  ${itemExample}\n]`;
  }

  return "{}";
}
