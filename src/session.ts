import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { encodeUserMessage, parseLine, type AgyEvent } from './protocol.js';
import type { AskOutput } from './schemas.js';

export interface SessionOptions {
  cwd: string;
  command: string;
  baseArgs: string[];
  effort?: string | undefined;
}

type ResultEvent = Extract<AgyEvent, { kind: 'result' }>;

interface Pending {
  resolve: (r: ResultEvent) => void;
  reject: (e: Error) => void;
}

const permissionHint = (actions: string[]): string =>
  `O Antigravity negou ação(ões) por falta de permissão: ${actions.join(', ')}. ` +
  'Isso não garante que nada foi alterado: revise as mudanças (git diff). ' +
  'Para liberar, use uma regra permissions.allow no settings do agy (ex.: write_file(<pasta>) ou command(<comando>)).';

class TimeoutError extends Error {}

export class AgySession {
  readonly cwd: string;
  readonly effort: string | undefined;
  conversationId: string | undefined;
  lastUsed = Date.now();

  private child: ChildProcessWithoutNullStreams | undefined;
  private pending: Pending | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private inflight = 0;
  private disposed = false;

  constructor(private readonly opts: SessionOptions) {
    this.cwd = opts.cwd;
    this.effort = opts.effort;
  }

  get alive(): boolean {
    return this.child !== undefined;
  }

  /** Há turno em execução ou na fila. */
  get busy(): boolean {
    return this.inflight > 0;
  }

  /** Aguarda todos os turnos já enfileirados terminarem. */
  drain(): Promise<void> {
    return this.tail.then(() => undefined);
  }

  /** Enfileira um turno; turnos do mesmo cwd nunca se misturam. */
  ask(prompt: string, timeoutSec: number): Promise<AskOutput> {
    this.inflight++;
    const run = this.tail.then(() => this.runTurn(prompt, timeoutSec));
    this.tail = run.catch(() => undefined);
    void run.finally(() => {
      this.inflight--;
    });
    return run;
  }

  private start(): void {
    const args = [...this.opts.baseArgs];
    if (this.opts.effort) args.push('--effort', this.opts.effort);
    const child = spawn(this.opts.command, args, {
      cwd: this.opts.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32', // grupo próprio em POSIX, para matar a árvore
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    // stderr do agy pode conter dados do usuário: apenas drenado, nunca registrado.
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child === child) this.onLine(line);
    });
    child.on('error', () => this.onDeath(child));
    child.on('exit', () => this.onDeath(child));
  }

  private onDeath(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = undefined;
    const p = this.pending;
    this.pending = undefined;
    p?.reject(new Error('agy encerrou'));
  }

  private onLine(line: string): void {
    const ev = parseLine(line);
    if (ev.kind === 'init') this.conversationId = ev.conversationId;
    else if (ev.kind === 'result') {
      this.conversationId = ev.conversationId;
      const p = this.pending;
      this.pending = undefined;
      p?.resolve(ev);
    }
  }

  private failure(correlationId: string, t0: number, reusedSession: boolean, error: string, status: 'ERROR' | 'TIMEOUT'): AskOutput {
    return {
      response: '',
      conversationId: this.conversationId ?? '',
      status,
      error,
      deniedActions: [],
      durationMs: Date.now() - t0,
      reusedSession,
      correlationId,
    };
  }

  private async runTurn(prompt: string, timeoutSec: number): Promise<AskOutput> {
    const correlationId = randomUUID();
    const t0 = Date.now();
    const reusedSession = this.alive;
    try {
      if (this.disposed)
        return this.failure(correlationId, t0, false, `Sessão encerrada por reset ou ociosidade (ref ${correlationId}).`, 'ERROR');
      if (!this.alive) this.start();
      const child = this.child;
      if (!child) throw new Error('agy não iniciou');

      const result = await new Promise<ResultEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = undefined;
          reject(new TimeoutError());
        }, timeoutSec * 1000);
        this.pending = {
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
        child.stdin.write(encodeUserMessage(prompt));
      });

      const deniedActions = [...new Set(result.deniedActions)];
      const base = {
        response: result.response,
        conversationId: result.conversationId,
        deniedActions,
        durationMs: Date.now() - t0,
        reusedSession,
        correlationId,
      };
      if (result.status === 'ERROR')
        return { ...base, status: 'ERROR', error: `Falha no agy (ref ${correlationId}).` };
      if (deniedActions.length > 0)
        return { ...base, status: 'PERMISSION_DENIED', error: permissionHint(deniedActions) };
      return { ...base, status: 'SUCCESS' };
    } catch (err) {
      const timedOut = err instanceof TimeoutError;
      await this.kill(); // timeout ou morte: a próxima chamada cria processo novo
      return this.failure(
        correlationId,
        t0,
        reusedSession,
        timedOut
          ? `Tempo esgotado após ${timeoutSec}s (ref ${correlationId}).`
          : `Falha de comunicação com o agy (ref ${correlationId}).`,
        timedOut ? 'TIMEOUT' : 'ERROR',
      );
    } finally {
      this.lastUsed = Date.now();
    }
  }

  /** Encerramento definitivo (reset, ociosidade, shutdown): turnos em andamento e enfileirados falham na hora. */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.kill();
  }

  /** Mata o processo e toda a sua árvore; rejeita o turno em andamento. */
  private async kill(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    const p = this.pending;
    this.pending = undefined;
    p?.reject(new Error('agy encerrado'));
    if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const pid = child.pid;
    await new Promise<void>((done) => {
      const guard = setTimeout(done, 3000);
      guard.unref();
      child.once('exit', () => {
        clearTimeout(guard);
        done();
      });
      if (process.platform === 'win32') {
        const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
        k.on('error', () => child.kill('SIGKILL'));
      } else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    });
  }
}
