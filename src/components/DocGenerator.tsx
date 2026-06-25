"use client";

import { useState } from "react";
import { BookOpen, Copy, Check, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppStore } from "@/lib/store";
import type { ApiRequest, Collection } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Markdown generator ────────────────────────────────────────────────────────

function requestToMarkdown(req: ApiRequest): string {
  const proto = req.protocol ?? "http";
  const badge = proto === "websocket" ? "WS" : proto === "graphql" ? "GQL" : proto === "grpc" ? "gRPC" : proto === "soap" ? "SOAP" : req.method;
  const lines: string[] = [];

  lines.push(`### ${badge} ${req.name}`);
  if (req.description) lines.push(`\n> ${req.description.replace(/\n/g, "\n> ")}`);
  lines.push("");

  lines.push(`\`\`\`\n${req.method} ${req.url}\n\`\`\``);

  const enabledParams = req.params.filter((p) => p.enabled && p.key);
  if (enabledParams.length) {
    lines.push("\n**Query Parameters**\n");
    lines.push("| Parameter | Value | Description |");
    lines.push("|-----------|-------|-------------|");
    for (const p of enabledParams) {
      lines.push(`| \`${p.key}\` | \`${p.value}\` | ${p.description ?? ""} |`);
    }
  }

  const enabledHeaders = req.headers.filter((h) => h.enabled && h.key);
  if (enabledHeaders.length) {
    lines.push("\n**Headers**\n");
    lines.push("| Header | Value |");
    lines.push("|--------|-------|");
    for (const h of enabledHeaders) {
      lines.push(`| \`${h.key}\` | \`${h.value}\` |`);
    }
  }

  if (req.auth?.type !== "none") {
    lines.push(`\n**Auth**: \`${req.auth.type}\``);
    if (req.auth.type === "bearer") lines.push(" — Bearer token");
    if (req.auth.type === "basic") lines.push(` — Basic: ${req.auth.basic?.username ?? ""}`);
    if (req.auth.type === "oauth2") lines.push(` — OAuth2 ${req.auth.oauth2?.grantType ?? ""}`);
  }

  if (req.body?.type !== "none" && req.body?.content?.trim()) {
    const lang = req.body.type === "json" ? "json" : req.body.type === "xml" ? "xml" : "text";
    lines.push(`\n**Request Body** (${req.body.type})\n`);
    lines.push(`\`\`\`${lang}\n${req.body.content}\n\`\`\``);
  }

  if (req.requestSchema) {
    lines.push("\n**Request Schema**\n");
    lines.push(`\`\`\`json\n${req.requestSchema}\n\`\`\``);
  }
  if (req.responseSchema) {
    lines.push("\n**Response Schema**\n");
    lines.push(`\`\`\`json\n${req.responseSchema}\n\`\`\``);
  }

  return lines.join("\n");
}

function collectionToMarkdown(col: Collection, requests: ApiRequest[]): string {
  const colReqs = requests.filter((r) => r.collectionId === col.id).sort((a, b) => a.seq - b.seq);
  const lines: string[] = [];

  lines.push(`# ${col.name}`);
  if (col.description) lines.push(`\n${col.description}`);
  lines.push("");

  if (col.variables.length) {
    lines.push("## Variables\n");
    lines.push("| Variable | Default Value |");
    lines.push("|----------|---------------|");
    for (const v of col.variables.filter((v) => v.enabled)) {
      lines.push(`| \`{{${v.name}}}\` | \`${v.value}\` |`);
    }
    lines.push("");
  }

  lines.push(`## Endpoints (${colReqs.length})\n`);
  for (const req of colReqs) {
    lines.push(requestToMarkdown(req));
    lines.push("");
  }

  return lines.join("\n");
}

// ── HTML generator ────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function methodBadgeColor(method: string): string {
  const colors: Record<string, string> = {
    GET: "#10b981", POST: "#3b82f6", PUT: "#f59e0b", PATCH: "#8b5cf6",
    DELETE: "#ef4444", HEAD: "#6b7280", OPTIONS: "#6b7280",
    WS: "#22c55e", GQL: "#ec4899", gRPC: "#a855f7", SOAP: "#f97316",
  };
  return colors[method] ?? "#6b7280";
}

