import { type OpencodeClient } from "@opencode-ai/sdk";
import type { ConditionalWorkflow } from "../config/workflow-loader.js";
export type WorkflowDispatch = (name: string, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, signal?: AbortSignal) => Promise<string>;
export declare function runConditional(workflow: ConditionalWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, dispatch: WorkflowDispatch, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-conditional.d.ts.map