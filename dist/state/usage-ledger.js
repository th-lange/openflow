// Token/cost accounting for a single workflow run (#62).
//
// `delegateTask` is the one choke point where every agent invocation happens, so
// it records each call's usage into a UsageLedger. The top-level `runWorkflow`
// creates one ledger per run, threads it through the pattern runners, and renders
// an aggregate footer onto the relay. openflow controls the orchestration
// boundary, so it can break cost down per step / per agent — something a
// session-level tool like ccusage cannot.
export const ZERO_USAGE = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
};
/**
 * Pull usage + model out of a prompt response's assistant message. Tolerates a
 * missing `info` or absent fields (e.g. local models, or the test double) by
 * defaulting to zero — callers get ZERO_USAGE rather than throwing (#62 AC:
 * "no behavior change when fields are absent").
 */
export function extractUsage(info) {
    const t = info?.tokens;
    return {
        model: info?.modelID,
        usage: {
            input: t?.input ?? 0,
            output: t?.output ?? 0,
            reasoning: t?.reasoning ?? 0,
            cacheRead: t?.cache?.read ?? 0,
            cacheWrite: t?.cache?.write ?? 0,
            cost: info?.cost ?? 0,
        },
    };
}
export class UsageLedger {
    trace;
    entries = [];
    /** When a trace is attached, each recorded step is also emitted as a generation (#67). */
    constructor(trace) {
        this.trace = trace;
    }
    record(agent, usage, model, detail) {
        this.entries.push({ agent, model, usage });
        this.trace?.generation({
            name: agent,
            model,
            input: detail?.input,
            output: detail?.output,
            startTime: detail?.startTime,
            endTime: detail?.endTime,
            usage: { input: usage.input, output: usage.output, total: usage.input + usage.output, cost: usage.cost },
        });
    }
    get steps() {
        return this.entries;
    }
    total() {
        return this.entries.reduce((acc, e) => ({
            input: acc.input + e.usage.input,
            output: acc.output + e.usage.output,
            reasoning: acc.reasoning + e.usage.reasoning,
            cacheRead: acc.cacheRead + e.usage.cacheRead,
            cacheWrite: acc.cacheWrite + e.usage.cacheWrite,
            cost: acc.cost + e.usage.cost,
        }), { ...ZERO_USAGE });
    }
}
function fmtTokens(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
/**
 * Compact one-line cost footer for a workflow relay. Always shows token totals
 * and step count; cache hit-rate and cost are shown only when non-zero so the
 * footer stays quiet for providers that don't report them. Returns "" when no
 * steps ran (nothing to account for).
 */
export function formatUsageFooter(ledger) {
    const steps = ledger.steps.length;
    if (steps === 0)
        return "";
    const t = ledger.total();
    const cacheBase = t.input + t.cacheRead;
    const parts = [`tokens: ${fmtTokens(t.input)} in / ${fmtTokens(t.output)} out`];
    if (t.cacheRead > 0)
        parts.push(`cache ${Math.round((t.cacheRead / cacheBase) * 100)}% read`);
    if (t.cost > 0)
        parts.push(`~$${t.cost.toFixed(4)}`);
    parts.push(`${steps} step${steps === 1 ? "" : "s"}`);
    return `\n\n---\n_${parts.join(" · ")}_`;
}
//# sourceMappingURL=usage-ledger.js.map