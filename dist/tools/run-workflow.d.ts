import { type OpencodeClient } from "@opencode-ai/sdk";
import type { SequentialWorkflow } from "../config/workflow-loader.js";
export declare function runSequential(workflow: SequentialWorkflow, prompt: string, initialContext: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, dispatch: typeof runWorkflow, signal?: AbortSignal): Promise<string>;
export declare function runWorkflow(name: string, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-workflow.d.ts.map