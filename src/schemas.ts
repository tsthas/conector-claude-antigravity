import { z } from 'zod';

export const AskInput = z.object({
  prompt: z.string().min(1).max(100_000),
  cwd: z.string().min(1),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  timeoutSec: z.number().int().min(5).max(1800).default(300),
});
export type AskInput = z.infer<typeof AskInput>;

export const AskStatus = z.enum(['SUCCESS', 'ERROR', 'TIMEOUT', 'PERMISSION_DENIED']);
export type AskStatus = z.infer<typeof AskStatus>;

export const AskOutput = z.object({
  response: z.string(),
  conversationId: z.string(),
  status: AskStatus,
  error: z.string().optional(),
  /** Ações que o agy negou no turno (ex.: write_file, command); vazio se nenhuma. */
  deniedActions: z.array(z.string()),
  durationMs: z.number(),
  reusedSession: z.boolean(),
  correlationId: z.string(),
});
export type AskOutput = z.infer<typeof AskOutput>;

export const ResetInput = z.object({ cwd: z.string().min(1) });
export type ResetInput = z.infer<typeof ResetInput>;

export const StatusOutput = z.object({
  sessions: z.array(
    z.object({
      cwd: z.string(),
      conversationId: z.string().optional(),
      idleSec: z.number(),
      busy: z.boolean(),
    }),
  ),
});
export type StatusOutput = z.infer<typeof StatusOutput>;
