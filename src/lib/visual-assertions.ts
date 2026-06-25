/**
 * Visual Test Builder — evaluate VisualAssertion[] against a ResponseData.
 * Returns TestResult[] compatible with the existing test framework.
 */
import type { VisualAssertion, ResponseData, TestResult } from "./types";
import { jsonpathGet } from "./jsonpath";

export function runVisualAssertions(
  assertions: VisualAssertion[],
  response: ResponseData,
): TestResult[] {
  return assertions
    .filter((a) => a.enabled)
    .map((a) => {
      const name = a.name || buildDefaultName(a);
      try {
        const actual = getActualValue(a, response);
        const passed = evaluate(actual, a.operator, a.value);
        return {
          name,
          passed,
          error: passed
            ? undefined
            : `Expected ${a.source}${a.field ? `.${a.field}` : ""} to ${a.operator} ${JSON.stringify(a.value)}, got ${JSON.stringify(actual)}`,
        };
      } catch (e) {
        return { name, passed: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
}

function getActualValue(a: VisualAssertion, res: ResponseData): unknown {
  switch (a.source) {
    case "status":
      return res.status;

    case "responseTime":
      return res.time;

    case "bodySize":
      return res.size;

    case "header": {
      const key = (a.field ?? "").toLowerCase();
      const found = Object.entries(res.headers).find(([k]) => k.toLowerCase() === key);
      return found ? found[1] : undefined;
    }

    case "body": {
      if (!a.field) return res.body;
      // Try JSON path
      try {
        const parsed = JSON.parse(res.body) as unknown;
        return jsonpathGet(parsed, a.field);
      } catch {
        return res.body;
      }
    }
  }
}

function evaluate(actual: unknown, operator: VisualAssertion["operator"], expected: string): boolean {
  const act = actual === undefined || actual === null ? "" : actual;

  switch (operator) {
    case "eq":
      // numeric-aware comparison
      if (typeof act === "number") return act === Number(expected);
      return String(act) === expected;

    case "ne":
      if (typeof act === "number") return act !== Number(expected);
      return String(act) !== expected;

    case "gt":
      return Number(act) > Number(expected);

    case "lt":
      return Number(act) < Number(expected);

    case "gte":
      return Number(act) >= Number(expected);

    case "lte":
      return Number(act) <= Number(expected);

    case "contains":
      return String(act).includes(expected);

    case "not_contains":
      return !String(act).includes(expected);

    case "starts_with":
      return String(act).startsWith(expected);

    case "ends_with":
      return String(act).endsWith(expected);

    case "exists":
      return actual !== undefined && actual !== null && actual !== "";

    case "not_exists":
      return actual === undefined || actual === null || actual === "";

    case "matches":
      return new RegExp(expected).test(String(act));
  }
}

function buildDefaultName(a: VisualAssertion): string {
  const src = a.field ? `${a.source}.${a.field}` : a.source;
  const ops: Record<string, string> = {
    eq: "=", ne: "≠", gt: ">", lt: "<", gte: "≥", lte: "≤",
    contains: "contains", not_contains: "not contains",
    starts_with: "starts with", ends_with: "ends with",
    exists: "exists", not_exists: "not exists", matches: "matches",
  };
  const op = ops[a.operator] ?? a.operator;
  return a.operator === "exists" || a.operator === "not_exists"
    ? `${src} ${op}`
    : `${src} ${op} ${a.value}`;
}
