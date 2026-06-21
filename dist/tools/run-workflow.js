import { delegateTask } from "./delegate-task.js";
import { getWorkflow } from "./workflow-tools.js";
import { runEvaluatorOptimizer } from "./run-evaluator-optimizer.js";
import { runConditional } from "./run-conditional.js";
import { runFanout } from "./run-fanout.js";
import { runParallel } from "./run-parallel.js";
import { runDebate } from "./run-debate.js";
import { resolveSettings, DEFAULT_CONTEXT_SCOPE } from "../config/workflow-loader.js";
import { UsageLedger, formatUsageFooter } from "../state/usage-ledger.js";
function stepLabel(step) {
    if (typeof step === "string")
        return step;
    if ("workflow" in step)
        return `[${step.workflow}]`;
    return "[checkpoint]";
}
/**
 * Build the context threaded into the next step from the prior step results,
 * honouring the workflow's contextScope (#63). `all` threads every prior result,
 * `last` only the most recent, `none` threads nothing. Step numbering reflects
 * each result's true position so labels stay stable across scopes.
 */
function threadedContext(scope, stepResults) {
    if (scope === "none" || stepResults.length === 0)
        return "";
    const indices = scope === "last" ? [stepResults.length - 1] : stepResults.map((_, i) => i);
    return [
        "## Prior step results",
        "",
        ...indices.map((i) => `### Step ${i + 1} — ${stepResults[i].label}\n${stepResults[i].output}`),
    ].join("\n");
}
// ── Sequential ────────────────────────────────────────────────────────────────
export async function runSequential(workflow, prompt, initialContext, sessionId, client, workDir, dispatch, settings, ledger, signal) {
    const { sequence } = workflow;
    const scope = workflow.contextScope ?? DEFAULT_CONTEXT_SCOPE;
    const stepResults = [];
    // Step 1 sees the context entering the workflow; subsequent steps see prior
    // step outputs as governed by contextScope (#63).
    let context = initialContext ?? "";
    for (const step of sequence) {
        let output;
        if (typeof step === "string") {
            ({ result: output } = await delegateTask({ agent: step, prompt, context, sessionId }, client, signal, settings.agentTimeoutMs, ledger));
        }
        else if ("workflow" in step) {
            output = await dispatch(step.workflow, prompt, context, sessionId, client, workDir, signal, settings, ledger);
        }
        else {
            // checkpoint — top-level commander handles these; if we get here it means
            // something bypassed the load-time checkpoint-reference constraint
            throw new Error("Checkpoint steps cannot be executed via run_workflow. " +
                "The commander must handle this workflow step-by-step.");
        }
        stepResults.push({ label: stepLabel(step), output });
        context = threadedContext(scope, stepResults);
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
export async function runWorkflow(name, prompt, context, sessionId, client, workDir, signal, settings, ledger) {
    const workflow = await getWorkflow(name, workDir);
    // Resolve engine settings and the usage ledger once at the top level; nested
    // dispatches reuse them so the cost footer aggregates the whole run (#45, #62).
    const isTop = ledger === undefined;
    const resolved = settings ?? (await resolveSettings(workDir));
    const led = ledger ?? new UsageLedger();
    const result = await dispatchPattern(workflow, name, prompt, context, sessionId, client, workDir, resolved, led, signal);
    // Only the outermost call owns the ledger, so it renders the aggregate footer.
    return isTop ? result + formatUsageFooter(led) : result;
}
async function dispatchPattern(workflow, name, prompt, context, sessionId, client, workDir, resolved, led, signal) {
    switch (workflow.pattern) {
        case "sequential":
            return runSequential(workflow, prompt, context, sessionId, client, workDir, runWorkflow, resolved, led, signal);
        case "evaluator-optimizer":
            return runEvaluatorOptimizer(workflow, prompt, context, sessionId, client, resolved, led, signal);
        case "conditional":
            return runConditional(workflow, prompt, context, sessionId, client, workDir, runWorkflow, resolved, led, signal);
        case "fanout":
            return runFanout(workflow, prompt, context, sessionId, client, resolved, led, signal);
        case "parallel":
            return runParallel(workflow, prompt, context, sessionId, client, resolved, led, signal);
        case "debate":
            return runDebate(workflow, prompt, context, sessionId, client, resolved, led, signal);
        case "orchestrator":
            throw new Error(`Workflow "${name}" uses pattern "orchestrator" which is prompt-driven. ` +
                `Handle it via delegate_task loops per your system instructions.`);
    }
}
//# sourceMappingURL=run-workflow.js.map