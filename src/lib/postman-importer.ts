import type { ApiRequest, HttpMethod, KeyValue, RequestBody, AuthConfig } from "./types";

type ImportedRequest = Omit<ApiRequest, "id" | "collectionId" | "seq" | "createdAt" | "updatedAt">;

export interface PostmanImportResult {
  collectionName: string;
  requests: ImportedRequest[];
  variables: { name: string; value: string }[];
}

type AnyObj = Record<string, unknown>;

function asObj(v: unknown): AnyObj { return (v && typeof v === "object" ? v : {}) as AnyObj; }
function asStr(v: unknown): string { return typeof v === "string" ? v : ""; }
function asArr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }

export function parsePostmanCollection(content: string): PostmanImportResult {
  let doc: AnyObj;
  try {
    doc = JSON.parse(content) as AnyObj;
  } catch {
    throw new Error("Cannot parse Postman collection: must be valid JSON");
  }

  const info = asObj(doc.info);

  // Support v2.0 and v2.1
  const schema = asStr(info.schema);
  if (!schema.includes("collection")) {
    throw new Error("Unsupported format: must be a Postman Collection v2.0 or v2.1");
  }

  const collectionName = asStr(info.name) || "Imported Collection";
  const requests: ImportedRequest[] = [];
  const variables: { name: string; value: string }[] = [];

  // Collection-level variables
  for (const v of asArr(doc.variable)) {
    const vo = asObj(v);
    if (vo.key) variables.push({ name: asStr(vo.key), value: asStr(vo.value) });
  }

  function processItems(items: unknown[], folderId?: string): void {
    for (const item of items) {
      const it = asObj(item);
      if (!it) continue;

      // Folder (has items array)
      if (Array.isArray(it.item)) {
        processItems(asArr(it.item), asStr(it.name) || undefined);
        continue;
      }

      // Request item
      const req = asObj(it.request);
      if (!req || Object.keys(req).length === 0) continue;

      const name = asStr(it.name) || "Untitled Request";

      // URL
      let url = "";
      const rawUrl = req.url;
      if (typeof rawUrl === "string") {
        url = rawUrl;
      } else if (rawUrl && typeof rawUrl === "object") {
        const rawUrlObj = asObj(rawUrl);
        url = asStr(rawUrlObj.raw) || buildUrl(rawUrlObj);
      }

      // Method
      const method: HttpMethod = (asStr(req.method) as HttpMethod) || "GET";

      // Headers
      const headers: KeyValue[] = [];
      for (const h of asArr(req.header)) {
        const ho = asObj(h);
        if (ho.key && !ho.disabled) {
          headers.push({ id: crypto.randomUUID(), key: asStr(ho.key), value: asStr(ho.value), enabled: true, description: asStr(ho.description) });
        }
      }

      // Query params (from URL object)
      const params: KeyValue[] = [];
      if (rawUrl && typeof rawUrl === "object") {
        const rawUrlObj = asObj(rawUrl);
        for (const q of asArr(rawUrlObj.query)) {
          const qo = asObj(q);
          if (qo.key) {
            params.push({ id: crypto.randomUUID(), key: asStr(qo.key), value: asStr(qo.value), enabled: !qo.disabled });
          }
        }
        // Clean URL of query string if params extracted
        if (params.length > 0 && url.includes("?")) {
          url = url.split("?")[0] ?? url;
        }
      }

      // Body
      const body: RequestBody = parseBody(asObj(it.request) ? asObj(req.body) : undefined);

      // Auth
      const auth: AuthConfig = parseAuth(asObj(req.auth));

      // Description
      const descRaw = req.description;
      const description = typeof descRaw === "string" ? descRaw : asStr(asObj(descRaw).content);

      requests.push({
        folderId: folderId ?? undefined,
        name,
        method,
        url,
        params,
        headers,
        body,
        auth,
        description,
      });
    }
  }

  processItems(asArr(doc.item));

  return { collectionName, requests, variables };
}

