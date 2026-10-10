#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SessionPool } from './pool.js';
import { createServer } from './server.js';

const command = process.env['CONECTOR_COMMAND'] ?? process.env['AGY_BRIDGE_COMMAND'] ?? 'agy';
const idleMin = Number(process.env['CONECTOR_IDLE_MIN'] ?? process.env['AGY_BRIDGE_IDLE_MIN'] ?? '15');
const pool = new SessionPool({
  command,
  baseArgs: ['-p=', '--input-format', 'stream-json', '--output-format', 'stream-json'],
  idleTtlMs: (Number.isFinite(idleMin) && idleMin > 0 ? idleMin : 15) * 60_000,
});
pool.startSweeper();

const server = createServer(pool);
await server.connect(new StdioServerTransport());

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  await pool.closeAll();
  process.exit(0);
};
process.stdin.on('close', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
