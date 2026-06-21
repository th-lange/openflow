import { delegateTask } from "./delegate-task.js";
const DEFAULT_MAX_CONCURRENT = 5;
export async function parallelDispatch(tasks, client, signal, options) {
    const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    const results = new Array(tasks.length);
    for (let start = 0; start < tasks.length; start += maxConcurrent) {
        const batch = tasks.slice(start, start + maxConcurrent);
        const batchResults = await Promise.all(batch.map(async (task, batchIdx) => {
            const index = start + batchIdx;
            try {
                const { result } = await delegateTask(task, client, signal, options?.timeoutMs, options?.ledger);
                return { index, agent: task.agent, output: result };
            }
            catch (e) {
                return {
                    index,
                    agent: task.agent,
                    output: "",
                    error: e instanceof Error ? e.message : String(e),
                };
            }
        }));
        for (const r of batchResults)
            results[r.index] = r;
    }
    return results;
}
//# sourceMappingURL=parallel-dispatch.js.map