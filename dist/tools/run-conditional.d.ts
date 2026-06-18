import { type OpencodeClient } from "@opencode-ai/sdk";
import type { ConditionalWorkflow, EngineSettings } from "../config/workflow-loader.js";
export type WorkflowDispatch = (name: string, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, signal?: AbortSignal, settings?: EngineSettings) => Promise<string>;
export declare function runConditional(workflow: ConditionalWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, dispatch: WorkflowDispatch, settings: EngineSettings, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-conditional.d.ts.map