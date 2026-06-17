import type { ConditionalWorkflow } from "../config/workflow-loader.js";
export type WorkflowDispatch = (name: string, prompt: string, context: string | undefined, sessionId: string | undefined, serverUrl: string, workDir: string) => Promise<string>;
export declare function runConditional(workflow: ConditionalWorkflow, prompt: string, context: string | undefined, sessionId: string | undefined, serverUrl: string, workDir: string, dispatch: WorkflowDispatch): Promise<string>;
//# sourceMappingURL=run-conditional.d.ts.map