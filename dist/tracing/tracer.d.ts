import type { LangfuseSettings } from "../config/workflow-loader.js";
export type GenerationData = {
    /** The agent that produced this generation. */
    name: string;
    model?: string;
    input?: string;
    output?: string;
    usage: {
        input: number;
        output: number;
        total: number;
        cost: number;
    };
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
/** Default tracer: does nothing, costs nothing. */
export declare const NOOP_TRACER: Tracer;
/**
 * Build a tracer from the resolved engine settings. Returns NOOP_TRACER (no
 * dynamic import, no network) unless tracing is enabled in `settings.langfuse`
 * AND both Langfuse API keys are present in the environment. If the `langfuse`
 * package is not installed or the client can't be constructed, also degrades to
 * NOOP_TRACER so enabling tracing never breaks a run.
 */
export declare function createTracer(langfuse: LangfuseSettings | undefined): Promise<Tracer>;
//# sourceMappingURL=tracer.d.ts.map