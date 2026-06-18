import { type OpencodeClient } from "@opencode-ai/sdk";
import type { DebateWorkflow, EngineSettings } from "../config/workflow-loader.js";
export declare function runDebate(workflow: DebateWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, settings: EngineSettings, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-debate.d.ts.map