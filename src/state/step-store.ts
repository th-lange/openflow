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

const store = new Map<string, StepState>();

export const stepStore = {
  get(sessionId: string): StepState | undefined {
    return store.get(sessionId);
  },

  init(sessionId: string, workflowName: string, sequence: string[]): StepState {
    const state: StepState = { workflowName, sequence, currentStep: 0, completedSteps: [] };
    store.set(sessionId, state);
    return state;
  },

  recordStep(sessionId: string, agent: string, summary: string): void {
    const state = store.get(sessionId);
    if (!state) throw new Error(`No workflow state for session ${sessionId}`);
    state.completedSteps.push({ agent, summary });
    state.currentStep += 1;
    store.set(sessionId, state);
  },

  reset(sessionId: string): void {
    store.delete(sessionId);
  },
};
