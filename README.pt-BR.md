# Conector Claude ⇄ Antigravity

> 🇬🇧 [Read in English](README.md)

Servidor MCP que permite ao **Claude Code** (ou outro cliente MCP) delegar trabalho ao **Google Antigravity** (`agy`) e mantém o processo do `agy` **aquecido**, um por projeto.

Chamar `agy -p` do zero custa ~20 s a cada vez, porque cada chamada abre uma sessão nova. Este conector inicia o `agy` uma vez por projeto, em modo de streaming, e o reaproveita: as respostas seguintes voltam em cerca de **2 s**.

> **Não oficial.** Sem vínculo com Google ou Anthropic. O protocolo de streaming do `agy` não é documentado oficialmente ([docs/PROTOCOL.md](docs/PROTOCOL.md)) e pode mudar entre versões.

## Requisitos
- Node.js ≥ 22
- CLI do Antigravity (`agy`) instalado, no `PATH` e autenticado
- Um cliente MCP, como o Claude Code

## Instalação
```bash
git clone https://github.com/tsthas/conector-claude-antigravity.git
cd conector-claude-antigravity
npm install
claude mcp add --scope user antigravity-connector -- node /caminho/absoluto/conector-claude-antigravity/dist/index.js
```
Para remover: `claude mcp remove antigravity-connector`.

## Ferramentas
- `ask` — envia um prompt (`prompt`, `cwd` absoluto, `effort?`, `timeoutSec?`) à sessão do projeto.
- `reset` — encerra a sessão do projeto; a próxima chamada começa conversa nova.
- `status` — lista as sessões vivas.

## Permissões
O que o `agy` pode fazer é decidido pelas **suas configurações e permissões já existentes no `agy`, não por este conector**. No modo de streaming ele não consegue pedir aprovação: nega sozinho o que exigir permissão, e o conector devolve `PERMISSION_DENIED`.

**`PERMISSION_DENIED` significa "alguma ação foi negada"** (os nomes das ações negadas vêm em `deniedActions`, por exemplo `write_file` e `command`). Mesmo assim o turno pode ter resposta útil ou mudanças parciais: use um repositório Git e revise (`git diff`) antes de aceitar. A pasta temporária do sistema pode aceitar escrita sem regra nenhuma.

Para liberar escrita só numa pasta, use `permissions.allow` em `~/.gemini/antigravity-cli/settings.json`. No Windows, nos nossos testes, a regra precisou ser escrita com a letra do drive e barras invertidas, exatamente como na mensagem de erro que o `agy` mostra. O conector nunca usa `--dangerously-skip-permissions`.

## Segurança
Sem porta de rede (só stdio), sem `shell: true`, prompts e respostas nunca vão para log, erros devolvidos são genéricos com `correlationId`, e a árvore de processos é encerrada em timeout, falha, `reset` e desligamento.

## Licença
[MIT](LICENSE)
