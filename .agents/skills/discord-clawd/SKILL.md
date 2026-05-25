---
name: discord-clawd
description: "Use immediately when you need to message maintainers, ping Discord, or route an ask through the OpenClaw session — triggers on 'talk to Discord', 'ping maintainers', 'send to Discord', 'ask the agent', 'message the team'."
allowed-tools:
  - Bash(python3 *)
---

# Discord Clawd

Use this when the task is to talk with the Discord-backed agent/session, ask it a question, or post through that route.

For Discord archive/history/search, use `$discrawl` instead.

## Transport

Use the OpenClaw relay helper:

```bash
cd ~/Projects/agent-scripts
python3 skills/openclaw-relay/scripts/openclaw_relay.py targets
python3 skills/openclaw-relay/scripts/openclaw_relay.py resolve --target maintainers
```

If the target alias exists, prefer a private ask first to avoid spamming public channels without confirmation:

```bash
python3 skills/openclaw-relay/scripts/openclaw_relay.py ask \
  --target maintainers \
  --message "Reply with exactly OK."
```

Use `publish` when the session should decide whether to post. Use `force-send` only when the user explicitly wants a message posted.

## Guardrails

- Resolve the target before sending real content.
- Report the target and delivery mode used.
- Do not use this for local Discord archive queries — use $discrawl for archive/history/search, which has dedicated read-only Discord access with rate-limit handling and message indexing.
- Do not expose gateway tokens or session secrets — gateway tokens grant full session control; leaking them in logs or messages enables unauthorized impersonation of the agent session.

## OpenAI Interface

`agents/openai.yaml` defines an OpenAI-compatible agent interface with a `display_name`, `short_description`, and `default_prompt`. Read `agents/openai.yaml` when integrating with an OpenAI-compatible agent orchestrator or when the external dispatch protocol needs the default prompt for routing asks through the Discord-backed session. External orchestrators using the OpenAI agent protocol can invoke this skill through that interface to route a private ask or explicit post through the Discord-backed session.
