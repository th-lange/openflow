import { type OpencodeClient } from "@opencode-ai/sdk";
import type { ParallelWorkflow, EngineSettings } from "../config/workflow-loader.js";
import type { UsageLedger } from "../state/usage-ledger.js";
export declare function runParallel(workflow: ParallelWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, settings: EngineSettings, ledger: UsageLedger, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-parallel.d.ts.map