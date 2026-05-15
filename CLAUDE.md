AGENTS.md

# Supervisor Agent — Claude Code Project Context

This is the OpenClaw dev branch with the **Supervisor Agent + Sub-Agents** architecture. See [AGENTS.md](AGENTS.md) for repo-wide rules and policies; this file adds project-specific context for Claude Code sessions.

## Key Directories

- `src/agents/supervisor/` — Supervisor Agent type definitions, manifests, and future runtime logic
- `docs/design/` — 10 design documents (00–09) covering the full architecture
- `src/process/supervisor/` — **Existing** process-level supervisor (ProcessSupervisor, RunState, ManagedRun). NOT the agent-level Supervisor — do not confuse them.

## Naming Conventions

- All Supervisor-agent types use the **`Supervisor` prefix** (e.g. `SupervisorAgentResult`, `SupervisorRawMessage`) to avoid collision with `src/process/supervisor/types.ts` which defines `ProcessSupervisor`, `RunState`, etc.
- Type files use **`export type`** pattern (not `export interface`) — matches `src/agents/auth-profiles/types.ts` convention.

## Code Conventions

- Tests: **vitest**, colocated `*.test.ts` files
- No semicolons, 2-space indentation
- Comments in English, communication in Chinese
- New `AGENTS.md` in a subtree → add sibling `CLAUDE.md` symlink (per root AGENTS.md rule)

## Implementation Phases (from 08-implementation-plan.md)

| Phase | Scope | Status |
|-------|-------|---------|
| 1 | Pure data structures (types, manifests, tests) | **Complete** |
| 2 | ExecutionBoard, ManifestRegistry | Not started |
| 3 | Context Accumulator, Observation Window | Not started |
| 4 | Rule Engine, Intent Classifier | Not started |
| 5 | Interrupt & Withdrawal Handler | Not started |
| 6 | Staged Side Effects, Cross-Domain Auth | Not started |

## Quick Reference

- Design docs: start with `docs/design/00-overview.md`, then `02-architecture.md`
- Sub-Agent manifests: `docs/design/04-sub-agents.md` §2.1–2.4
- Type definitions: `src/agents/supervisor/types.ts` (555 lines, 60+ types)
- Default manifests: `src/agents/supervisor/default-manifests.ts` (4 agents)
- Tests: `src/agents/supervisor/types.test.ts` (60 tests, vitest)

## Git

- Branch: `dev`
- Push target: `woodygreen` remote (`git@github-woodygreen:woodygreen/openclaw.git`)
- `origin` is the openclaw org repo — woodygreen account has no push permission there