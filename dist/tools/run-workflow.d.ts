import type { SequentialWorkflow } from "../config/workflow-loader.js";
export declare function runSequential(workflow: SequentialWorkflow, prompt: string, initialContext: string | undefined, sessionId: string | undefined, serverUrl: string, workDir: string, dispatch: typeof runWorkflow): Promise<string>;
export declare function runWorkflow(name: string, prompt: string, context: string | undefined, sessionId: string | undefined, serverUrl: string, workDir: string): Promise<string>;
//# sourceMappingURL=run-workflow.d.ts.map