---
name: acp-router
description: |
  将自然语言请求路由到对应 ACP 编码助手（Pi/Claude Code/Cursor/Copilot/OpenClaw/OpenCode/Gemini/Qwen/Kiro/Kimi/iFlow/Droid/Kilocode）的 ACP runtime 或 acpx 直连会话。当用户说 "run in Pi"、"在Pi中运行"、"用 Claude Code"、"帮我用Claude Code跑"、"让 Cursor 做一下"、"编码助手"、"spawn coding agent"、"spawn编码agent"、"ACP harness"、"ACP路由"、"acpx session" 时，立即使用此 skill。即使用户没有明确说出 skill 名称，只要意图符合，也应触发。编码线程创建必须先读此 skill，然后只用 `sessions_spawn`。
user-invocable: false
allowed-tools: ["Bash", "exec"]
---

# ACP Harness Router

When user intent is "run this in Pi/Claude Code/Cursor/Copilot/OpenClaw/OpenCode/Gemini/Qwen/Kiro/Kimi/iFlow/Droid/Kilocode (ACP harness)", do not use subagent runtime or PTY scraping. Route through ACP-aware flows.

Codex is special: plain chat/conversation binding and control should use the native Codex app-server plugin (`/codex bind`, `/codex threads`, `/codex resume`) instead of the default ACP path. Use ACP for Codex only when the user explicitly names ACP/`/acp`/acpx, or when spawning background child sessions through `sessions_spawn` where a native Codex runtime spawn is not available yet.

## Intent detection

Trigger this skill when the user asks OpenClaw to:

- run something in Pi / Claude Code / Cursor / Copilot / OpenClaw / OpenCode / Gemini / Qwen / Kiro / Kimi / iFlow / Droid / Kilocode
- run Codex explicitly through ACP, `/acp`, or acpx
- continue existing harness work
- relay instructions to an external coding harness
- keep an external harness conversation in a thread-like conversation

Preflight for coding-agent thread requests (reading this skill first ensures `sessions_spawn` is used correctly and avoids subagent runtime misrouting):

- Before creating any thread for ACP harness work, read this skill first in the same turn.
- After reading, follow `OpenClaw ACP runtime path` below; do not use `message(action="thread-create")` for ACP harness thread spawn.

## Mode selection

Choose one of these paths:

1. OpenClaw ACP runtime path (default): use `sessions_spawn` / ACP runtime tools.
2. Direct `acpx` path (telephone game): use `acpx` CLI through `exec` to drive the harness session directly.

Use direct `acpx` when one of these is true:

- user explicitly asks for direct `acpx` driving
- ACP runtime/plugin path is unavailable or unhealthy
- the task is "just relay prompts to harness" and no OpenClaw ACP lifecycle features are needed

Do not use:

- `subagents` runtime for harness control — `sessions_spawn` provides proper ACP lifecycle management, including session tracking and error propagation
- `/acp` command delegation as a requirement for the user — the skill should route directly without forcing the user into a separate command step
- PTY scraping of supported ACP harness CLIs when `acpx` is available — `acpx` offers structured session management and output parsing that PTY scraping cannot replicate

## AgentId mapping

Use these defaults when user names a harness directly:

- "pi" -> `agentId: "pi"`
- "openclaw" -> `agentId: "openclaw"`
- "claude" or "claude code" -> `agentId: "claude"`
- "codex" -> `agentId: "codex"` only for explicit ACP/acpx requests or background ACP runtime spawn
- "copilot" or "github copilot" -> `agentId: "copilot"`
- "cursor" or "cursor cli" -> `agentId: "cursor"`
- "droid" or "factory droid" -> `agentId: "droid"`
- "opencode" -> `agentId: "opencode"`
- "gemini" or "gemini cli" -> `agentId: "gemini"`
- "iflow" -> `agentId: "iflow"`
- "kilocode" -> `agentId: "kilocode"`
- "kimi" or "kimi cli" -> `agentId: "kimi"`
- "kiro" or "kiro cli" -> `agentId: "kiro"`
- "qwen" or "qwen code" -> `agentId: "qwen"`

These defaults match current acpx built-in aliases.

If policy rejects the chosen id, report the policy error clearly and ask for the allowed ACP agent id.

## OpenClaw ACP runtime path

Required behavior:

1. For ACP harness thread spawn requests, read this skill first in the same turn before calling tools.
2. Use `sessions_spawn` with:
   - `runtime: "acp"`
   - `thread: true`
   - `mode: "session"` (unless user explicitly wants one-shot)
3. For ACP harness thread creation, do not use `message` with `action=thread-create`; `sessions_spawn` is the only thread-create path.
4. Put requested work in `task` so the ACP session gets it immediately.
5. Set `agentId` explicitly unless ACP default agent is known.
6. Do not ask user to run slash commands or CLI when this path works directly.

Example:

User: "spawn a test codex ACP session in thread and tell it to say hi"

Call:

```json
{
  "task": "Say hi.",
  "runtime": "acp",
  "agentId": "codex",
  "thread": true,
  "mode": "session"
}
```

## Thread spawn recovery policy

When the user asks to start a coding harness in a thread, treat that as an ACP runtime request and try to satisfy it end-to-end.

Required behavior when ACP backend is unavailable:

1. Do not immediately ask the user to pick an alternate path.
2. First attempt automatic local repair:
   - ensure plugin-local pinned acpx is installed in the ACPX plugin package
   - verify `${ACPX_CMD} --version`
