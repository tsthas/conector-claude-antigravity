import { z } from 'zod';

export type AgyEvent =
  | { kind: 'init'; conversationId: string }
  | {
      kind: 'result';
      status: 'SUCCESS' | 'ERROR';
      response: string;
      conversationId: string;
      deniedActions: string[];
    }
  | { kind: 'ignored' };

const InitLine = z.object({
  event: z.literal('init'),
  conversation_id: z.string(),
});

const ResultLine = z.object({
  event: z.literal('result'),
  result: z.object({
    conversation_id: z.string(),
    status: z.string(),
    response: z.string().default(''),
    denied_actions: z.array(z.object({ action: z.string() }).passthrough()).default([]),
  }),
});

/** Parser tolerante: qualquer linha desconhecida ou inválida vira `ignored`. */
export function parseLine(line: string): AgyEvent {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return { kind: 'ignored' };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { kind: 'ignored' };
  }
  const init = InitLine.safeParse(raw);
  if (init.success) return { kind: 'init', conversationId: init.data.conversation_id };
  const res = ResultLine.safeParse(raw);
  if (res.success) {
    const r = res.data.result;
    return {
      kind: 'result',
      status: r.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR',
      response: r.response,
      conversationId: r.conversation_id,
      deniedActions: r.denied_actions.map((d) => d.action),
    };
  }
  return { kind: 'ignored' };
}

export function encodeUserMessage(prompt: string): string {
  return JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
}
