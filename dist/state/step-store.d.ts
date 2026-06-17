export type CompletedStep = {
    agent: string;
    summary: string;
};
export type StepState = {
    workflowName: string;
    sequence: string[];
    currentStep: number;
    completedSteps: CompletedStep[];
};
export declare const stepStore: {
    get(sessionId: string): StepState | undefined;
    init(sessionId: string, workflowName: string, sequence: string[]): StepState;
    recordStep(sessionId: string, agent: string, summary: string): void;
    reset(sessionId: string): void;
};
//# sourceMappingURL=step-store.d.ts.map