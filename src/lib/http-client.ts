import { fetch } from "@tauri-apps/plugin-http";
import type { ApiRequest, CollectionVariable, KeyValue, ResponseData } from "./types";
import { resolveVariables } from "./store";

export function buildUrl(url: string, params: KeyValue[]): string {
  const enabledParams = params.filter((p) => p.enabled && p.key);
  if (enabledParams.length === 0) return url;
  const qs = new URLSearchParams(enabledParams.map((p) => [p.key, p.value])).toString();
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}

export function buildHeaders(
  request: ApiRequest,
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const h of request.headers) {
    if (h.enabled && h.key) headers[h.key] = h.value;
  }

  if (request.auth.type === "bearer" && request.auth.bearer?.token) {
    headers["Authorization"] = `Bearer ${request.auth.bearer.token}`;
  } else if (request.auth.type === "basic" && request.auth.basic) {
    const { username, password } = request.auth.basic;
    headers["Authorization"] = `Basic ${btoa(`${username}:${password}`)}`;
  } else if (request.auth.type === "api-key" && request.auth.apiKey) {
    const { key, value, addTo } = request.auth.apiKey;
    if (addTo === "header") headers[key] = value;
  }

  if (request.body.type === "json" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  } else if (request.body.type === "xml" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/xml";
  } else if (request.body.type === "text" && !headers["Content-Type"]) {
    headers["Content-Type"] = "text/plain";
  }

  return { ...headers, ...extraHeaders };
}

export function buildBody(request: ApiRequest): BodyInit | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  if (request.body.type === "none") return null;
  if (
    request.body.type === "json" ||
    request.body.type === "xml" ||
    request.body.type === "text"
  ) {
    return request.body.content || null;
  }
  if (request.body.type === "form") {
    const fd = new URLSearchParams();
    for (const item of request.body.formData) {
      if (item.enabled && item.key) fd.append(item.key, item.value);
    }
    return fd;
  }
  if (request.body.type === "formdata") {
    const fd = new FormData();
    for (const item of request.body.formData) {
      if (item.enabled && item.key) fd.append(item.key, item.value);
    }
    return fd;
  }
  return null;
}

export function buildBodyString(request: ApiRequest): string | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  if (request.body.type === "none") return null;
  if (
    request.body.type === "json" ||
    request.body.type === "xml" ||
    request.body.type === "text"
  ) {
    return request.body.content || null;
  }
  if (request.body.type === "form") {
    const fd = new URLSearchParams();
    for (const item of request.body.formData) {
      if (item.enabled && item.key) fd.append(item.key, item.value);
    }
    return fd.toString() || null;
  }
  return null;
}

export function resolveRequest(
  request: ApiRequest,
  variables: CollectionVariable[],
  envVars: CollectionVariable[] = []
): { url: string; method: string; headers: [string, string][]; body: string | null } {
  const resolve = (s: string) => resolveVariables(s, variables, envVars);

  let url = resolve(request.url);
  const resolvedParams = request.params.map((p) => ({
    ...p,
    key: resolve(p.key),
    value: resolve(p.value),
  }));

  if (request.auth.type === "api-key" && request.auth.apiKey?.addTo === "query") {
    resolvedParams.push({
      id: "auth-key",
      key: request.auth.apiKey.key,
      value: request.auth.apiKey.value,
      enabled: true,
    });
  }

  url = buildUrl(url, resolvedParams);

  const headersObj = buildHeaders({
    ...request,
    headers: request.headers.map((h) => ({
      ...h,
      key: resolve(h.key),
      value: resolve(h.value),
    })),
  });

  return {
    url,
    method: request.method,
    headers: Object.entries(headersObj) as [string, string][],
    body: buildBodyString(request),
  };
}

export async function executeRequest(
  request: ApiRequest,
  variables: CollectionVariable[],
  envVars: CollectionVariable[] = [],
  extraHeaders: Record<string, string> = {}
): Promise<ResponseData> {
  const resolve = (s: string) => resolveVariables(s, variables, envVars);

  let url = resolve(request.url);

  const resolvedParams = request.params.map((p) => ({
    ...p,
    key: resolve(p.key),
    value: resolve(p.value),
  }));

  if (request.auth.type === "api-key" && request.auth.apiKey?.addTo === "query") {
    resolvedParams.push({
      id: "auth-key",
      key: request.auth.apiKey.key,
      value: request.auth.apiKey.value,
      enabled: true,
    });
  }

  url = buildUrl(url, resolvedParams);

  const headers = buildHeaders(
    {
      ...request,
      headers: request.headers.map((h) => ({
        ...h,
        key: resolve(h.key),
        value: resolve(h.value),
      })),
    },
    extraHeaders
  );

  const body = buildBody(request);
  const start = Date.now();

  const response = await fetch(url, { method: request.method, headers, body });

  const time = Date.now() - start;
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  const contentType = response.headers.get("content-type") ?? "";
  const responseBody = await response.text();
  const size = new TextEncoder().encode(responseBody).length;

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: responseBody,
    size,
    time,
    contentType,
  };
}
