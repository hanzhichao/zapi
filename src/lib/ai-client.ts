/**
 * OpenAI-compatible streaming chat client.
 * Works with OpenAI, Anthropic (via proxy), or local models (Ollama, LM Studio).
 */
import type { AiSettings } from "./types";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onDone: (full: string) => void;
  onError: (err: string) => void;
}

const CB = "```";

const SYSTEM_PROMPT = [
  "You are an expert API testing assistant embedded in zapi, a desktop API client.",
  "You help users:",
  "1. Generate HTTP requests from natural language descriptions",
  "2. Analyze API responses and suggest improvements or fixes",
  "3. Write JavaScript test scripts (using zapi.test(), zapi.expect(), zapi.variables.set())",
  "4. Explain HTTP errors and suggest solutions",
  "5. Design API workflows and request chains",
  "",
  "When generating requests, respond with a JSON block like:",
  CB + "json",
  '{"method":"POST","url":"https://api.example.com/users","headers":[{"key":"Content-Type","value":"application/json"}],"body":{"type":"json","content":"{\\"name\\":\\"John\\"}"},"auth":{"type":"bearer","bearer":{"token":"{{token}}"}}}',
  CB,
  "",
  "When writing test scripts, use this format:",
  CB + "javascript",
  'zapi.test("Status is 200", () => { zapi.expect(zapi.response.status).toBe(200); });',
  'zapi.test("Has id", () => { const d = JSON.parse(zapi.response.body); zapi.expect(d.id).toBeTruthy(); });',
  CB,
  "",
  "Be concise and practical. Focus on actionable suggestions.",
].join("\n");

export async function streamChat(
  settings: AiSettings,
  messages: AiMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  if (!settings.enabled || !settings.apiKey || !settings.baseUrl) {
    callbacks.onError("AI is not configured. Please set your API key in AI Settings.");
    return;
  }

  const url = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body = JSON.stringify({
    model: settings.model || "gpt-4o",
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    stream: true,
    temperature: 0.3,
    max_tokens: 2048,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`,
        ...(settings.provider === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
      },
      body,
      signal,
    });
  } catch (e) {
    callbacks.onError(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    callbacks.onError(`API error ${response.status}: ${errText.slice(0, 200)}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { callbacks.onError("No response stream"); return; }

  const decoder = new TextDecoder();
  let full = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            callbacks.onChunk(delta);
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }
    callbacks.onDone(full);
  } catch (e) {
    if (signal?.aborted) {
      callbacks.onDone(full);
    } else {
      callbacks.onError(e instanceof Error ? e.message : String(e));
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Context builders ──────────────────────────────────────────────────────────

export function buildRequestContext(request: {
  method: string; url: string;
  headers?: { key: string; value: string; enabled: boolean }[];
  body?: { type: string; content: string };
}): string {
  const parts = [`Current request: ${request.method} ${request.url}`];
  const enabledHeaders = request.headers?.filter((h) => h.enabled && h.key) ?? [];
  if (enabledHeaders.length) {
    parts.push("Headers: " + enabledHeaders.map((h) => `${h.key}: ${h.value}`).join(", "));
  }
  if (request.body?.type !== "none" && request.body?.content) {
    parts.push(`Body (${request.body.type}): ${request.body.content.slice(0, 300)}`);
  }
  return parts.join("\n");
}

export function buildResponseContext(response: {
  status: number; statusText: string; time: number; body: string; contentType: string;
}): string {
  const parts = [
    `Response: ${response.status} ${response.statusText} (${response.time}ms)`,
    `Content-Type: ${response.contentType}`,
  ];
  const preview = response.body.slice(0, 500);
  if (preview) parts.push(`Body preview:\n${preview}`);
  return parts.join("\n");
}

/** Extract the first ```json ... ``` or ```javascript ... ``` code block */
export function extractCodeBlock(text: string, lang: "json" | "javascript"): string | null {
  const regex = new RegExp("```" + lang + "\\s*([\\s\\S]*?)```", "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}
