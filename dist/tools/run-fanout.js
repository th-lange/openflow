import { delegateTask } from "./delegate-task.js";
import { parallelDispatch } from "./parallel-dispatch.js";
import { parseOpenflowBlock } from "../utils/openflow-block.js";
export async function runFanout(workflow, prompt, context, sessionId, client, settings, ledger, signal) {
    const { agents, picker, pickerPrompt } = workflow;
    const tasks = agents.map((agent) => ({ agent, prompt, context, sessionId }));
    const results = await parallelDispatch(tasks, client, signal, {
        maxConcurrent: settings.maxConcurrent,
        timeoutMs: settings.agentTimeoutMs,
        ledger,
    });
    const successful = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    if (successful.length === 0) {
        throw new Error(`All ${agents.length} fan-out agents failed: ${failed.map((f) => f.error).join("; ")}`);
    }
    const candidatesContext = successful
        .map((r, i) => `## Candidate ${i + 1} (agent: ${r.agent})\n${r.output}`)
        .join("\n\n");
    const failureNote = failed.length > 0
        ? `\n${failed.length} agent(s) failed and were excluded: ${failed.map((f) => `${f.agent} (${f.error})`).join(", ")}.`
        : "";
    const pickerInstruction = [
        pickerPrompt ?? "Select the best candidate based on quality, correctness, and clarity.",
        `${successful.length} candidates are in the context above.${failureNote}`,
        "End your response with an openflow choice block:",
        "```openflow",
        '{"choice":1,"reason":"<why this candidate is best>"}',
        "```",
        "(choice is 1-indexed)",
    ].join("\n");
    const { result: pickerOutput } = await delegateTask({ agent: picker, prompt: pickerInstruction, context: candidatesContext, sessionId }, client, signal, settings.agentTimeoutMs, ledger);
    const block = parseOpenflowBlock(pickerOutput);
    const choiceRaw = block?.choice;
    const choice = typeof choiceRaw === "number"
        ? Math.max(1, Math.min(Math.round(choiceRaw), successful.length))
        : 1;
    const winner = successful[choice - 1];
    return [
        `Fan-out complete ✅ — ${successful.length}/${agents.length} agents succeeded, picker chose candidate ${choice}`,
        "",
        `## Selected output (${winner.agent})`,
        winner.output,
        "",
        "## Picker reasoning",
        pickerOutput,
    ].join("\n");
}
//# sourceMappingURL=run-fanout.js.map