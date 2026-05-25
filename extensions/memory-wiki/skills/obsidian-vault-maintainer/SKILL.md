---
name: obsidian-vault-maintainer
description: |
  维护 Obsidian 兼容的记忆知识库 vault，支持 wikilinks、frontmatter、Dataview 查询及 Obsidian CLI 集成。当用户说 "Obsidian notes"、"Obsidian笔记"、"vault sync"、"vault同步"、"wikilinks"、"Dataview"、"Obsidian vault"、"知识库同步"、"笔记管理" 时，立即使用此 skill。即使用户没有明确说出 skill 名称，只要意图符合，也应触发。
allowed-tools: ["Bash", "exec"]
---

Use this skill when the memory-wiki vault render mode is `obsidian` or the user wants the wiki to play nicely with Obsidian.

- Start from `openclaw wiki status` to confirm the vault mode and whether the official Obsidian CLI is available.
- Use `openclaw wiki obsidian status` before shelling out, then prefer the dedicated helpers like `openclaw wiki obsidian search`, `openclaw wiki obsidian open`, `openclaw wiki obsidian command`, and `openclaw wiki obsidian daily`.
- Prefer `[[Wikilinks]]`, stable filenames, and frontmatter that works with Obsidian dashboards and Dataview-style queries.
- Keep generated sections deterministic so Obsidian users can safely add handwritten notes around them.
- If the official Obsidian CLI is enabled, probe it before depending on it. Do not assume the app is installed, running, or configured.
- Avoid destructive renames unless you also have a link-repair plan.
