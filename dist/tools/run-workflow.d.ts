import { type OpencodeClient } from "@opencode-ai/sdk";
import type { SequentialWorkflow, EngineSettings } from "../config/workflow-loader.js";
export declare function runSequential(workflow: SequentialWorkflow, prompt: string, initialContext: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, dispatch: typeof runWorkflow, settings: EngineSettings, signal?: AbortSignal): Promise<string>;
export declare function runWorkflow(name: string, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, workDir: string, signal?: AbortSignal, settings?: EngineSettings): Promise<string>;
//# sourceMappingURL=run-workflow.d.ts.map