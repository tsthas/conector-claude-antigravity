import { describe, expect, it } from 'vitest';
import { encodeUserMessage, parseLine } from '../src/protocol.js';
import { AskInput } from '../src/schemas.js';

describe('protocol', () => {
  it('lê init', () => {
    expect(parseLine('{"event":"init","conversation_id":"c1","init":{}}')).toEqual({ kind: 'init', conversationId: 'c1' });
  });

  it('lê result com sucesso', () => {
    const ev = parseLine('{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"OK\\n"}}');
    expect(ev).toEqual({ kind: 'result', status: 'SUCCESS', response: 'OK\n', conversationId: 'c1', deniedActions: [] });
  });

  it('lê ações negadas (formato real do agy)', () => {
    const ev = parseLine(
      '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"","denied_actions":[{"action":"write_file","display_name":"WriteToFile"}]}}',
    );
    expect(ev).toMatchObject({ kind: 'result', deniedActions: ['write_file'] });
  });

  it('status desconhecido vira ERROR', () => {
    const ev = parseLine('{"event":"result","result":{"conversation_id":"c1","status":"BOOM"}}');
    expect(ev).toMatchObject({ kind: 'result', status: 'ERROR' });
  });

  it('ignora linhas desconhecidas, inválidas e vazias', () => {
    expect(parseLine('{"event":"step_update","step_update":{}}')).toEqual({ kind: 'ignored' });
    expect(parseLine('lixo')).toEqual({ kind: 'ignored' });
    expect(parseLine('{quebrado')).toEqual({ kind: 'ignored' });
    expect(parseLine('')).toEqual({ kind: 'ignored' });
  });

  it('codifica a mensagem de usuário em uma linha NDJSON', () => {
    const line = encodeUserMessage('oi\ncom quebra');
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({ event: 'user', message: { content: 'oi\ncom quebra' } });
  });
});

describe('AskInput', () => {
  it('aplica timeout padrão e rejeita prompt vazio ou timeout fora da faixa', () => {
    expect(AskInput.parse({ prompt: 'a', cwd: 'C:\\x' }).timeoutSec).toBe(300);
    expect(AskInput.safeParse({ prompt: '', cwd: 'C:\\x' }).success).toBe(false);
    expect(AskInput.safeParse({ prompt: 'a', cwd: 'C:\\x', timeoutSec: 1 }).success).toBe(false);
  });
});
