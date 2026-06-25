/**
 * WebSocket State Machine Runner
 *
 * Executes a WsStateMachine against a live WebSocket connection.
 * Steps run sequentially:
 *   SEND    → sends a message immediately
 *   EXPECT  → waits for a matching inbound message (with timeout)
 *   FORBID  → asserts no matching message was received in the current window
 *   WAIT    → pauses N ms
 *
 * Window semantics for FORBID:
 *   The "window" is the list of received messages accumulated since the last
 *   SEND or EXPECT step that completed. A FORBID checks the window and resets
 *   it on success.
 */

import type { WsMessage } from "./types";
import type { SmStep, SmStepResult, SmRunResult, WsStateMachine } from "./ws-sm-types";
import { matchData } from "./ws-filter";

// ── Runner class ──────────────────────────────────────────────────────────────

interface Waiter {
  matcher: (msg: WsMessage) => boolean;
  resolve: (msg: WsMessage) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type OnUpdate = (results: SmStepResult[]) => void;

export class WsStateMachineRunner {
  private waiters: Waiter[] = [];
  /** Messages accumulated since the last SEND / completed EXPECT */
  private window: WsMessage[] = [];
  /** All messages received in this run (for "since-start" forbid window) */
  private allReceived: WsMessage[] = [];
  private results: SmStepResult[];
  private aborted = false;
  private onUpdate: OnUpdate;

  constructor(
    private machine: WsStateMachine,
    private sendFn: (msg: string) => void,
    onUpdate: OnUpdate
  ) {
    this.results = machine.steps.map((s) => ({ stepId: s.id, status: "pending" }));
    this.onUpdate = onUpdate;
  }

  /** Called by the component whenever a new WS message arrives */
  ingest(msg: WsMessage): void {
    if (this.aborted) return;

    if (msg.direction === "received") {
      this.window.push(msg);
      this.allReceived.push(msg);
    }

    // Notify waiters
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (msg.direction === "received" && w.matcher(msg)) {
        clearTimeout(w.timer);
        this.waiters.splice(i, 1);
        w.resolve(msg);
        break; // only first waiter wins
      }
    }
  }

