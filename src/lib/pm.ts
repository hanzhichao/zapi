import type { ConsoleLog, ResponseData, TestResult } from "./types";

// ── Chainable assertion (minimal chai-style) ─────────────────────────────────

function makeAssertion(value: unknown, negate = false): ChainAssertion {
  const check = (pass: boolean, msg: string) => {
    if (negate ? pass : !pass) throw new Error(msg);
  };

  const chain: ChainAssertion = {
    to: null as unknown as AssertChain,
    not: null as unknown as ChainAssertion,
  };

  const assertChain: AssertChain = {
    equal: (expected: unknown) => {
      check(value === expected, `Expected ${JSON.stringify(value)} to${negate ? " not" : ""} equal ${JSON.stringify(expected)}`);
    },
    eql: (expected: unknown) => {
      check(JSON.stringify(value) === JSON.stringify(expected), `Deep equality check failed`);
    },
    be: Object.assign(
      (expected: unknown) => {
        check(value === expected, `Expected ${value} to${negate ? " not" : ""} be ${expected}`);
      },
      {
        true: () => check(value === true, `Expected true`),
        false: () => check(value === false, `Expected false`),
        null: () => check(value === null, `Expected null`),
        undefined: () => check(value === undefined, `Expected undefined`),
        ok: () => check(Boolean(value), `Expected truthy`),
        a: (type: string) => check(typeof value === type, `Expected type "${type}" but got "${typeof value}"`),
        an: (type: string) => check(typeof value === type, `Expected type "${type}" but got "${typeof value}"`),
        above: (n: number) => check((value as number) > n, `Expected ${value} > ${n}`),
        below: (n: number) => check((value as number) < n, `Expected ${value} < ${n}`),
        least: (n: number) => check((value as number) >= n, `Expected ${value} >= ${n}`),
        most: (n: number) => check((value as number) <= n, `Expected ${value} <= ${n}`),
      }
    ),
    have: {
      property: (key: string, val?: unknown) => {
        const obj = value as Record<string, unknown>;
        check(typeof obj === "object" && obj !== null && key in obj, `Expected property "${key}"`);
        if (val !== undefined) check(obj[key] === val, `Expected property "${key}" to be ${val}`);
      },
      status: (n: number) => {
        const resp = value as ResponseData | null;
        check(resp?.status === n, `Expected status ${n} but got ${resp?.status}`);
      },
      lengthOf: (n: number) => {
        const arr = value as unknown[];
        check(Array.isArray(arr) && arr.length === n, `Expected length ${n} but got ${Array.isArray(arr) ? arr.length : "not array"}`);
      },
      header: (name: string) => {
        const resp = value as ResponseData | null;
        check(resp?.headers !== undefined && name.toLowerCase() in Object.fromEntries(Object.entries(resp.headers).map(([k, v]) => [k.toLowerCase(), v])), `Expected header "${name}"`);
      },
    },
    include: (substr: string) => {
      if (typeof value === "string") {
        check(value.includes(substr), `Expected "${value}" to include "${substr}"`);
      } else if (Array.isArray(value)) {
        check(value.includes(substr), `Expected array to include ${JSON.stringify(substr)}`);
      }
    },
    exist: () => check(value !== null && value !== undefined, `Expected value to exist`),
  };

  chain.to = assertChain;
  chain.not = makeAssertion(value, !negate);

  return chain;
}

interface AssertChain {
  equal: (expected: unknown) => void;
  eql: (expected: unknown) => void;
  be: ((expected: unknown) => void) & {
    true: () => void;
    false: () => void;
    null: () => void;
    undefined: () => void;
    ok: () => void;
    a: (type: string) => void;
    an: (type: string) => void;
    above: (n: number) => void;
    below: (n: number) => void;
    least: (n: number) => void;
    most: (n: number) => void;
  };
  have: {
    property: (key: string, val?: unknown) => void;
    status: (n: number) => void;
    lengthOf: (n: number) => void;
    header: (name: string) => void;
  };
  include: (substr: string) => void;
  exist: () => void;
}

interface ChainAssertion {
  to: AssertChain;
  not: ChainAssertion;
}

// ── pm context builder ────────────────────────────────────────────────────────

export interface PmEnvStore {
  getVar: (key: string) => string | undefined;
  setVar: (key: string, value: string) => void;
}

export interface PmContext {
  testResults: TestResult[];
  headerOverrides: Record<string, string>;
  variableOverrides: Record<string, string>;
}

export function buildPm(
  ctx: PmContext,
  envStore: PmEnvStore,
  collectionVars: Record<string, string>,
  response?: ResponseData
) {
  const respProxy = response
    ? {
        code: response.status,
        status: response.statusText,
        headers: response.headers,
        responseTime: response.time,
        json: () => {
          try {
            return JSON.parse(response.body);
          } catch {
            throw new Error("Response is not valid JSON");
          }
        },
        text: () => response.body,
        to: {
          have: {
            status: (n: number) => {
              if (response.status !== n)
                throw new Error(`Expected status ${n} but got ${response.status}`);
            },
            header: (name: string) => {
              const lower = name.toLowerCase();
              const has = Object.keys(response.headers).some((k) => k.toLowerCase() === lower);
              if (!has) throw new Error(`Expected header "${name}"`);
            },
          },
        },
      }
    : null;

  return {
    test: (name: string, fn: () => void) => {
      try {
        fn();
        ctx.testResults.push({ name, passed: true });
      } catch (e) {
        ctx.testResults.push({ name, passed: false, error: String(e) });
      }
    },

    expect: (value: unknown) => makeAssertion(value),

    environment: {
      get: (key: string) => envStore.getVar(key),
      set: (key: string, value: string) => {
        envStore.setVar(key, value);
        ctx.variableOverrides[key] = value;
      },
      unset: (key: string) => envStore.setVar(key, ""),
      has: (key: string) => envStore.getVar(key) !== undefined,
    },

    variables: {
      get: (key: string) => collectionVars[key] ?? envStore.getVar(key),
      set: (key: string, value: string) => {
        ctx.variableOverrides[key] = value;
      },
    },

    request: {
      headers: {
        upsert: (h: { key: string; value: string }) => {
          ctx.headerOverrides[h.key] = h.value;
        },
        add: (h: { key: string; value: string }) => {
          ctx.headerOverrides[h.key] = h.value;
        },
      },
    },

    response: respProxy,

    // Convenience alias used heavily in postman scripts
    sendRequest: async () => {
      throw new Error("pm.sendRequest is not supported");
    },
  };
}

// ── Script executor ──────────────────────────────────────────────────────────

export function runScript(
  code: string,
  zapiObj: ReturnType<typeof buildPm>,
  logCapture?: ConsoleLog[]
): string | null {
  if (!code.trim()) return null;

  const captureConsole = {
    log: (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      if (logCapture) logCapture.push({ id: crypto.randomUUID(), level: "log", message: msg, timestamp: Date.now() });
      console.log(...args);
    },
    info: (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      if (logCapture) logCapture.push({ id: crypto.randomUUID(), level: "info", message: msg, timestamp: Date.now() });
      console.info(...args);
    },
    warn: (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      if (logCapture) logCapture.push({ id: crypto.randomUUID(), level: "warn", message: msg, timestamp: Date.now() });
      console.warn(...args);
    },
    error: (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      if (logCapture) logCapture.push({ id: crypto.randomUUID(), level: "error", message: msg, timestamp: Date.now() });
      console.error(...args);
    },
  };

  try {
    const fn = new Function("zapi", "console", code);
    fn(zapiObj, captureConsole);
    return null;
  } catch (e) {
    return String(e);
  }
}
