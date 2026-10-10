# Conector Claude ⇄ Antigravity

[![CI](https://github.com/tsthas/conector-claude-antigravity/actions/workflows/ci.yml/badge.svg)](https://github.com/tsthas/conector-claude-antigravity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🇧🇷 [Leia em português](README.pt-BR.md)

An MCP server that lets **Claude Code** (or any MCP client) delegate work to **Google Antigravity** (`agy`) and keeps the `agy` process **warm**, one per project.

Calling `agy -p` from scratch costs ~20 s every time, because each call boots a new session. This connector starts `agy` once per project in its streaming mode and reuses it, so follow-up turns come back in about **2 s**.

| Turn | Fresh `agy -p` per call | This connector |
|---|---|---|
| 1st (process starts) | ~23 s | ~20 s |
| 2nd, 3rd, … (same project) | ~23 s each | ~2 s each |

_Measured on one Windows machine with `agy` 1.3.1 and trivial prompts. Real tasks are dominated by model time, so expect a smaller gain._

> **Unofficial.** Not affiliated with or endorsed by Google or Anthropic. The `agy` streaming protocol it relies on is not officially documented (see [docs/PROTOCOL.md](docs/PROTOCOL.md)) and may change between `agy` versions.

## Requirements

- Node.js ≥ 22
- The Antigravity CLI (`agy`) installed, on your `PATH`, and signed in
- An MCP client such as Claude Code

## Install

```bash
git clone https://github.com/tsthas/conector-claude-antigravity.git
cd conector-claude-antigravity
npm install      # also builds, via the "prepare" script
```

Register it with Claude Code (user scope, so it works in every project):

```bash
claude mcp add --scope user antigravity-connector -- node /absolute/path/to/conector-claude-antigravity/dist/index.js
```

The tools then appear as `mcp__antigravity-connector__ask`, `…__reset` and `…__status`. Use any server name you like; it is only a label.

To remove it: `claude mcp remove antigravity-connector`.

## Tools

| Tool | Input | What it does |
|---|---|---|
| `ask` | `prompt`, `cwd` (absolute path), `effort?` (`low`/`medium`/`high`), `timeoutSec?` (5–1800, default 300) | Sends a prompt to the `agy` session of that project, starting it if needed. Returns `response`, `conversationId`, `status`, `reusedSession`, `durationMs`, `correlationId`. |
| `reset` | `cwd` | Stops that project's session; the next `ask` starts a fresh conversation. |
| `status` | – | Lists live sessions. |

`status` values: `SUCCESS`, `ERROR`, `TIMEOUT`, `PERMISSION_DENIED`.

## Permissions (read this)

In streaming mode `agy` **cannot ask for approval**. It auto-denies anything that needs permission and reports it, which this connector surfaces as `PERMISSION_DENIED`. So by default the connector is **read-only**.

To let `agy` write files or run commands, add `permissions.allow` rules to your `agy` settings (for example `write_file(<target>)`). The connector never passes `--dangerously-skip-permissions`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CONECTOR_COMMAND` | `agy` | Executable to launch |
| `CONECTOR_IDLE_MIN` | `15` | Minutes of inactivity before a session is closed |

## How it works

```
MCP client ──stdio──> connector ──stdin NDJSON──> agy (one per cwd)
                               <─stdout NDJSON──
```

- One `agy` process per working directory, turns queued so they never mix.
- Idle sessions are closed after the TTL; the whole process tree is killed on timeout, crash, `reset` and shutdown (no orphans).
- Prompts and responses are **never logged**; errors returned to the client are generic and carry a `correlationId`.
- No network listener (stdio only), no `shell: true`.

## Development

```bash
npm run typecheck
npm test                       # uses a simulated agy (test/fake-agy.mjs), no network
npm run build && node scripts/bench.mjs   # real agy: contract check + benchmark
```

## License

[MIT](LICENSE)
