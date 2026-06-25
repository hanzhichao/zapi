"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { generateCode, type CodeLang } from "@/lib/code-generator";
import { useAppStore } from "@/lib/store";
import type { ApiRequest } from "@/lib/types";

const LANGS: { value: CodeLang; label: string }[] = [
  { value: "curl",   label: "cURL" },
  { value: "fetch",  label: "JavaScript (fetch)" },
  { value: "axios",  label: "JavaScript (axios)" },
  { value: "python", label: "Python (requests)" },
  { value: "go",     label: "Go" },
  { value: "php",    label: "PHP (curl)" },
  { value: "ruby",   label: "Ruby (Net::HTTP)" },
  { value: "java",   label: "Java (HttpClient)" },
];

interface Props {
  request: ApiRequest;
}

export function CodeSnippetPanel({ request }: Props) {
  const { collections, activeEnvironmentId, environments } = useAppStore();
  const [lang, setLang] = useState<CodeLang>("curl");
  const [copied, setCopied] = useState(false);

  const collection = collections.find((c) => c.id === request.collectionId);
  const colVars = collection?.variables ?? [];
  const envVars = environments.find((e) => e.id === activeEnvironmentId)?.variables ?? [];

  const code = generateCode(request, lang, colVars, envVars);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-xs font-semibold text-muted-foreground shrink-0">Code Snippet</span>
        <Select value={lang} onValueChange={(v) => setLang(v as CodeLang)}>
          <SelectTrigger className="h-7 text-xs w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGS.map((l) => (
              <SelectItem key={l.value} value={l.value} className="text-xs">
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="h-7 w-7 ml-auto" onClick={handleCopy} title="Copy code">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Code */}
      <ScrollArea className="flex-1">
        <pre className="p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-all leading-5">
          {code}
        </pre>
      </ScrollArea>
    </div>
  );
}
