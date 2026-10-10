# `agy` streaming protocol (observed)

Not officially documented. Observed with `agy` 1.3.1 by experiment; it may change.

## Launch

```
agy -p= --input-format stream-json --output-format stream-json [--effort low|medium|high]
```

Note the `-p=` form: with a bare `-p` the next flag is consumed as the prompt.

## Input (stdin, one JSON object per line)

```json
{"event":"user","message":{"content":"your prompt"}}
```

`message.content` is required. Other shapes are rejected (`stream input message is missing the "event" field`, `…has no content`). Unknown events are ignored with a warning.

## Output (stdout, one JSON object per line)

| `event` | Meaning |
|---|---|
| `init` | Sent once at start: `conversation_id`, `cwd`, `tools`, `permission_mode`. |
| `step_update` | Progress per step (`user_input`, `tool`, `agent_response`); has `state` (`ACTIVE`, `DONE`, `ERROR`) and `text_delta` for streamed text. |
| `result` | End of a turn: `status`, `response`, `conversation_id`, `usage`, `denied_actions`. |

Example `result`:

```json
{"event":"result","result":{"conversation_id":"…","status":"SUCCESS","response":"OK\n","denied_actions":[{"action":"write_file","display_name":"WriteToFile"}]}}
```

## Permissions

`permission_mode` is `request-review`, but headless streaming **has no approval channel**: a tool that needs permission is auto-denied. The tool step reports a `TOOL_ERROR` (`permission check failed …`), the turn still ends with `status: SUCCESS`, and the denial is listed in `result.denied_actions`. Grant access through `permissions.allow` rules in the agy settings, or (not recommended) `--dangerously-skip-permissions`.

**A denial does not guarantee nothing was written.** In testing, a turn that reported `denied_actions` for `write_file` still ended with the file created (the agent fell back to another tool, or pre-existing grants applied). Always verify side effects independently (e.g. `git diff`). Rule targets are normalized by agy (drive letter stripped, `\` → `/`), so write rules with forward slashes and no drive letter; a rule in the wrong form may not restrict what you expect.

## Timing

Starting `agy` costs ~3.5 s until `init`; the first model turn adds ~15–20 s. Later turns in the same process took ~2–4 s. A new process per call (`--conversation <id>`) pays the full start cost again.
