import { delegateTask } from "./delegate-task.js";
import { parseOpenflowBlock } from "../utils/openflow-block.js";
function transcript(turns) {
    return turns.map((t, i) => `## Turn ${i + 1} — ${t.role}\n${t.content}`).join("\n\n");
}
export async function runDebate(workflow, prompt, context, sessionId, client, settings, ledger, signal) {
    const { proposer, critic, rounds, judge } = workflow;
    const turns = [];
    // --- Proposer: initial case ---
    const { result: initial } = await delegateTask({
        agent: proposer,
        prompt: `${prompt}\n\nYou are the proposer. Make your case clearly and persuasively.`,
        context,
        sessionId,
    }, client, signal, settings.agentTimeoutMs, ledger);
    turns.push({ role: "proposer", content: initial });
    // --- Rounds: critic then proposer (until final round) ---
    for (let round = 1; round <= rounds; round++) {
        const { result: criticOutput } = await delegateTask({
            agent: critic,
            prompt: `${prompt}\n\nYou are the critic. Argue against the latest proposer position. Be specific and constructive.`,
            context: transcript(turns),
            sessionId,
        }, client, signal, settings.agentTimeoutMs);
        turns.push({ role: `critic (round ${round})`, content: criticOutput });
        if (round < rounds) {
            const { result: proposerResponse } = await delegateTask({
                agent: proposer,
                prompt: `${prompt}\n\nYou are the proposer. Respond to the critic's latest argument.`,
                context: transcript(turns),
                sessionId,
            }, client, signal, settings.agentTimeoutMs);
            turns.push({ role: `proposer (round ${round})`, content: proposerResponse });
        }
    }
    // --- Proposer: final rebuttal ---
    const { result: rebuttal } = await delegateTask({
        agent: proposer,
        prompt: `${prompt}\n\nYou are the proposer. Give your final closing rebuttal. Be concise and decisive.`,
        context: transcript(turns),
        sessionId,
    }, client, signal, settings.agentTimeoutMs, ledger);
    turns.push({ role: "proposer (rebuttal)", content: rebuttal });
    // --- Judge ---
    const judgePrompt = [
        prompt,
        "",
        "You are the judge. Review the full debate transcript in the context above and deliver a verdict.",
        "End your response with an openflow decision block:",
        "```openflow",
        '{"decision":"adopt","reason":"<why>"}',
        "```",
        'Valid decisions: "adopt" (accept the proposal), "reject" (reject it), "revise" (accept with modifications).',
    ].join("\n");
    const { result: judgeOutput } = await delegateTask({ agent: judge, prompt: judgePrompt, context: transcript(turns), sessionId }, client, signal, settings.agentTimeoutMs, ledger);
    const block = parseOpenflowBlock(judgeOutput);
    const decision = typeof block?.decision === "string" ? block.decision : "(no decision)";
    return [
        `Debate complete ✅ — ${rounds} round(s), judge decision: **${decision}**`,
        "",
        "## Full debate transcript",
        transcript(turns),
        "",
        "## Judge verdict",
        judgeOutput,
    ].join("\n");
}
//# sourceMappingURL=run-debate.js.map