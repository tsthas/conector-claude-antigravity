// Simulador do `agy` em modo stream-json, só para testes (sem rede, sem modelo).
import { createInterface } from 'node:readline';

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const conv = `conv-${process.pid}`;
let turn = 0;

send({ event: 'init', conversation_id: conv, init: { cwd: process.cwd(), tools: [], permission_mode: 'request-review' } });

createInterface({ input: process.stdin }).on('line', (line) => {
  let content = '';
  try {
    content = JSON.parse(line).message.content;
  } catch {
    return;
  }
  turn++;
  const result = (extra = {}) =>
    send({
      event: 'result',
      result: { conversation_id: conv, status: 'SUCCESS', response: '', denied_actions: [], ...extra },
    });

  if (content.startsWith('SLOW')) return; // nunca responde
  if (content.startsWith('DIE')) process.exit(1);
  if (content.startsWith('ERR')) return result({ status: 'ERROR' });
  if (content.startsWith('DENY'))
    return result({ response: 'sem permissão', denied_actions: [{ action: 'write_file', display_name: 'WriteToFile' }] });

  const wait = /^WAIT(\d+):/.exec(content);
  const reply = () => {
    send({ event: 'step_update', step_update: { conversation_id: conv, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'x' } });
    const e = process.argv.indexOf('--effort');
    const effort = e >= 0 ? process.argv[e + 1] : 'none';
    result({ response: `pid=${process.pid} turn=${turn} effort=${effort} echo=${content}` });
  };
  if (wait) setTimeout(reply, Number(wait[1]));
  else reply();
});
