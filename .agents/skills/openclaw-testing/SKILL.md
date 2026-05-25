---
name: openclaw-testing
description: Use immediately when choosing, running, rerunning, or debugging OpenClaw tests, CI checks, Docker E2E lanes, or release validation. Prove the touched surface first — do not reflexively run the whole suite. Also trigger when user says "run tests", "debug CI", "what should I test", "rerun failed tests", or "validate this change".
allowed-tools:
  - Bash(pnpm test *)
  - Bash(pnpm check *)
  - Bash(pnpm changed:lanes *)
  - Bash(pnpm test:changed *)
  - Bash(pnpm test:docker *)
  - Bash(pnpm test:live *)
  - Bash(pnpm test:install:smoke *)
  - Bash(gh run view *)
  - Bash(gh run list *)
  - Bash(gh workflow run *)
  - Bash(gh api *)
  - Bash(node scripts/*)
  - Bash(npm view *)
  - Bash(npm install *)
  - Bash(docker *)
---

# OpenClaw Testing

Use this skill when deciding what to test, debugging failures, rerunning CI,
or validating a change without wasting hours.

## Read First

- `docs/reference/test.md` for local test commands — read when you need CLI syntax.
- `docs/ci.md` for CI scope, release checks, Docker chunks, and runner behavior — read when debugging CI runs.
- Scoped `AGENTS.md` files before editing code under a subtree.

## Reference Files

- **CI Workflows**: read `references/ci-workflows.md` when dispatching GitHub Actions workflows for release validation, full release checks, or live/E2E proof.
- **Docker E2E**: read `references/docker-e2e.md` when running Docker E2E tests, Package Acceptance workflows, or deriving cheap Docker reruns from failed runs.

## Default Rule

Prove the touched surface first. Do not reflexively run the whole suite.

1. Inspect the diff and classify the touched surface:
   - source: `pnpm changed:lanes --json`, then `pnpm check:changed`
   - tests only: `pnpm test:changed`
   - one failing file: `pnpm test <path-or-filter> -- --reporter=verbose`
   - workflow-only: `git diff --check`, workflow syntax/lint (`actionlint` when available)
   - docs-only: `pnpm docs:list`, docs formatter/lint only if docs tooling changed or requested
2. Reproduce narrowly before fixing.
3. Fix root cause.
4. Rerun the same narrow proof.
5. Broaden only when the touched contract demands it.

## Guardrails

- Do not kill unrelated processes or tests. If something is running elsewhere, treat it as owned by the user or another agent.
- Do not run expensive local Docker, full release checks, full `pnpm test`, or full `pnpm check` unless the user asks or the change genuinely requires it.
- Prefer GitHub Actions for release/Docker proof when the workflow already has the prepared image and secrets.
- Use `scripts/committer "<msg>" <paths...>` when committing; stage only your files.
- If deps are missing, run `pnpm install`, retry once, then report the first actionable error.
- For Blacksmith Testbox proof, use Crabbox first. `pnpm crabbox:run -- --provider
  blacksmith-testbox --timing-json -- <command...>` warms, claims, syncs, runs,
  reports, and cleans up one-shot boxes. Reuse only an id/slug created in this
  operator session; `blacksmith testbox list` is diagnostics only, not a shared
  work queue.

## Local Test Shortcuts

```bash
pnpm changed:lanes --json
pnpm check:changed       # changed typecheck/lint/guards; no Vitest
pnpm test:changed        # cheap smart changed Vitest targets
OPENCLAW_TEST_CHANGED_BROAD=1 pnpm test:changed
pnpm test <path-or-filter> -- --reporter=verbose
OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test <path-or-filter>
```

Use targeted file paths whenever possible. Avoid raw `vitest`; use the repo
`pnpm test` wrapper so project routing, workers, and setup stay correct.

## Command Semantics

- `pnpm check` and `pnpm check:changed` do not run Vitest tests. They are for
  typecheck, lint, and guard proof.
- `pnpm test` and `pnpm test:changed` run Vitest tests.
- `pnpm test:changed` is intentionally cheap by default: direct test edits,
  sibling tests, explicit source mappings, and import-graph dependents.
- `OPENCLAW_TEST_CHANGED_BROAD=1 pnpm test:changed` is the explicit broad
  fallback for harness/config/package edits that genuinely need it.
- Do not run extension sweeps just because core changed. If a core edit is for a
  specific plugin bug, run that plugin's tests explicitly. If a public SDK or
  contract change needs consumer proof, choose the smallest representative
  plugin/contract tests first, then broaden only when the risk justifies it.
- The test wrapper prints a short `[test] passed|failed|skipped ... in ...`
  line. Vitest's own duration is still the per-shard detail.

## Routing Model

- `pnpm changed:lanes --json` answers "which check lanes does this diff touch?"
  It is used by `pnpm check:changed` for typecheck/lint/guard selection.
- `pnpm test:changed` answers "which Vitest targets are worth running now?" It
  uses the same changed path list, but applies a cheaper test-target resolver.
- Direct test edits run themselves. Source edits prefer explicit mappings,
  sibling `*.test.ts`, then import-graph dependents. Shared harness/config/root
  edits are skipped by default unless they have precise mapped tests.
- Shared group-room delivery config and source-reply prompt edits are precise
  mapped tests: they run the core auto-reply regressions plus Discord and Slack
  delivery tests so cross-channel default changes fail before a PR push.
- Public SDK or contract edits do not automatically run every plugin test.
  `check:changed` proves extension type contracts; the agent chooses the
  smallest plugin/contract Vitest proof that matches the actual risk.
- Use `OPENCLAW_TEST_CHANGED_BROAD=1 pnpm test:changed` only when a harness,
  config, package, or unknown-root edit really needs the broad Vitest fallback.

## CI Debugging

Start with current run state, not logs for everything:

```bash
gh run list --branch main --limit 10
gh run view <run-id> --json status,conclusion,headSha,url,jobs
gh run view <run-id> --job <job-id> --log
```

- Check exact SHA. Ignore newer unrelated `main` unless asked.
- For cancelled same-branch runs, confirm whether a newer run superseded it.
- Fetch full logs only for failed or relevant jobs.

## Failure Workflow

1. Identify exact failing job, SHA, lane, and artifact path.
2. Read `failures.json`, `summary.json`, and the failed lane log tail.
3. Use `pnpm test:docker:rerun <run-id|failures.json>` to generate targeted
   GitHub rerun commands.
4. If the lane has `rerunCommand`, use that only as a local starting point.
5. For Docker release failures, dispatch targeted `docker_lanes=<failed-lane>`
   on GitHub before considering local Docker.
6. Patch narrowly, then rerun the failed file/lane only.
7. Broaden to `pnpm check:changed` or CI only after the isolated proof passes.

## OpenAI Interface

This skill has an OpenAI-compatible agent interface at `agents/openai.yaml`. It provides a default prompt for choosing the cheapest safe test path. Read it when integrating with OpenAI-compatible agent toolchains.

## When To Escalate

- Public SDK/plugin contract changes: run changed gate plus relevant extension
  validation.
- Build output, lazy imports, package boundaries, or published surfaces:
  include `pnpm build`.
- Workflow edits: run `pnpm check:workflows`.
- Release branch or tag validation: use release docs and GitHub workflows; avoid
  local Docker unless Peter explicitly asks.