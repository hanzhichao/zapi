/**
 * Response Variable Extractor
 * Evaluates ExtractorRule[] against a ResponseData and returns
 * { varName, value } pairs to be stored into collection / env variables.
 */
import type { ExtractorRule, ResponseData } from "./types";
import { jsonpathGet } from "./jsonpath";

export interface ExtractedVar {
  varName: string;
  value: string;
  scope: "collection" | "environment";
  error?: string;
}

export function runExtractors(
  extractors: ExtractorRule[],
  response: ResponseData,
): ExtractedVar[] {
  const results: ExtractedVar[] = [];

  for (const rule of extractors) {
    if (!rule.enabled || !rule.varName) continue;

    try {
      const value = extractOne(rule, response);
      results.push({ varName: rule.varName, value: value ?? "", scope: rule.scope });
    } catch (e) {
      results.push({
        varName: rule.varName,
        value: "",
        scope: rule.scope,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}

function extractOne(rule: ExtractorRule, response: ResponseData): string | null {
  // Status source
  if (rule.source === "status") {
    return String(response.status);
  }

  // Response time source
  if (rule.source === "responseTime") {
    return String(response.time);
  }

  // Header source
  if (rule.source === "header") {
    const headerName = rule.expression.toLowerCase();
    const found = Object.entries(response.headers).find(
      ([k]) => k.toLowerCase() === headerName,
    );
    return found ? found[1] : null;
  }

  // Body source
  if (rule.source === "body") {
    if (rule.type === "full") {
      return response.body;
    }

    if (rule.type === "jsonpath") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body);
      } catch {
        throw new Error("Response body is not valid JSON");
      }
      return jsonpathGet(parsed, rule.expression);
    }

    if (rule.type === "regex") {
      const match = new RegExp(rule.expression).exec(response.body);
      // Return capture group 1 if present, else full match
      return match ? (match[1] ?? match[0] ?? null) : null;
    }
  }

  return null;
}
