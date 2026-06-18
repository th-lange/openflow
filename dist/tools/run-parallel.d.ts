import { type OpencodeClient } from "@opencode-ai/sdk";
import type { ParallelWorkflow, EngineSettings } from "../config/workflow-loader.js";
export declare function runParallel(workflow: ParallelWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, settings: EngineSettings, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-parallel.d.ts.map