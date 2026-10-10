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
No modo de streaming o `agy` **não consegue pedir aprovação**: ele nega sozinho o que exigir permissão, e o conector devolve `PERMISSION_DENIED`. Por padrão, portanto, o conector **só lê**. Para liberar escrita ou comandos, crie regras `permissions.allow` nas configurações do `agy`. O conector nunca usa `--dangerously-skip-permissions`.

## Segurança
Sem porta de rede (só stdio), sem `shell: true`, prompts e respostas nunca vão para log, erros devolvidos são genéricos com `correlationId`, e a árvore de processos é encerrada em timeout, falha, `reset` e desligamento.

## Licença
[MIT](LICENSE)
