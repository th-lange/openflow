const store = new Map();
export const stepStore = {
    get(sessionId) {
        return store.get(sessionId);
    },
    init(sessionId, workflowName, sequence) {
        const state = { workflowName, sequence, currentStep: 0, completedSteps: [] };
        store.set(sessionId, state);
        return state;
    },
    recordStep(sessionId, agent, summary) {
        const state = store.get(sessionId);
        if (!state)
            throw new Error(`No workflow state for session ${sessionId}`);
        state.completedSteps.push({ agent, summary });
        state.currentStep += 1;
        store.set(sessionId, state);
    },
    reset(sessionId) {
        store.delete(sessionId);
    },
};
//# sourceMappingURL=step-store.js.map