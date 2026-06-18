import { type OpencodeClient } from "@opencode-ai/sdk";
import type { EvaluatorOptimizerWorkflow, EngineSettings } from "../config/workflow-loader.js";
export declare function runEvaluatorOptimizer(workflow: EvaluatorOptimizerWorkflow, prompt: string, initialContext: string | undefined, sessionId: string | undefined, client: OpencodeClient, settings: EngineSettings, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-evaluator-optimizer.d.ts.map