function buildUrl(urlObj: AnyObj): string {
  const protocol = asStr(urlObj.protocol) || "https";
  const host = Array.isArray(urlObj.host) ? (urlObj.host as string[]).join(".") : asStr(urlObj.host);
  const path = Array.isArray(urlObj.path) ? "/" + (urlObj.path as string[]).join("/") : asStr(urlObj.path);
  const port = urlObj.port ? `:${asStr(urlObj.port)}` : "";
  return `${protocol}://${host}${port}${path}`;
}

function parseBody(bodyObj: AnyObj | undefined): RequestBody {
  if (!bodyObj || Object.keys(bodyObj).length === 0) return { type: "none", content: "", formData: [] };

  const mode = asStr(bodyObj.mode) || "none";

  if (mode === "raw") {
    const content = asStr(bodyObj.raw);
    const lang = asStr(asObj(asObj(bodyObj.options).raw).language);
    const trimmed = content.trimStart();
    let type: "json" | "xml" | "text" = "text";
    if (lang === "json" || trimmed.startsWith("{") || trimmed.startsWith("[")) type = "json";
    else if (lang === "xml" || trimmed.startsWith("<")) type = "xml";
    return { type, content, formData: [] };
  }

  if (mode === "urlencoded") {
    const formData: KeyValue[] = asArr(bodyObj.urlencoded).map((f) => {
      const fo = asObj(f);
      return { id: crypto.randomUUID(), key: asStr(fo.key), value: asStr(fo.value), enabled: !fo.disabled };
    });
    const content = formData.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join("&");
    return { type: "form", content, formData };
  }

  if (mode === "formdata") {
    const formData: KeyValue[] = asArr(bodyObj.formdata).map((f) => {
      const fo = asObj(f);
      return { id: crypto.randomUUID(), key: asStr(fo.key), value: asStr(fo.value) || asStr(fo.src), enabled: !fo.disabled };
    });
    return { type: "formdata", content: "", formData };
  }

  if (mode === "graphql") {
    const gql = asObj(bodyObj.graphql);
    const query = asStr(gql.query);
    const variables = gql.variables ? JSON.stringify(gql.variables) : "";
    return { type: "graphql", content: query + (variables ? `\n// variables: ${variables}` : ""), formData: [] };
  }

  return { type: "none", content: "", formData: [] };
}

function parseAuth(authObj: AnyObj | undefined): AuthConfig {
  if (!authObj || Object.keys(authObj).length === 0) return { type: "none" };

  const type = asStr(authObj.type) || "noauth";
  if (type === "noauth") return { type: "none" };

  if (type === "basic") {
    const vals = keyValueListToObj(asArr(authObj.basic));
    return { type: "basic", basic: { username: vals.username ?? "", password: vals.password ?? "" } };
  }

  if (type === "bearer") {
    const vals = keyValueListToObj(asArr(authObj.bearer));
    return { type: "bearer", bearer: { token: vals.token ?? "" } };
  }

  if (type === "apikey") {
    const vals = keyValueListToObj(asArr(authObj.apikey));
    const addTo = vals.in === "query" ? "query" : "header";
    return { type: "api-key", apiKey: { key: vals.key ?? "", value: vals.value ?? "", addTo } };
  }

  if (type === "oauth2") {
    const vals = keyValueListToObj(asArr(authObj.oauth2));
    return {
      type: "oauth2",
      oauth2: {
        grantType: "client_credentials",
        tokenUrl: vals.accessTokenUrl ?? "",
        authUrl: vals.authUrl ?? "",
        clientId: vals.clientId ?? "",
        clientSecret: vals.clientSecret ?? "",
        scope: vals.scope ?? "",
        accessToken: vals.accessToken ?? "",
        addTo: vals.addTokenTo === "queryParams" ? "query" : "header",
      },
    };
  }

  return { type: "none" };
}

function keyValueListToObj(list: unknown[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const item of list) {
    const io = asObj(item);
    if (io.key) obj[asStr(io.key)] = asStr(io.value);
  }
  return obj;
}
