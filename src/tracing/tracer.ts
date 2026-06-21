// Optional Langfuse tracing for workflow runs (#67).
//
// openflow owns the orchestration boundary, so a workflow run is a natural trace
// and each agent delegation a generation under it. Tracing is strictly opt-in and
// best-effort: when disabled (the default) the engine uses NOOP_TRACER — no import,
// no network, no cost. When enabled, the Langfuse SDK is loaded via a dynamic
// import so it is not a hard dependency, and every Langfuse call is wrapped so a
// misconfigured or unreachable backend can never break a workflow run.
//
// The tracer is consumed through the UsageLedger (#62): the ledger already flows
// to every delegateTask, so attaching a RunTrace to it means no extra plumbing.

import type { LangfuseSettings } from "../config/workflow-loader.js";

export type GenerationData = {
  /** The agent that produced this generation. */
  name: string;
  model?: string;
  input?: string;
  output?: string;
  usage: { input: number; output: number; total: number; cost: number };
  startTime?: Date;
  endTime?: Date;
};

/** A single workflow run's trace. Generations are added as the run progresses. */
export interface RunTrace {
  generation(data: GenerationData): void;
  end(): void;
}

export interface Tracer {
  trace(name: string, metadata?: Record<string, unknown>): RunTrace;
  /** Flush buffered events to the backend. Always resolves (errors swallowed). */
  flush(): Promise<void>;
}

const NOOP_TRACE: RunTrace = { generation() {}, end() {} };

/** Default tracer: does nothing, costs nothing. */
export const NOOP_TRACER: Tracer = {
  trace: () => NOOP_TRACE,
  flush: async () => {},
};

function warn(message: string, e?: unknown): void {
  const detail = e instanceof Error ? `: ${e.message}` : "";
  console.error(`[openflow] langfuse tracing ${message}${detail}`);
}

/**
 * Tracer backed by the Langfuse SDK. Every SDK interaction is guarded so a bad
 * response shape or transport failure degrades to a no-op for that call rather
 * than throwing into the engine.
 */
class LangfuseTracer implements Tracer {
  // `client` is the Langfuse SDK instance; typed loosely so langfuse stays an
  // optional, un-typed dependency.
  constructor(private readonly client: any) {}

  trace(name: string, metadata?: Record<string, unknown>): RunTrace {
    let lfTrace: any;
    try {
      lfTrace = this.client.trace({ name, metadata });
    } catch (e) {
      warn("could not start a trace", e);
      return NOOP_TRACE;
    }
    return {
      generation(data: GenerationData) {
        try {
          lfTrace.generation({
            name: data.name,
            model: data.model,
            input: data.input,
            output: data.output,
            startTime: data.startTime,
            endTime: data.endTime,
            usage: {
              input: data.usage.input,
              output: data.usage.output,
              total: data.usage.total,
              unit: "TOKENS",
            },
            metadata: { cost: data.usage.cost },
          });
        } catch (e) {
          warn("could not record a generation", e);
        }
      },
      end() {
        try {
          lfTrace.update?.({ output: "complete" });
        } catch {
          /* best-effort */
        }
      },
    };
  }

  async flush(): Promise<void> {
    try {
      await this.client.flushAsync();
    } catch (e) {
      warn("flush failed", e);
    }
  }
}

/**
 * Build a tracer from the resolved engine settings. Returns NOOP_TRACER (no
 * dynamic import, no network) unless tracing is enabled in `settings.langfuse`
 * AND both Langfuse API keys are present in the environment. If the `langfuse`
 * package is not installed or the client can't be constructed, also degrades to
 * NOOP_TRACER so enabling tracing never breaks a run.
 */
export async function createTracer(langfuse: LangfuseSettings | undefined): Promise<Tracer> {
  if (!langfuse?.enabled) return NOOP_TRACER;

  const publicKey = process.env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = process.env["LANGFUSE_SECRET_KEY"];
  if (!publicKey || !secretKey) {
    warn("enabled but LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are not set; disabling");
    return NOOP_TRACER;
  }

  const baseUrl = langfuse.host ?? process.env["LANGFUSE_HOST"];
  try {
    // Non-literal specifier so TypeScript treats langfuse as an optional runtime
    // dependency (no static resolution / type requirement).
    const specifier = "langfuse";
    const mod: any = await import(specifier);
    const Langfuse = mod.Langfuse ?? mod.default;
    const client = new Langfuse({ publicKey, secretKey, baseUrl });
    return new LangfuseTracer(client);
  } catch (e) {
    warn("could not load the 'langfuse' package; run `npm i langfuse` to enable", e);
    return NOOP_TRACER;
  }
}
