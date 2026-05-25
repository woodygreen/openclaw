---
name: wiki-maintainer
description: |
  维护 OpenClaw 记忆知识库 vault，提供确定性页面生成、受控块管理、来源追溯更新及 wiki_lint 校验。当用户说 "memory wiki"、"更新知识库"、"update wiki page"、"wiki search"、"搜索wiki"、"wiki lint"、"知识库维护"、"vault maintenance"、"记忆库" 时，立即使用此 skill。即使用户没有明确说出 skill 名称，只要意图符合，也应触发。
allowed-tools: ["Bash", "exec"]
---

Use this skill when working inside a memory-wiki vault. When the vault render mode is `obsidian`, prefer the `obsidian-vault-maintainer` skill instead.

- Prefer `wiki_status` first when you need to understand the vault mode, path, or Obsidian CLI availability.
- Prefer `memory_search` with `corpus=all` when the shared memory tools are available and you want one recall pass across durable memory plus the compiled wiki.
- Use `wiki_search` to discover candidate pages when you want wiki-specific ranking/provenance, then `wiki_get` to inspect the exact page before editing or citing it.
- Use `wiki_apply` for narrow synthesis filing and metadata updates when a tool-level mutation is enough.
- Run `wiki_lint` after meaningful wiki updates so contradictions, provenance gaps, and open questions get surfaced before you trust the vault.
- Use `openclaw wiki ingest`, `openclaw wiki compile`, and `openclaw wiki lint` as the default maintenance loop.
- In `bridge` mode, run `openclaw wiki bridge import` before relying on search results if you need the latest public memory artifacts pulled in.
- In `unsafe-local` mode, use `openclaw wiki unsafe-local import` only when the user explicitly opted into private local path access.
- Keep generated sections inside managed markers. Do not overwrite human note blocks.
- Treat raw sources, memory artifacts, and daily notes as evidence. Do not let wiki pages become the only source of truth for new claims.
- Keep page identity stable. Favor updating existing entities and concepts over spawning duplicates with slightly different names.
- When creating or refreshing indexes, preserve Obsidian-friendly wikilinks if the vault render mode is `obsidian`.
