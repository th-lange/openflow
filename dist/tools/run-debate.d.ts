import { type OpencodeClient } from "@opencode-ai/sdk";
import type { DebateWorkflow, EngineSettings } from "../config/workflow-loader.js";
import type { UsageLedger } from "../state/usage-ledger.js";
export declare function runDebate(workflow: DebateWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, client: OpencodeClient, settings: EngineSettings, ledger: UsageLedger, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-debate.d.ts.map