  /** Abort all pending steps */
  abort(): void {
    this.aborted = true;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("Aborted"));
    }
    this.waiters = [];
  }

  private setResult(stepId: string, update: Partial<SmStepResult>) {
    this.results = this.results.map((r) =>
      r.stepId === stepId ? { ...r, ...update } : r
    );
    this.onUpdate([...this.results]);
  }

  private buildMatcher(step: SmStep): (msg: WsMessage) => boolean {
    return (msg: WsMessage) => {
      if (!step.pattern) return false;
      return matchData(msg.data, {
        matcher: step.matcher ?? "contains",
        pattern: step.pattern,
        jsonpathExpected: step.jsonpathExpected,
      });
    };
  }

  private waitForMessage(step: SmStep): Promise<WsMessage> {
    const timeoutMs = step.timeoutMs ?? 10_000;
    const matcher = this.buildMatcher(step);
    return new Promise<WsMessage>((resolve, reject) => {
      if (this.aborted) { reject(new Error("Aborted")); return; }

      // Check already-queued window messages first
      const immediate = this.window.find(matcher);
      if (immediate) {
        resolve(immediate);
        return;
      }

      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`Timed out after ${timeoutMs}ms — no matching message received`));
      }, timeoutMs);

      this.waiters.push({ matcher, resolve, reject, timer });
    });
  }

  /** Execute the full state machine. Returns the final run result. */
  async run(): Promise<SmRunResult> {
    const startedAt = Date.now();
    this.onUpdate([...this.results]);

    for (let i = 0; i < this.machine.steps.length; i++) {
      if (this.aborted) break;
      const step = this.machine.steps[i];
      this.setResult(step.id, { status: "running" });

      try {
        switch (step.type) {
          // ── SEND ──────────────────────────────────────────────────────────
          case "send": {
            const msg = step.message ?? "";
            this.sendFn(msg);
            this.window = []; // reset window after send
            this.setResult(step.id, {
              status: "pass",
              message: `Sent: ${msg.slice(0, 80)}${msg.length > 80 ? "…" : ""}`,
            });
            break;
          }

          // ── EXPECT ────────────────────────────────────────────────────────
          case "expect": {
            if (!step.pattern) {
              this.setResult(step.id, { status: "skip", message: "No pattern defined" });
              break;
            }
            const t0 = Date.now();
            const matched = await this.waitForMessage(step);
            const elapsed = Date.now() - t0;
            const preview = matched.data.slice(0, 120);

            this.window = []; // reset window after successful expect
            this.setResult(step.id, {
              status: "pass",
              message: `Matched in ${elapsed}ms`,
              actualData: preview,
              elapsedMs: elapsed,
            });
            break;
          }

          // ── FORBID ────────────────────────────────────────────────────────
          case "forbid": {
            if (!step.pattern) {
              this.setResult(step.id, { status: "skip", message: "No pattern defined" });
              break;
            }
            const checkList =
              step.forbidWindow === "since-start" ? this.allReceived : this.window;
            const matcher = this.buildMatcher(step);
            const bad = checkList.find(matcher);

            if (bad) {
              this.setResult(step.id, {
                status: "fail",
                message: `Forbidden message found`,
                actualData: bad.data.slice(0, 120),
              });
              throw new Error("Forbidden message found");
            }

            this.window = []; // reset window after forbid check
            this.setResult(step.id, {
              status: "pass",
              message: `No forbidden messages in window (${checkList.length} checked)`,
            });
            break;
          }

          // ── WAIT ──────────────────────────────────────────────────────────
          case "wait": {
            const ms = step.waitMs ?? 1000;
            await new Promise<void>((r) => setTimeout(r, ms));
            this.setResult(step.id, { status: "pass", message: `Waited ${ms}ms` });
            break;
          }
        }
      } catch (e) {
        if (!this.aborted) {
          this.setResult(step.id, {
            status: "fail",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        // Skip remaining steps
        for (let j = i + 1; j < this.machine.steps.length; j++) {
          this.setResult(this.machine.steps[j].id, { status: "skip" });
        }
        return {
          machineId: this.machine.id,
          status: this.aborted ? "aborted" : "fail",
          startedAt,
          endedAt: Date.now(),
          steps: this.results,
        };
      }
    }

    const allPass = this.results.every(
      (r) => r.status === "pass" || r.status === "skip"
    );
    return {
      machineId: this.machine.id,
      status: this.aborted ? "aborted" : allPass ? "pass" : "fail",
      startedAt,
      endedAt: Date.now(),
      steps: this.results,
    };
  }
}

// ── Default example machine ───────────────────────────────────────────────────

export function createExampleMachine(): WsStateMachine {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: "Status Flow Assertion",
    description: `After sending "start", verify the server responds with status:initializing then status:running, with no error messages in between.`,
    steps: [
      {
        id: crypto.randomUUID(),
        type: "send",
        message: JSON.stringify({ action: "start" }),
        description: "Send start command",
      },
      {
        id: crypto.randomUUID(),
        type: "expect",
        matcher: "jsonpath",
        pattern: "$.status",
        jsonpathExpected: "initializing",
        timeoutMs: 5000,
        description: "Server must respond with status:initializing within 5s",
      },
      {
        id: crypto.randomUUID(),
        type: "forbid",
        matcher: "jsonpath",
        pattern: "$.type",
        jsonpathExpected: "error",
        description: "No error messages between start and initializing",
      },
      {
        id: crypto.randomUUID(),
        type: "expect",
        matcher: "jsonpath",
        pattern: "$.status",
        jsonpathExpected: "running",
        timeoutMs: 10000,
        description: "Server must transition to status:running within 10s",
      },
      {
        id: crypto.randomUUID(),
        type: "forbid",
        matcher: "contains",
        pattern: '"type":"error"',
        description: "No errors during transition to running",
      },
    ],
    createdAt: now,
  };
}
