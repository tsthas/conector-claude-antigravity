// Teste de contrato + benchmark com o agy REAL, via cliente MCP sobre stdio.
// Uso: npm run build && node scripts/bench.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cwd = mkdtempSync(join(tmpdir(), 'conector-bench-'));
const countAgy = () => {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq agy.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.includes('agy.exe')).length;
  } catch {
    return -1;
  }
};

const client = new Client({ name: 'bench', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(import.meta.dirname, '../dist/index.js')],
});
await client.connect(transport);

const call = async (name, args) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const body = JSON.parse(r.content[0].text);
  return { body, wall: ((Date.now() - t0) / 1000).toFixed(1), isError: !!r.isError };
};

const before = countAgy();
console.log('agy.exe antes:', before);
console.log('ferramentas:', (await client.listTools()).tools.map((t) => t.name).join(', '));

const prompts = ['Responda apenas: A', 'Qual foi sua resposta anterior? Apenas a letra.', 'Responda apenas: C'];
for (const [i, p] of prompts.entries()) {
  const { body, wall, isError } = await call('ask', { prompt: p, cwd, effort: 'low', timeoutSec: 120 });
  console.log(`turno ${i + 1}: ${wall}s status=${body.status} reused=${body.reusedSession} resp=${JSON.stringify((body.response ?? '').trim().slice(0, 40))} err=${isError}`);
}
console.log('status:', JSON.stringify((await call('status', {})).body));
console.log('agy.exe durante:', countAgy());
console.log('reset:', JSON.stringify((await call('reset', { cwd })).body));
const bad = await call('ask', { prompt: 'x', cwd: 'relativo' });
console.log('cwd inválido ->', bad.body.status, bad.isError);

await client.close();
await new Promise((r) => setTimeout(r, 4000));
console.log('agy.exe depois do shutdown:', countAgy(), '(esperado:', before + ')');
rmSync(cwd, { recursive: true, force: true });
