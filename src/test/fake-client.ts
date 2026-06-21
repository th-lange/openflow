import type { OpencodeClient } from "@opencode-ai/sdk";

// In-memory OpencodeClient double for unit-testing the execution path without
// an LLM or a running server (#44). It implements the four methods the engine
// touches — app.agents, session.create/prompt/delete — and records every call
// so tests can assert on sequencing, context threading, and session lifecycle.

export type PromptCall = { agent: string; text: string; sessionId: string };

export type FakeUsage = {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  model?: string;
};

export type FakeClientOptions = {
  agents: string[];
  /** Optional per-agent model returned by app.agents(), for model-visibility tests (#60). */
  agentModels?: Record<string, { providerID: string; modelID: string }>;
  /**
   * Produce the agent's text response. Receives the agent name and the full
   * prompt text (delegateTask has already merged any context in). May be async
   * and may throw to simulate an agent failure.
   */
  respond?: (agent: string, text: string) => string | Promise<string>;
  /**
   * Optional per-call token/cost, attached to the response's assistant message
   * `info` so the engine's usage accounting can be exercised (#62). When omitted,
   * no `info` is returned and usage extraction falls back to zero.
   */
  usage?: (agent: string, text: string) => FakeUsage;
};

export type TitleUpdate = { id: string; title?: string };

export type FakeClient = OpencodeClient & {
  readonly calls: PromptCall[];
  readonly created: string[];
  readonly deleted: string[];
  readonly titled: TitleUpdate[];
};

export function makeFakeClient(opts: FakeClientOptions): FakeClient {
  const calls: PromptCall[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const titled: TitleUpdate[] = [];
  let counter = 0;

  const client = {
    app: {
      agents: () =>
        Promise.resolve({
          data: opts.agents.map((name) => ({
            name,
            mode: "subagent",
            ...(opts.agentModels?.[name] ? { model: opts.agentModels[name] } : {}),
          })) as any,
          error: undefined,
        }),
    },
    session: {
      create: () => {
        const id = `child-${++counter}`;
        created.push(id);
        return Promise.resolve({ data: { id } as any, error: undefined });
      },
      update: ({ path, body }: any) => {
        titled.push({ id: path.id, title: body?.title });
        return Promise.resolve({ data: {} as any, error: undefined });
      },
      prompt: async ({ path, body }: any) => {
        const agent = body.agent as string;
        const text = (body.parts ?? []).map((p: any) => p.text).join("");
        calls.push({ agent, text, sessionId: path.id });
        const out = opts.respond ? await opts.respond(agent, text) : `response from ${agent}`;
        const u = opts.usage?.(agent, text);
        const info = u
          ? {
              modelID: u.model ?? `model-${agent}`,
              cost: u.cost ?? 0,
              tokens: {
                input: u.input ?? 0,
                output: u.output ?? 0,
                reasoning: u.reasoning ?? 0,
                cache: { read: u.cacheRead ?? 0, write: u.cacheWrite ?? 0 },
              },
            }
          : undefined;
        return { data: { info, parts: [{ type: "text", text: out }] } as any, error: undefined };
      },
      delete: ({ path }: any) => {
        deleted.push(path.id);
        return Promise.resolve({ data: {} as any, error: undefined });
      },
    },
  } as unknown as FakeClient;

  // Expose the recorders (the cast above strips the literal's extra props).
  Object.assign(client, { calls, created, deleted, titled });
  return client;
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
