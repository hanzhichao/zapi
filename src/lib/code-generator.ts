import type { ApiRequest, CollectionVariable } from "./types";
import { buildUrl, buildHeaders, buildBodyString } from "./http-client";
import { resolveVariables } from "./store";

export type CodeLang = "curl" | "fetch" | "axios" | "python" | "go" | "php" | "ruby" | "java";

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
}

function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export function generateCode(
  request: ApiRequest,
  lang: CodeLang,
  colVars: CollectionVariable[] = [],
  envVars: CollectionVariable[] = [],
): string {
  const resolve = (s: string) => resolveVariables(s, colVars, envVars);

  const url = buildUrl(resolve(request.url), request.params.map((p) => ({ ...p, key: resolve(p.key), value: resolve(p.value) })));
  const headers = buildHeaders({ ...request, headers: request.headers.map((h) => ({ ...h, key: resolve(h.key), value: resolve(h.value) })) });
  const body = buildBodyString(request);

  const method = (request.protocol === "graphql" ? "POST" : request.protocol === "soap" ? "POST" : request.method).toUpperCase();

  switch (lang) {
    case "curl": return genCurl(url, method, headers, body);
    case "fetch": return genFetch(url, method, headers, body);
    case "axios": return genAxios(url, method, headers, body);
    case "python": return genPython(url, method, headers, body);
    case "go": return genGo(url, method, headers, body);
    case "php": return genPhp(url, method, headers, body);
    case "ruby": return genRuby(url, method, headers, body);
    case "java": return genJava(url, method, headers, body);
    default: return "";
  }
}

function genCurl(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const lines: string[] = [`curl -X ${method} '${escapeShell(url)}'`];
  for (const [k, v] of Object.entries(headers)) {
    lines.push(`  -H '${escapeShell(k)}: ${escapeShell(v)}'`);
  }
  if (body) lines.push(`  -d '${escapeShell(body)}'`);
  return lines.join(" \\\n");
}

function genFetch(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const hLines = Object.entries(headers).map(([k, v]) => `    "${escape(k)}": "${escape(v)}"`).join(",\n");
  return `const response = await fetch("${escape(url)}", {
  method: "${method}",
  headers: {
${hLines}
  },${body ? `\n  body: \`${body.replace(/`/g, "\\`")}\`,` : ""}
});

const data = await response.json();
console.log(data);`;
}

function genAxios(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const hLines = Object.entries(headers).map(([k, v]) => `    "${escape(k)}": "${escape(v)}"`).join(",\n");
  const meth = method.toLowerCase();
  return `import axios from "axios";

const response = await axios.${meth}("${escape(url)}", ${body ? `${body},` : "null,"} {
  headers: {
${hLines}
  },
});

console.log(response.data);`;
}

function genPython(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const hLines = Object.entries(headers).map(([k, v]) => `    "${escape(k)}": "${escape(v)}"`).join(",\n");
  const isJson = headers["Content-Type"]?.includes("json");
  return `import requests

url = "${escape(url)}"
headers = {
${hLines}
}${body ? `\n${isJson ? `payload = ${body}` : `data = """${body}"""`}` : ""}

response = requests.${method.toLowerCase()}(url, headers=headers${body ? (isJson ? ", json=payload" : ", data=data") : ""})
print(response.json())`;
}

function genGo(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const hLines = Object.entries(headers).map(([k, v]) => `\treq.Header.Set("${escape(k)}", "${escape(v)}")`).join("\n");
  return `package main

import (
\t"fmt"
\t"io"
\t"net/http"${body ? '\n\t"strings"' : ""}
)

func main() {
\tclient := &http.Client{}
\t${body ? `bodyStr := \`${body.replace(/`/g, "` + \"`\" + `")}\`\n\treq, _ := http.NewRequest("${method}", "${escape(url)}", strings.NewReader(bodyStr))` : `req, _ := http.NewRequest("${method}", "${escape(url)}", nil)`}
${hLines}

\tresp, _ := client.Do(req)
\tdefer resp.Body.Close()
\tbody, _ := io.ReadAll(resp.Body)
\tfmt.Println(string(body))
}`;
}

function genPhp(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const hLines = Object.entries(headers).map(([k, v]) => `    "${escape(k)}: ${escape(v)}",`).join("\n");
  return `<?php
$curl = curl_init();

curl_setopt_array($curl, [
  CURLOPT_URL => "${escape(url)}",
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST => "${method}",
  CURLOPT_HTTPHEADER => [
${hLines}
  ],${body ? `\n  CURLOPT_POSTFIELDS => '${body.replace(/'/g, "\\'")}',` : ""}
]);

$response = curl_exec($curl);
curl_close($curl);

echo $response;`;
}

function genRuby(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const hLines = Object.entries(headers).map(([k, v]) => `  "${escape(k)}" => "${escape(v)}"`).join(",\n");
  return `require "net/http"
require "uri"
require "json"

uri = URI.parse("${escape(url)}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = uri.scheme == "https"

request = Net::HTTP::${method[0] + method.slice(1).toLowerCase()}.new(uri.request_uri)
${hLines ? `request.initialize_http_header({\n${hLines}\n})` : ""}
${body ? `request.body = '${body.replace(/'/g, "\\'")}'` : ""}

response = http.request(request)
puts response.body`;
}

function genJava(url: string, method: string, headers: Record<string, string>, body: string | null): string {
  const hLines = Object.entries(headers).map(([k, v]) => `                .header("${escape(k)}", "${escape(v)}")`).join("\n");
  return `import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URI;

HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("${escape(url)}"))
                .method("${method}", ${body ? `HttpRequest.BodyPublishers.ofString("${escape(body)}")` : "HttpRequest.BodyPublishers.noBody()"})
${hLines}
                .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`;
}