function collectionToHtml(col: Collection, requests: ApiRequest[]): string {
  const colReqs = requests.filter((r) => r.collectionId === col.id).sort((a, b) => a.seq - b.seq);

  const endpointCards = colReqs.map((req) => {
    const proto = req.protocol ?? "http";
    const badge = proto === "websocket" ? "WS" : proto === "graphql" ? "GQL" : proto === "grpc" ? "gRPC" : proto === "soap" ? "SOAP" : req.method;
    const color = methodBadgeColor(badge);
    const enabledParams = req.params.filter((p) => p.enabled && p.key);
    const enabledHeaders = req.headers.filter((h) => h.enabled && h.key);

    return `
<div class="endpoint">
  <div class="endpoint-header">
    <span class="method-badge" style="background:${color}">${escHtml(badge)}</span>
    <span class="endpoint-name">${escHtml(req.name)}</span>
    <code class="endpoint-url">${escHtml(req.url)}</code>
  </div>
  ${req.description ? `<p class="description">${escHtml(req.description)}</p>` : ""}
  ${enabledParams.length ? `
  <details>
    <summary>Query Parameters (${enabledParams.length})</summary>
    <table><thead><tr><th>Parameter</th><th>Value</th><th>Description</th></tr></thead><tbody>
      ${enabledParams.map((p) => `<tr><td><code>${escHtml(p.key)}</code></td><td><code>${escHtml(p.value)}</code></td><td>${escHtml(p.description ?? "")}</td></tr>`).join("")}
    </tbody></table>
  </details>` : ""}
  ${enabledHeaders.length ? `
  <details>
    <summary>Headers (${enabledHeaders.length})</summary>
    <table><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>
      ${enabledHeaders.map((h) => `<tr><td><code>${escHtml(h.key)}</code></td><td><code>${escHtml(h.value)}</code></td></tr>`).join("")}
    </tbody></table>
  </details>` : ""}
  ${req.body?.type !== "none" && req.body?.content ? `
  <details>
    <summary>Request Body (${escHtml(req.body.type)})</summary>
    <pre><code>${escHtml(req.body.content)}</code></pre>
  </details>` : ""}
  ${req.responseSchema ? `
  <details>
    <summary>Response Schema</summary>
    <pre><code>${escHtml(req.responseSchema)}</code></pre>
  </details>` : ""}
</div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(col.name)} — API Documentation</title>
<style>
  :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --accent: #3b82f6; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 2rem; font-size: 14px; line-height: 1.6; }
  h1 { font-size: 2rem; font-weight: 700; margin-bottom: .5rem; }
  h2 { font-size: 1.25rem; font-weight: 600; color: var(--muted); margin: 2rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: .5rem; }
  .subtitle { color: var(--muted); margin-bottom: 2rem; }
  .vars table, .endpoint table { width: 100%; border-collapse: collapse; margin: .75rem 0; font-size: 13px; }
  th { text-align: left; padding: .5rem .75rem; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 500; }
  td { padding: .5rem .75rem; border-bottom: 1px solid var(--border)/50; vertical-align: top; }
  code { background: rgba(255,255,255,.07); border-radius: 4px; padding: 1px 5px; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
  pre { background: rgba(0,0,0,.3); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; overflow-x: auto; margin: .5rem 0; }
  pre code { background: none; padding: 0; }
  .endpoint { background: var(--card); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
  .endpoint-header { display: flex; align-items: center; gap: .75rem; padding: 1rem 1.25rem; flex-wrap: wrap; }
  .method-badge { color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-family: monospace; }
  .endpoint-name { font-weight: 600; }
  .endpoint-url { color: var(--muted); font-size: 12px; }
  .description { padding: 0 1.25rem .75rem; color: var(--muted); font-size: 13px; }
  details { border-top: 1px solid var(--border); }
  summary { padding: .75rem 1.25rem; cursor: pointer; font-size: 13px; color: var(--muted); user-select: none; }
  summary:hover { background: rgba(255,255,255,.03); }
  details[open] pre, details[open] table { margin: 0 1.25rem 1rem; }
  .generated { margin-top: 3rem; color: var(--muted); font-size: 12px; text-align: center; }
</style>
</head>
<body>
<h1>${escHtml(col.name)}</h1>
${col.description ? `<p class="subtitle">${escHtml(col.description)}</p>` : ""}
${col.variables.filter((v) => v.enabled).length ? `
<section class="vars">
  <h2>Variables</h2>
  <table><thead><tr><th>Variable</th><th>Default</th></tr></thead><tbody>
    ${col.variables.filter((v) => v.enabled).map((v) => `<tr><td><code>{{${escHtml(v.name)}}}</code></td><td><code>${escHtml(v.value)}</code></td></tr>`).join("")}
  </tbody></table>
</section>` : ""}
<h2>Endpoints (${colReqs.length})</h2>
${endpointCards}
<p class="generated">Generated by zapi · ${new Date().toLocaleDateString()}</p>
</body>
</html>`;
}

// ── Main dialog ───────────────────────────────────────────────────────────────

type DocFormat = "markdown" | "html";

interface Props {
  open: boolean;
  onClose: () => void;
  collectionId?: string;
}

export function DocGeneratorDialog({ open, onClose, collectionId }: Props) {
  const { collections, requests } = useAppStore();
  const [selectedColId, setSelectedColId] = useState(collectionId ?? collections[0]?.id ?? "");
  const [format, setFormat] = useState<DocFormat>("markdown");
  const [copied, setCopied] = useState(false);

  const col = collections.find((c) => c.id === selectedColId);
  const content = col
    ? format === "markdown"
      ? collectionToMarkdown(col, requests)
      : collectionToHtml(col, requests)
    : "";

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const ext = format === "markdown" ? "md" : "html";
    const mime = format === "markdown" ? "text/markdown" : "text/html";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${col?.name ?? "api-docs"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Generate API Documentation
          </DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="flex items-center gap-3 pb-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Collection:</span>
            <Select value={selectedColId} onValueChange={setSelectedColId}>
              <SelectTrigger className="h-8 text-xs w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {(["markdown", "html"] as DocFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={cn(
                  "px-3 py-1 text-xs rounded font-medium transition-colors",
                  format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "markdown" ? <><FileText className="h-3 w-3 inline mr-1" />Markdown</> : <><BookOpen className="h-3 w-3 inline mr-1" />HTML</>}
              </button>
            ))}
          </div>

          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              Copy
            </Button>
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={download}>
              <Download className="h-3.5 w-3.5" /> Download .{format === "markdown" ? "md" : "html"}
            </Button>
          </div>
        </div>

        {/* Preview */}
        <ScrollArea className="flex-1 rounded border bg-muted/20">
          <pre className="p-4 text-[11px] font-mono whitespace-pre-wrap break-words text-foreground leading-relaxed">
            {content}
          </pre>
        </ScrollArea>

        <p className="text-[10px] text-muted-foreground text-right shrink-0">
          {requests.filter((r) => r.collectionId === selectedColId).length} endpoints · {content.length.toLocaleString()} chars
        </p>
      </DialogContent>
    </Dialog>
  );
}
