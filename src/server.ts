import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { AskInput, ResetInput } from './schemas.js';
import { InvalidCwdError, type SessionPool } from './pool.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

function failure(err: unknown): ToolResult {
  const correlationId = randomUUID();
  if (err instanceof InvalidCwdError)
    return json({ status: 'ERROR', error: err.message, correlationId }, true);
  process.stderr.write(
    `[conector] ${correlationId} erro interno: ${err instanceof Error ? err.name : 'desconhecido'}\n`,
  );
  return json({ status: 'ERROR', error: `Erro interno (ref ${correlationId}).`, correlationId }, true);
}

export function createServer(pool: SessionPool): McpServer {
  const server = new McpServer({ name: 'conector-claude-antigravity', version: '0.1.0' });

  server.registerTool(
    'ask',
    {
      description:
        'Envia um prompt ao Google Antigravity (agy), mantendo o processo vivo por projeto (turnos seguintes ~4 s). cwd deve ser absoluto. Escrita de arquivos só funciona se o agy tiver regras permissions.allow.',
      inputSchema: AskInput.shape,
    },
    async (args) => {
      try {
        const out = await pool.ask(AskInput.parse(args));
        return json(out, out.status === 'ERROR' || out.status === 'TIMEOUT');
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'reset',
    {
      description: 'Encerra a sessão agy do cwd; a próxima chamada cria uma nova conversa.',
      inputSchema: ResetInput.shape,
    },
    async (args) => {
      try {
        return json({ reset: await pool.reset(ResetInput.parse(args).cwd) });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool('status', { description: 'Lista as sessões agy vivas.', inputSchema: {} }, async () =>
    json(pool.status()),
  );

  return server;
}
