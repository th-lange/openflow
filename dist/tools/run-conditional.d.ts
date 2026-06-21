import { type OpencodeClient } from "@opencode-ai/sdk";
import type { ConditionalWorkflow, EngineSettings } from "../config/workflow-loader.js";
import type { UsageLedger } from "../state/usage-ledger.js";
export type WorkflowDispatch = (name: string, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, signal?: AbortSignal, settings?: EngineSettings, ledger?: UsageLedger) => Promise<string>;
export declare function runConditional(workflow: ConditionalWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, dispatch: WorkflowDispatch, settings: EngineSettings, ledger: UsageLedger, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-conditional.d.ts.map