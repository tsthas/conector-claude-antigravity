import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { AgySession } from './session.js';
import type { AskInput, AskOutput, StatusOutput } from './schemas.js';

export interface PoolOptions {
  command: string;
  baseArgs: string[];
  idleTtlMs: number;
}

export class InvalidCwdError extends Error {}

export function validateCwd(cwd: string): string {
  if (!isAbsolute(cwd)) throw new InvalidCwdError('cwd deve ser um caminho absoluto');
  const norm = resolve(cwd);
  let ok = false;
  try {
    ok = statSync(norm).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new InvalidCwdError('cwd não existe ou não é um diretório');
  return norm;
}

const key = (cwd: string): string => (process.platform === 'win32' ? cwd.toLowerCase() : cwd);

export class SessionPool {
  private readonly sessions = new Map<string, AgySession>();
  private readonly locks = new Map<string, Promise<void>>();
  private sweeper: NodeJS.Timeout | undefined;
  private closing = false;

  constructor(private readonly opts: PoolOptions) {}

  startSweeper(intervalMs = 60_000): void {
    this.sweeper = setInterval(() => void this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  /** Serializa criação/troca de sessão por cwd, evitando duas sessões para a mesma chave. */
  private async withLock<T>(k: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(k) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    this.locks.set(k, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      void tail.then(() => {
        if (this.locks.get(k) === tail) this.locks.delete(k);
      });
    }
  }

  private getSession(cwd: string, effort: string | undefined): Promise<AgySession> {
    const k = key(cwd);
    return this.withLock(k, async () => {
      if (this.closing) throw new Error('pool encerrado');
      let s = this.sessions.get(k);
      if (s && effort !== undefined && s.effort !== effort) {
        await s.drain(); // termina os turnos já aceitos com o effort antigo
        if (this.sessions.get(k) === s) this.sessions.delete(k);
        await s.dispose();
        s = undefined;
      }
      if (!s) {
        s = new AgySession({ cwd, command: this.opts.command, baseArgs: this.opts.baseArgs, effort });
        this.sessions.set(k, s);
      }
      return s;
    });
  }

  async ask(input: AskInput): Promise<AskOutput> {
    const cwd = validateCwd(input.cwd);
    const session = await this.getSession(cwd, input.effort);
    const out = await session.ask(input.prompt, input.timeoutSec);
    // Só descarta a sessão morta se não houver turno na fila: ele reiniciaria o processo fora do mapa.
    if (!session.alive && !session.busy && this.sessions.get(key(cwd)) === session)
      this.sessions.delete(key(cwd));
    return out;
  }

  async reset(cwdInput: string): Promise<boolean> {
    const cwd = validateCwd(cwdInput);
    const s = this.sessions.get(key(cwd));
    if (!s) return false;
    this.sessions.delete(key(cwd));
    await s.dispose();
    return true;
  }

  status(now = Date.now()): StatusOutput {
    return {
      sessions: [...this.sessions.values()].map((s) => ({
        cwd: s.cwd,
        ...(s.conversationId ? { conversationId: s.conversationId } : {}),
        idleSec: Math.floor((now - s.lastUsed) / 1000),
        busy: s.busy,
      })),
    };
  }

  /** Fecha sessões ociosas além do TTL (nunca as que têm turno em execução ou na fila). */
  async sweep(now = Date.now()): Promise<number> {
    let closed = 0;
    for (const [k, s] of [...this.sessions]) {
      if (!s.busy && now - s.lastUsed >= this.opts.idleTtlMs) {
        this.sessions.delete(k);
        await s.dispose();
        closed++;
      }
    }
    return closed;
  }

  async closeAll(): Promise<void> {
    this.closing = true;
    if (this.sweeper) clearInterval(this.sweeper);
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => s.dispose()));
  }
}