3. After reinstall/repair, restart the gateway and explicitly offer to run that restart for the user.
4. Retry ACP thread spawn once after repair.
5. Only if repair+retry fails, report the concrete error and then offer fallback options.

When offering fallback, keep ACP first:

- Option 1: retry ACP spawn after showing exact failing step
- Option 2: direct acpx telephone-game flow

Do not default to subagent runtime for these requests — ACP lifecycle tracking is lost under subagent, which breaks thread continuity and error propagation.

## ACPX install and version policy (direct acpx path)

For this repo, direct `acpx` calls must follow the same pinned policy as the `@openclaw/acpx` extension package.

1. Prefer plugin-local binary, not global PATH:
   - `${ACPX_PLUGIN_ROOT}/node_modules/.bin/acpx`
2. Resolve pinned version from extension dependency:
   - `node -e "console.log(require(process.env.ACPX_PLUGIN_ROOT + '/package.json').dependencies.acpx)"`
3. If binary is missing or version mismatched, install plugin-local pinned version:
   - `cd "$ACPX_PLUGIN_ROOT" && npm install --omit=dev --no-save acpx@<pinnedVersion>`
4. Verify before use:
   - `${ACPX_PLUGIN_ROOT}/node_modules/.bin/acpx --version`
5. If install/repair changed ACPX artifacts, restart the gateway and offer to run the restart.
6. Do not run `npm install -g acpx` unless the user explicitly asks for global install.

Set and reuse:

```bash
ACPX_PLUGIN_ROOT="<bundled-acpx-plugin-root>"
ACPX_CMD="$ACPX_PLUGIN_ROOT/node_modules/.bin/acpx"
```

## Direct acpx path ("telephone game")

Use this path to drive harness sessions without `/acp` or subagent runtime.

### Rules

1. Use `exec` commands that call `${ACPX_CMD}`.
2. Reuse a stable session name per conversation so follow-up prompts stay in the same harness context.
3. Prefer `--format quiet` for clean assistant text to relay back to user.
4. Use `exec` (one-shot) only when the user wants one-shot behavior.
5. Keep working directory explicit (`--cwd`) when task scope depends on repo context.

### Session naming

Use a deterministic name, for example:

- `oc-<harness>-<conversationId>`

Where `conversationId` is thread id when available, otherwise channel/conversation id.

### Command templates

Persistent session (create if missing, then prompt):

```bash
${ACPX_CMD} codex sessions show oc-codex-<conversationId> \
  || ${ACPX_CMD} codex sessions new --name oc-codex-<conversationId>

${ACPX_CMD} codex -s oc-codex-<conversationId> --cwd <workspacePath> --format quiet "<prompt>"
```

One-shot:

```bash
${ACPX_CMD} codex exec --cwd <workspacePath> --format quiet "<prompt>"
```

Cancel in-flight turn:

```bash
${ACPX_CMD} codex cancel -s oc-codex-<conversationId>
```

Close session:

```bash
${ACPX_CMD} codex sessions close oc-codex-<conversationId>
```

### Harness aliases in acpx

- `claude`
- `codex`
- `copilot`
- `cursor`
- `droid`
- `gemini`
- `iflow`
- `kilocode`
- `kimi`
- `kiro`
- `openclaw`
- `opencode`
- `pi`
- `qwen`

### Built-in adapter commands in acpx

Defaults are:

- `openclaw -> openclaw acp`
- `claude -> bundled @agentclientprotocol/claude-agent-acp@0.32.0`
- `codex -> bundled @zed-industries/codex-acp@0.13.0 through OpenClaw's isolated CODEX_HOME wrapper`
- `copilot -> copilot --acp --stdio`
- `cursor -> cursor-agent acp`
- `droid -> droid exec --output-format acp`
- `gemini -> gemini --acp`
- `iflow -> iflow --experimental-acp`
- `kilocode -> npx -y @kilocode/cli acp`
- `kimi -> kimi acp`
- `kiro -> kiro-cli acp`
- `opencode -> npx -y opencode-ai acp`
- `pi -> npx pi-acp@^0.0.22`
- `qwen -> qwen --acp`

If `~/.acpx/config.json` overrides `agents`, those overrides replace defaults.
If your local Cursor install still exposes ACP as `agent acp`, set that as the `cursor` agent override explicitly.

### Failure handling

- `acpx: command not found`:
  - for thread-spawn ACP requests, install plugin-local pinned acpx in the ACPX plugin package immediately
  - restart gateway after install and offer to run the restart automatically
  - then retry once
  - do not ask for install permission first unless policy explicitly requires it — proactively repair instead of blocking the user
  - do not install global `acpx` unless explicitly requested
- adapter command missing (for example `claude-agent-acp` not found):
  - for thread-spawn ACP requests, first restore built-in defaults by removing broken `~/.acpx/config.json` agent overrides
  - then retry once before offering fallback
  - if user wants binary-based overrides, install exactly the configured adapter binary
- `NO_SESSION`: run `${ACPX_CMD} <agent> sessions new --name <sessionName>` then retry prompt.
- queue busy: either wait for completion (default) or use `--no-wait` when async behavior is explicitly desired.

### Output relay

When relaying to user, return the final assistant text output from `acpx` command result. Avoid relaying raw local tool noise unless user asked for verbose logs.
