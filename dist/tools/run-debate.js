import { delegateTask } from "./delegate-task.js";
import { parseOpenflowBlock } from "../utils/openflow-block.js";
import { compactForThread } from "../utils/handoff.js";
import { DEFAULT_COMPACT_CONTEXT } from "../config/workflow-loader.js";
function transcript(turns) {
    return turns.map((t, i) => `## Turn ${i + 1} — ${t.role}\n${t.content}`).join("\n\n");
}
/**
 * Transcript threaded *between* turns (#73). Without compaction the full,
 * growing transcript is re-sent on every turn — O(n²) input tokens. When
 * compacting (the default, #64), every turn except the most recent is reduced
 * to its handoff block or a bounded fallback, so inter-turn context stops
 * growing with the whole transcript. The latest turn stays full because each
 * participant is prompted to engage with it directly. The judge and the final
 * relay still receive the full transcript (see runDebate) so verdict quality
 * and the readable output are unaffected.
 */
function threadedTranscript(turns, compact) {
    if (!compact)
        return transcript(turns);
    return turns
        .map((t, i) => {
        const content = i === turns.length - 1 ? t.content : compactForThread(t.content);
        return `## Turn ${i + 1} — ${t.role}\n${content}`;
    })
        .join("\n\n");
}
export async function runDebate(workflow, prompt, context, sessionId, client, settings, ledger, signal) {
    const { proposer, critic, rounds, judge } = workflow;
    const compact = workflow.compactContext ?? DEFAULT_COMPACT_CONTEXT;
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
            context: threadedTranscript(turns, compact),
            sessionId,
        }, client, signal, settings.agentTimeoutMs);
        turns.push({ role: `critic (round ${round})`, content: criticOutput });
        if (round < rounds) {
            const { result: proposerResponse } = await delegateTask({
                agent: proposer,
                prompt: `${prompt}\n\nYou are the proposer. Respond to the critic's latest argument.`,
                context: threadedTranscript(turns, compact),
                sessionId,
            }, client, signal, settings.agentTimeoutMs);
            turns.push({ role: `proposer (round ${round})`, content: proposerResponse });
        }
    }
    // --- Proposer: final rebuttal ---
    const { result: rebuttal } = await delegateTask({
        agent: proposer,
        prompt: `${prompt}\n\nYou are the proposer. Give your final closing rebuttal. Be concise and decisive.`,
        context: threadedTranscript(turns, compact),
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
    // The judge always sees the full transcript — it is a single final call (not
    // part of the O(n²) inter-turn threading) and verdict quality depends on it.
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