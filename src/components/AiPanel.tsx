"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, Settings, Sparkles, StopCircle, User, Wand2, X, Eye, FileCode2, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";
import {
  streamChat, buildRequestContext, buildResponseContext, extractCodeBlock,
  type AiMessage
} from "@/lib/ai-client";
import type { AiProvider } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Settings dialog ───────────────────────────────────────────────────────────

const PROVIDER_PRESETS: Record<AiProvider, { baseUrl: string; models: string[] }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-3-5-haiku-20241022"],
  },
  custom: {
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3", "mistral", "codestral", "qwen2.5"],
  },
};

function AiSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { aiSettings, setAiSettings } = useAppStore();
  const [local, setLocal] = useState({ ...aiSettings });

  useEffect(() => { if (open) setLocal({ ...aiSettings }); }, [open, aiSettings]);

  const handleProviderChange = (p: AiProvider) => {
    const preset = PROVIDER_PRESETS[p];
    setLocal((s) => ({
      ...s,
      provider: p,
      baseUrl: preset.baseUrl,
      model: preset.models[0],
    }));
  };

  const save = () => {
    setAiSettings(local);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" /> AI Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3">
            <Label className="w-20 text-xs shrink-0">Enable AI</Label>
            <button
              onClick={() => setLocal((s) => ({ ...s, enabled: !s.enabled }))}
              className={cn(
                "relative w-10 h-5 rounded-full transition-colors",
                local.enabled ? "bg-purple-500" : "bg-muted"
              )}
            >
              <span className={cn(
                "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                local.enabled && "translate-x-5"
              )} />
            </button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <Select value={local.provider} onValueChange={(v) => handleProviderChange(v as AiProvider)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai" className="text-xs">OpenAI</SelectItem>
                <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                <SelectItem value="custom" className="text-xs">Custom / Ollama / LM Studio</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Base URL</Label>
            <Input
              value={local.baseUrl}
              onChange={(e) => setLocal((s) => ({ ...s, baseUrl: e.target.value }))}
              className="h-8 text-xs font-mono"
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              value={local.apiKey}
              onChange={(e) => setLocal((s) => ({ ...s, apiKey: e.target.value }))}
              className="h-8 text-xs font-mono"
              placeholder="sk-..."
            />
            <p className="text-[10px] text-muted-foreground">Stored locally, never sent to our servers.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <div className="flex gap-2">
              <Select
                value={PROVIDER_PRESETS[local.provider].models.includes(local.model) ? local.model : ""}
                onValueChange={(v) => setLocal((s) => ({ ...s, model: v }))}
              >
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_PRESETS[local.provider].models.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={local.model}
                onChange={(e) => setLocal((s) => ({ ...s, model: e.target.value }))}
                className="h-8 text-xs font-mono w-40"
                placeholder="or type model name"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} className="bg-purple-600 hover:bg-purple-700">Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

function ChatMessage({ msg, onApply }: { msg: Message; onApply?: (type: "request" | "tests", code: string) => void }) {
  const requestJson = extractCodeBlock(msg.content, "json");
  const testCode = extractCodeBlock(msg.content, "javascript");

  // Render markdown-like content: code blocks highlighted
  const rendered = msg.content
    .replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code: string) =>
      `<pre class="bg-muted/60 border rounded p-2 text-[11px] font-mono mt-1 mb-1 overflow-x-auto whitespace-pre-wrap">${escHtml(code.trim())}</pre>`
    )
    .replace(/`([^`]+)`/g, '<code class="bg-muted/60 rounded px-1 text-[11px] font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");

  return (
    <div className={cn("flex gap-2 text-xs", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
        msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-purple-100 dark:bg-purple-950"
      )}>
        {msg.role === "user"
          ? <User className="h-3 w-3" />
          : <Bot className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />}
      </div>

      <div className={cn(
        "max-w-[85%] rounded-lg px-3 py-2",
        msg.role === "user"
          ? "bg-primary text-primary-foreground"
          : "bg-muted/60 border text-foreground"
      )}>
        {msg.streaming
          ? <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Thinking…</span>
          : <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: rendered }} />
        }

        {!msg.streaming && (requestJson || testCode) && (
          <div className="flex gap-1.5 mt-2 pt-2 border-t border-border/50">
            {requestJson && onApply && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 gap-1"
                onClick={() => onApply("request", requestJson)}
              >
                <Wand2 className="h-3 w-3" /> Apply Request
              </Button>
            )}
            {testCode && onApply && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 gap-1"
                onClick={() => onApply("tests", testCode)}
              >
                <FileCode2 className="h-3 w-3" /> Apply Tests
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Quick prompt chips ────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: "Write tests", prompt: "Write test scripts for the current request and its expected response.", icon: FileCode2 },
  { label: "Analyze response", prompt: "Analyze the last response: check for errors, performance issues, and suggest improvements.", icon: Eye },
  { label: "Generate from URL", prompt: "Generate a complete request from the current URL, including common headers and a sample body.", icon: Sparkles },
];

// ── Main AI Panel ─────────────────────────────────────────────────────────────

export function AiPanel() {
  const { aiSettings, requests, activeRequestId, response, updateRequest } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeRequest = requests.find((r) => r.id === activeRequestId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;
    setInput("");

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const placeholderMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages((m) => [...m, userMsg, placeholderMsg]);
    setStreaming(true);

    // Build context messages
    const contextParts: string[] = [];
    if (activeRequest) contextParts.push(buildRequestContext(activeRequest));
    if (response) contextParts.push(buildResponseContext(response));

    const historyMsgs: AiMessage[] = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const fullUserContent = contextParts.length
      ? `${contextParts.join("\n\n")}\n\n---\n${text}`
      : text;

    const apiMessages: AiMessage[] = [...historyMsgs, { role: "user", content: fullUserContent }];

    const abort = new AbortController();
    abortRef.current = abort;

    let fullContent = "";
    await streamChat(
      aiSettings,
      apiMessages,
      {
        onChunk: (delta) => {
          fullContent += delta;
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: fullContent, streaming: true }
                : msg
            )
          );
        },
        onDone: (full) => {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: full, streaming: false }
                : msg
            )
          );
          setStreaming(false);
        },
        onError: (err) => {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: `❌ ${err}`, streaming: false }
                : msg
            )
          );
          setStreaming(false);
        },
      },
      abort.signal,
    );
  }, [streaming, messages, activeRequest, response, aiSettings]);

  const handleApply = useCallback((type: "request" | "tests", code: string) => {
    if (!activeRequest) return;

    if (type === "tests") {
      updateRequest(activeRequest.id, { tests: code });
      return;
    }

    if (type === "request") {
      try {
        const parsed = JSON.parse(code) as {
          method?: string; url?: string;
          headers?: { key: string; value: string }[];
          body?: { type: string; content: string };
          auth?: Record<string, unknown>;
        };
        const updates: Record<string, unknown> = {};
        if (parsed.method) updates.method = parsed.method;
        if (parsed.url) updates.url = parsed.url;
        if (parsed.headers) {
          updates.headers = parsed.headers.map((h) => ({
            id: crypto.randomUUID(), key: h.key, value: h.value, enabled: true,
          }));
        }
        if (parsed.body) updates.body = { ...parsed.body, formData: [] };
        if (parsed.auth) updates.auth = parsed.auth;
        updateRequest(activeRequest.id, updates as Parameters<typeof updateRequest>[1]);
      } catch { /* ignore parse errors */ }
    }
  }, [activeRequest, updateRequest]);

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const clear = () => setMessages([]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
          AI Assistant
        </span>
        {!aiSettings.enabled && (
          <span className="text-[10px] text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded">
            Not configured
          </span>
        )}
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={clear} title="Clear chat">
            <X className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setSettingsOpen(true)} title="AI Settings">
          <Settings className="h-3 w-3" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-6 space-y-3">
              <div className="flex justify-center">
                <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-950 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium">AI API Assistant</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Ask me to generate requests, write tests, or analyze responses.
                </p>
              </div>
              {/* Quick prompts */}
              <div className="flex flex-col gap-1.5 text-left">
                {QUICK_PROMPTS.map(({ label, prompt, icon: Icon }) => (
                  <button
                    key={label}
                    onClick={() => sendMessage(prompt)}
                    disabled={!aiSettings.enabled}
                    className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg border hover:bg-accent transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessage key={msg.id} msg={msg} onApply={handleApply} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t p-3 space-y-2">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder={aiSettings.enabled ? "Ask anything about this request… (Enter to send)" : "Configure AI settings first"}
            className="min-h-[60px] max-h-32 text-xs resize-none pr-10"
            disabled={!aiSettings.enabled || streaming}
          />
          <div className="absolute bottom-2 right-2">
            {streaming ? (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={stop} title="Stop">
                <StopCircle className="h-4 w-4 text-destructive" />
              </Button>
            ) : (
              <Button
                size="icon" variant="ghost" className="h-6 w-6"
                onClick={() => sendMessage(input)}
                disabled={!aiSettings.enabled || !input.trim()}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Shift+Enter for newline · Context: {activeRequest ? activeRequest.name : "no request selected"}
        </p>
      </div>

      <AiSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
