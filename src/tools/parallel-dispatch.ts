import { delegateTask } from "./delegate-task.js";
import type { DelegateTaskInput } from "./delegate-task.js";

export type DispatchResult = {
  index: number;
  agent: string;
  output: string;
  error?: string;
};

const MAX_CONCURRENT = 5;

export async function parallelDispatch(
  tasks: DelegateTaskInput[],
  serverUrl: string
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = new Array(tasks.length);

  for (let start = 0; start < tasks.length; start += MAX_CONCURRENT) {
    const batch = tasks.slice(start, start + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map(async (task, batchIdx) => {
        const index = start + batchIdx;
        try {
          const { result } = await delegateTask(task, serverUrl);
          return { index, agent: task.agent, output: result };
        } catch (e) {
          return {
            index,
            agent: task.agent,
            output: "",
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })
    );
    for (const r of batchResults) results[r.index] = r;
  }

  return results;
}
