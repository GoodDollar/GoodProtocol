# OpenClaw prompt pack (GoodProtocol)

This folder contains **plain-text OpenClaw prompts** for the key GoodProtocol actions:
- `claim`
- `save`
- `swap`
- `bridge`
- `stream`
- `create` (whitelist identity)
- `check identity`

Repository note: I could not find an existing OpenClaw configuration in this repo (no `openclaw/`, `claw/`, `agent.yml`, or similar files). So this is a **default prompt layout**:
- Put `openclaw/prompts/system.md` into your agent’s system prompt.
- Put `openclaw/prompts/<action>.md` into the corresponding action prompt/tool description your OpenClaw setup uses.

