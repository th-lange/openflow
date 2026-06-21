import { z } from "zod";
export declare const sequenceStepSchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    workflow: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    checkpoint: z.ZodString;
}, z.core.$strip>]>;
export declare const createWorkflowArgs: {
    name: z.ZodString;
    pattern: z.ZodOptional<z.ZodEnum<{
        sequential: "sequential";
        orchestrator: "orchestrator";
        "evaluator-optimizer": "evaluator-optimizer";
        conditional: "conditional";
        fanout: "fanout";
        parallel: "parallel";
        debate: "debate";
    }>>;
    description: z.ZodOptional<z.ZodString>;
    force: z.ZodOptional<z.ZodBoolean>;
    sequence: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        workflow: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        checkpoint: z.ZodString;
    }, z.core.$strip>]>>>;
    commanderMayAlsoUse: z.ZodOptional<z.ZodArray<z.ZodString>>;
    contextScope: z.ZodOptional<z.ZodEnum<{
        all: "all";
        last: "last";
        none: "none";
    }>>;
    compactContext: z.ZodOptional<z.ZodBoolean>;
    agents: z.ZodOptional<z.ZodArray<z.ZodString>>;
    satisfactionCriteria: z.ZodOptional<z.ZodString>;
    maxIterations: z.ZodOptional<z.ZodNumber>;
    producer: z.ZodOptional<z.ZodString>;
    evaluator: z.ZodOptional<z.ZodString>;
    passCriteria: z.ZodOptional<z.ZodString>;
    router: z.ZodOptional<z.ZodString>;
    routes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        condition: z.ZodString;
        workflow: z.ZodString;
    }, z.core.$strip>>>;
    default: z.ZodOptional<z.ZodString>;
    picker: z.ZodOptional<z.ZodString>;
    pickerPrompt: z.ZodOptional<z.ZodString>;
    subtasks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        agent: z.ZodString;
        prompt: z.ZodString;
    }, z.core.$strip>>>;
    merger: z.ZodOptional<z.ZodString>;
    proposer: z.ZodOptional<z.ZodString>;
    critic: z.ZodOptional<z.ZodString>;
    judge: z.ZodOptional<z.ZodString>;
    rounds: z.ZodOptional<z.ZodNumber>;
};
export declare const createAgentArgs: {
    name: z.ZodString;
    prompt: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        subagent: "subagent";
        primary: "primary";
        all: "all";
    }>>;
    model: z.ZodOptional<z.ZodString>;
    allowEdit: z.ZodOptional<z.ZodBoolean>;
    allowBash: z.ZodOptional<z.ZodBoolean>;
    force: z.ZodOptional<z.ZodBoolean>;
};
//# sourceMappingURL=schemas.d.ts.map