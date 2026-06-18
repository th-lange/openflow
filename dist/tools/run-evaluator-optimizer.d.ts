import { type OpencodeClient } from "@opencode-ai/sdk";
import type { EvaluatorOptimizerWorkflow } from "../config/workflow-loader.js";
export declare function runEvaluatorOptimizer(workflow: EvaluatorOptimizerWorkflow, prompt: string, initialContext: string | undefined, sessionId: string | undefined, client: OpencodeClient, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-evaluator-optimizer.d.ts.map