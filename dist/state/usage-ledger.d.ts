export type Usage = {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
};
export type UsageStep = {
    agent: string;
    model?: string;
    usage: Usage;
};
export declare const ZERO_USAGE: Usage;
/** Shape of the assistant message metadata we read usage from (subset of the SDK type). */
type UsageSource = {
    cost?: number;
    modelID?: string;
    tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: {
            read?: number;
            write?: number;
        };
    };
};
/**
 * Pull usage + model out of a prompt response's assistant message. Tolerates a
 * missing `info` or absent fields (e.g. local models, or the test double) by
 * defaulting to zero — callers get ZERO_USAGE rather than throwing (#62 AC:
 * "no behavior change when fields are absent").
 */
export declare function extractUsage(info: UsageSource | undefined): {
    usage: Usage;
    model?: string;
};
export declare class UsageLedger {
    private readonly entries;
    record(agent: string, usage: Usage, model?: string): void;
    get steps(): readonly UsageStep[];
    total(): Usage;
}
/**
 * Compact one-line cost footer for a workflow relay. Always shows token totals
 * and step count; cache hit-rate and cost are shown only when non-zero so the
 * footer stays quiet for providers that don't report them. Returns "" when no
 * steps ran (nothing to account for).
 */
export declare function formatUsageFooter(ledger: UsageLedger): string;
export {};
//# sourceMappingURL=usage-ledger.d.ts.map