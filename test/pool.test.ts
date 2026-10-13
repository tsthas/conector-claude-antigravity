import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidCwdError, SessionPool } from '../src/pool.js';

const FAKE = resolve(import.meta.dirname, 'fake-agy.mjs');
let root: string;
let pool: SessionPool;

const dir = (name: string): string => {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
};
const ask = (cwd: string, prompt: string, timeoutSec = 10) => pool.ask({ prompt, cwd, timeoutSec });
const pidOf = (response: string): number => Number(/pid=(\d+)/.exec(response)?.[1]);
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitDead = async (pid: number): Promise<boolean> => {
  for (let i = 0; i < 50; i++) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conector-test-'));
  pool = new SessionPool({ command: process.execPath, baseArgs: [FAKE], idleTtlMs: 60_000 });
});
afterEach(async () => {
  await pool.closeAll();
  rmSync(root, { recursive: true, force: true });
});

describe('SessionPool', () => {
  it('AC1: inicia o processo uma vez e responde SUCCESS', async () => {
    const out = await ask(dir('a'), 'oi');
    expect(out.status).toBe('SUCCESS');
    expect(out.reusedSession).toBe(false);
    expect(out.response).toContain('echo=oi');
    expect(out.conversationId).toMatch(/^conv-/);
  });

  it('AC2: reaproveita processo e conversa no segundo turno', async () => {
    const cwd = dir('a');
    const a = await ask(cwd, 'um');
    const b = await ask(cwd, 'dois');
    expect(b.reusedSession).toBe(true);
    expect(b.conversationId).toBe(a.conversationId);
    expect(pidOf(b.response)).toBe(pidOf(a.response));
    expect(b.response).toContain('turn=2');
  });

  it('AC3: pedidos simultâneos no mesmo cwd rodam em fila, sem mistura', async () => {
    const cwd = dir('a');
    const [a, b] = await Promise.all([ask(cwd, 'WAIT300:primeiro'), ask(cwd, 'segundo')]);
    expect(a.response).toMatch(/turn=1 .*echo=WAIT300:primeiro/);
    expect(b.response).toMatch(/turn=2 .*echo=segundo/);
  });

  it('AC4: cwd diferentes usam processos independentes', async () => {
    const [a, b] = await Promise.all([ask(dir('a'), 'x'), ask(dir('b'), 'y')]);
    expect(pidOf(a.response)).not.toBe(pidOf(b.response));
  });

  it('AC5: ação negada vira PERMISSION_DENIED e a sessão continua utilizável', async () => {
    const cwd = dir('a');
    const d = await ask(cwd, 'DENY');
    expect(d.status).toBe('PERMISSION_DENIED');
    expect(d.error).toContain('permissions.allow');
    expect(d.deniedActions).toEqual(['write_file']);
    expect(d.error).toContain('write_file');
    const ok = await ask(cwd, 'depois');
    expect(ok.deniedActions).toEqual([]);
    expect(ok.status).toBe('SUCCESS');
    expect(ok.reusedSession).toBe(true);
  });

  it('AC6: timeout mata o processo e a próxima chamada cria sessão nova', async () => {
    const cwd = dir('a');
    const first = await ask(cwd, 'oi');
    const t = await ask(cwd, 'SLOW', 1);
    expect(t.status).toBe('TIMEOUT');
    expect(await waitDead(pidOf(first.response))).toBe(true);
    const next = await ask(cwd, 'volta');
    expect(next.status).toBe('SUCCESS');
    expect(next.reusedSession).toBe(false);
  });

  it('AC7: morte inesperada do agy vira ERROR e a sessão sai do pool', async () => {
    const cwd = dir('a');
    const out = await ask(cwd, 'DIE');
    expect(out.status).toBe('ERROR');
    expect(out.error).not.toContain('DIE');
    expect(pool.status().sessions).toHaveLength(0);
    expect((await ask(cwd, 'renasce')).status).toBe('SUCCESS');
  });

  it('AC8: sessão ociosa além do TTL é encerrada', async () => {
    const out = await ask(dir('a'), 'oi');
    expect(pool.status().sessions).toHaveLength(1);
    expect(await pool.sweep(Date.now() + 61_000)).toBe(1);
    expect(pool.status().sessions).toHaveLength(0);
    expect(await waitDead(pidOf(out.response))).toBe(true);
  });

  it('AC9: closeAll não deixa processo agy órfão', async () => {
    const [a, b] = await Promise.all([ask(dir('a'), 'x'), ask(dir('b'), 'y')]);
    await pool.closeAll();
    expect(await waitDead(pidOf(a.response))).toBe(true);
    expect(await waitDead(pidOf(b.response))).toBe(true);
  });

  it('AC10: cwd relativo, inexistente ou arquivo é rejeitado sem iniciar processo', async () => {
    await expect(ask('relativo/pasta', 'x')).rejects.toBeInstanceOf(InvalidCwdError);
    await expect(ask(join(root, 'nao-existe'), 'x')).rejects.toBeInstanceOf(InvalidCwdError);
    const file = join(root, 'arquivo.txt');
    writeFileSync(file, 'x');
    await expect(ask(file, 'x')).rejects.toBeInstanceOf(InvalidCwdError);
    expect(pool.status().sessions).toHaveLength(0);
  });

  it('AC11: reset encerra a sessão e a próxima chamada começa nova conversa', async () => {
    const cwd = dir('a');
    const a = await ask(cwd, 'x');
    expect(await pool.reset(cwd)).toBe(true);
    expect(await waitDead(pidOf(a.response))).toBe(true);
    expect(await pool.reset(cwd)).toBe(false);
    const b = await ask(cwd, 'y');
    expect(b.reusedSession).toBe(false);
    expect(b.conversationId).not.toBe(a.conversationId);
  });

  it('reset durante um turno falha na hora, sem esperar o timeout', async () => {
    const cwd = dir('a');
    const pending = ask(cwd, 'SLOW', 60);
    await new Promise((r) => setTimeout(r, 1500)); // deixa o agy iniciar e receber o turno
    const t0 = Date.now();
    await pool.reset(cwd);
    const out = await pending;
    expect(out.status).toBe('ERROR');
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('turnos enfileirados após reset falham e não reabrem processo órfão', async () => {
    const cwd = dir('a');
    const first = ask(cwd, 'WAIT5000:um');
    const queued = ask(cwd, 'dois');
    await new Promise((r) => setTimeout(r, 800));
    await pool.reset(cwd);
    const [a, b] = await Promise.all([first, queued]);
    expect(a.status).toBe('ERROR');
    expect(b.status).toBe('ERROR');
    expect(b.response).toBe('');
    expect(pool.status().sessions).toHaveLength(0);
  });

  it('troca de effort com sessão ociosa cria processo novo com o effort pedido', async () => {
    const cwd = dir('a');
    const a = await pool.ask({ prompt: 'x', cwd, effort: 'low', timeoutSec: 10 });
    const b = await pool.ask({ prompt: 'y', cwd, effort: 'high', timeoutSec: 10 });
    expect(a.response).toContain('effort=low');
    expect(b.response).toContain('effort=high');
    expect(b.reusedSession).toBe(false);
    expect(await waitDead(pidOf(a.response))).toBe(true);
  });

  it('asks concorrentes com effort diferente não deixam sessão órfã', async () => {
    const cwd = dir('a');
    const outs = await Promise.all([
      pool.ask({ prompt: 'a', cwd, effort: 'low', timeoutSec: 10 }),
      pool.ask({ prompt: 'b', cwd, effort: 'high', timeoutSec: 10 }),
      pool.ask({ prompt: 'c', cwd, effort: 'low', timeoutSec: 10 }),
    ]);
    expect(outs.every((o) => o.status === 'SUCCESS')).toBe(true);
    expect(pool.status().sessions).toHaveLength(1);
    const pids = [...new Set(outs.map((o) => pidOf(o.response)))];
    await pool.closeAll();
    for (const pid of pids) expect(await waitDead(pid)).toBe(true);
  });

  it('timeout com turno na fila: o próximo reinicia sem processo órfão', async () => {
    const cwd = dir('a');
    const first = await ask(cwd, 'oi');
    const [t, next] = await Promise.all([ask(cwd, 'SLOW', 1), ask(cwd, 'depois')]);
    expect(t.status).toBe('TIMEOUT');
    expect(next.status).toBe('SUCCESS');
    expect(pool.status().sessions).toHaveLength(1);
    const pids = [pidOf(first.response), pidOf(next.response)];
    expect(pids[0]).not.toBe(pids[1]);
    await pool.closeAll();
    for (const pid of pids) expect(await waitDead(pid)).toBe(true);
  });

  it('morte do agy com turno na fila: o próximo reinicia e a sessão segue rastreada', async () => {
    const cwd = dir('a');
    const [d, next] = await Promise.all([ask(cwd, 'DIE'), ask(cwd, 'renasce')]);
    expect(d.status).toBe('ERROR');
    expect(next.status).toBe('SUCCESS');
    expect(pool.status().sessions).toHaveLength(1);
    const pid = pidOf(next.response);
    await pool.closeAll();
    expect(await waitDead(pid)).toBe(true);
  });

  it('sweep não fecha sessão com turno em andamento', async () => {
    const cwd = dir('a');
    const p = ask(cwd, 'WAIT800:longo');
    await new Promise((r) => setTimeout(r, 300));
    expect(await pool.sweep(Date.now() + 120_000)).toBe(0);
    expect((await p).status).toBe('SUCCESS');
  });

  it('não vaza o prompt na mensagem de erro', async () => {
    const out = await ask(dir('a'), 'ERR segredo-do-usuario');
    expect(out.status).toBe('ERROR');
    expect(JSON.stringify(out.error)).not.toContain('segredo-do-usuario');
  });
});
