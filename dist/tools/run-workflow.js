import { delegateTask } from "./delegate-task.js";
import { getWorkflow } from "./workflow-tools.js";
import { runEvaluatorOptimizer } from "./run-evaluator-optimizer.js";
import { runConditional } from "./run-conditional.js";
import { runFanout } from "./run-fanout.js";
import { runParallel } from "./run-parallel.js";
import { runDebate } from "./run-debate.js";
function stepLabel(step) {
    if (typeof step === "string")
        return step;
    if ("workflow" in step)
        return `[${step.workflow}]`;
    return "[checkpoint]";
}
// ── Sequential ────────────────────────────────────────────────────────────────
export async function runSequential(workflow, prompt, initialContext, sessionId, client, workDir, dispatch, signal) {
    const { sequence } = workflow;
    const stepResults = [];
    let context = initialContext ?? "";
    for (const step of sequence) {
        let output;
        if (typeof step === "string") {
            ({ result: output } = await delegateTask({ agent: step, prompt, context, sessionId }, client, signal));
        }
        else if ("workflow" in step) {
            output = await dispatch(step.workflow, prompt, context, sessionId, client, workDir, signal);
        }
        else {
            // checkpoint — top-level commander handles these; if we get here it means
            // something bypassed the load-time checkpoint-reference constraint
            throw new Error("Checkpoint steps cannot be executed via run_workflow. " +
                "The commander must handle this workflow step-by-step.");
        }
        stepResults.push({ label: stepLabel(step), output });
        context = [
            "## Prior step results",
            "",
            ...stepResults.map(({ label, output }, idx) => `### Step ${idx + 1} — ${label}\n${output}`),
        ].join("\n");
    }
    const total = sequence.length;
    const header = `Workflow complete ✅ (${sequence.map(stepLabel).join(" → ")})`;
    return [
        header,
        "",
        ...stepResults.flatMap(({ label, output }, idx) => [
            `## Step ${idx + 1}/${total} — ${label}`,
            output,
            "",
        ]),
    ].join("\n");
}
// ── Dispatcher ────────────────────────────────────────────────────────────────
export async function runWorkflow(name, prompt, context, sessionId, client, workDir, signal) {
    const workflow = await getWorkflow(name, workDir);
    switch (workflow.pattern) {
        case "sequential":
            return runSequential(workflow, prompt, context, sessionId, client, workDir, runWorkflow, signal);
        case "evaluator-optimizer":
            return runEvaluatorOptimizer(workflow, prompt, context, sessionId, client, signal);
        case "conditional":
            return runConditional(workflow, prompt, context, sessionId, client, workDir, runWorkflow, signal);
        case "fanout":
            return runFanout(workflow, prompt, context, sessionId, client, signal);
        case "parallel":
            return runParallel(workflow, prompt, context, sessionId, client, signal);
        case "debate":
            return runDebate(workflow, prompt, context, sessionId, client, signal);
        case "orchestrator":
            throw new Error(`Workflow "${name}" uses pattern "orchestrator" which is prompt-driven. ` +
                `Handle it via delegate_task loops per your system instructions.`);
    }
}
//# sourceMappingURL=run-workflow.js.map