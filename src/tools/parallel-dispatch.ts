import { type OpencodeClient } from "@opencode-ai/sdk";
import { delegateTask } from "./delegate-task.js";
import type { DelegateTaskInput } from "./delegate-task.js";

export type DispatchResult = {
  index: number;
  agent: string;
  output: string;
  error?: string;
};

const DEFAULT_MAX_CONCURRENT = 5;

export type DispatchOptions = {
  /** Maximum agents in flight at once (default: 5). */
  maxConcurrent?: number;
  /** Per-agent timeout in milliseconds, forwarded to delegateTask. */
  timeoutMs?: number;
};

export async function parallelDispatch(
  tasks: DelegateTaskInput[],
  client: OpencodeClient,
  signal?: AbortSignal,
  options?: DispatchOptions
): Promise<DispatchResult[]> {
  const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const results: DispatchResult[] = new Array(tasks.length);

  for (let start = 0; start < tasks.length; start += maxConcurrent) {
    const batch = tasks.slice(start, start + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(async (task, batchIdx) => {
        const index = start + batchIdx;
        try {
          const { result } = await delegateTask(task, client, signal, options?.timeoutMs);
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
