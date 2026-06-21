import { type OpencodeClient } from "@opencode-ai/sdk";
import type { EvaluatorOptimizerWorkflow, EngineSettings } from "../config/workflow-loader.js";
import type { UsageLedger } from "../state/usage-ledger.js";
export declare function runEvaluatorOptimizer(workflow: EvaluatorOptimizerWorkflow, prompt: string, initialContext: string | undefined, sessionId: string | undefined, client: OpencodeClient, settings: EngineSettings, ledger: UsageLedger, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=run-evaluator-optimizer.d.ts.map