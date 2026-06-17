import { z } from "zod";
export declare const DelegateTaskInputSchema: z.ZodObject<{
    agent: z.ZodString;
    prompt: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>;
export type DelegateTaskOutput = {
    result: string;
    childSessionId: string;
    stepIndex?: number;
};
export declare function delegateTask(input: DelegateTaskInput, serverUrl: string): Promise<DelegateTaskOutput>;
//# sourceMappingURL=delegate-task.d.ts.map