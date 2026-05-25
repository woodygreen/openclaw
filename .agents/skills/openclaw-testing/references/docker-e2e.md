# Docker, Package Acceptance, and Reruns Reference

Read this file when running Docker E2E tests, Package Acceptance workflows, or deriving cheap Docker reruns from failed runs.

## Docker

Docker is expensive. First inspect the scheduler without running Docker:

```bash
OPENCLAW_DOCKER_ALL_DRY_RUN=1 pnpm test:docker:all
OPENCLAW_DOCKER_ALL_DRY_RUN=1 OPENCLAW_DOCKER_ALL_LANES=install-e2e pnpm test:docker:all
OPENCLAW_DOCKER_ALL_LANES=install-e2e node scripts/test-docker-all.mjs --plan-json
```

Run one failed lane locally only when explicitly asked or when GitHub is not
usable:

```bash
OPENCLAW_DOCKER_ALL_LANES=<lane> \
OPENCLAW_DOCKER_ALL_BUILD=0 \
OPENCLAW_DOCKER_ALL_PREFLIGHT=0 \
OPENCLAW_SKIP_DOCKER_BUILD=1 \
OPENCLAW_DOCKER_E2E_BARE_IMAGE='<prepared-bare-image>' \
OPENCLAW_DOCKER_E2E_FUNCTIONAL_IMAGE='<prepared-functional-image>' \
pnpm test:docker:all
```

For release validation, prefer the reusable GitHub workflow input:

```yaml
docker_lanes: install-e2e
```

Multiple lanes are allowed:

```yaml
docker_lanes: install-e2e bundled-channel-update-acpx
```

That skips the release chunk matrix and runs one targeted Docker job against the
prepared GHCR images and the selected package artifact. Rerun commands
generated inside GitHub artifacts include `package_artifact_run_id`,
`package_artifact_name`, `docker_e2e_bare_image`, and
`docker_e2e_functional_image` when available, so failed lanes can reuse the
exact tarball and prepared images from the failed run. When the fix changes
package contents, omit those reuse inputs so the workflow packs a new tarball.
Live-only targeted reruns skip the E2E images and build only the live-test
image. Release-path normal mode fans out into smaller Docker chunk jobs:

- `core`
- `package-update-openai`
- `package-update-anthropic`
- `package-update-core`
- `plugins-runtime-plugins`
- `plugins-runtime-services`
- `plugins-runtime-install-a`
- `plugins-runtime-install-b`
- `plugins-runtime-install-c`
- `plugins-runtime-install-d`
- `bundled-channels`

OpenWebUI is folded into `plugins-runtime-services` for full release-path
coverage and keeps a standalone `openwebui` chunk only for OpenWebUI-only
dispatches. The legacy `package-update`, `plugins-runtime-core`,
`plugins-runtime`, and `plugins-integrations` chunks still work as aggregate
aliases for manual reruns, but the release workflow uses the split chunks so
provider installer checks, plugin runtime checks, bundled plugin
install/uninstall shards, and bundled-channel checks can run on separate
machines. The bundled-channel runtime-dependency coverage
inside `bundled-channels`
uses the split `bundled-channel-*` and `bundled-channel-update-*` lanes rather
than the serial `bundled-channel-deps` lane, so failures produce cheap targeted
reruns for the exact channel/update scenario. The bundled plugin
install/uninstall sweep is also split into
`bundled-plugin-install-uninstall-0` through
`bundled-plugin-install-uninstall-7`; selecting the legacy
`bundled-plugin-install-uninstall` lane expands to all eight shards.

## Package Acceptance

Use the manual `Package Acceptance` workflow when the question is "does this
installable package work as a product?" rather than "does this source diff pass
Vitest?"

In release validation, treat Package Acceptance as the package-candidate shard
inside the larger release umbrella, not as a competing full-test path. Full
Release Validation and private release gauntlets should call Package Acceptance
for tarball resolution, Docker product/package proof, and optional Telegram QA
against the same resolved `package-under-test` artifact; keep orchestration,
secret policy, blocking/advisory status, and evidence rollup in the caller.

Good defaults:

```bash
gh workflow run package-acceptance.yml --ref main \
  -f source=npm \
  -f workflow_ref=main \
  -f package_spec=openclaw@beta \
  -f suite_profile=product \
  -f telegram_mode=mock-openai
```

Npm candidate selection:

- Resolve the registry immediately before dispatch:
  `npm view openclaw dist-tags --json --prefer-online --cache /tmp/openclaw-npm-cache-verify-$$`
  and `npm view openclaw@beta version dist.tarball dist.integrity --json --prefer-online --cache /tmp/openclaw-npm-cache-verify-$$`.
- If Peter asks for "latest beta", use `source=npm` with
  `package_spec=openclaw@beta`, then record the resolved version from `npm view`
  or the workflow summary.
- For reruns, release proof, or comparing one known package, prefer the exact
  immutable spec: `package_spec=openclaw@YYYY.M.D-beta.N` or
  `package_spec=openclaw@YYYY.M.D`.
- For stable package proof, use `package_spec=openclaw@latest` only when the
  question is explicitly the current stable dist-tag; otherwise pin the exact
  version.
- `source=npm` only accepts registry specs for `openclaw@beta`,
  `openclaw@latest`, or exact OpenClaw release versions. Do not pass semver
  ranges, git refs, file paths, tarball URLs, or plugin package names there.
- If the candidate is a tarball URL, use `source=url` with `package_sha256`. If
  it is an Actions tarball artifact, use `source=artifact`. If it is an
  unpublished source candidate, use `source=ref` with a trusted ref or SHA.
- Package acceptance tests exactly the selected package candidate. Do not apply
  `openclaw update --channel beta` fallback semantics here; if `beta` is absent,
  stale, older than `latest`, or points at a broken tarball, report that tag
  state instead of silently testing `latest`.

Profiles:

- `smoke`: quick confidence that the tarball installs, can onboard a channel,
  can run an agent turn, and basic gateway/config lanes work.
- `package`: release-package contract. Adds installer/update, doctor install
  switching, bundled plugin runtime deps, plugin install/update, and package
  repair lanes. This is the default native replacement for most Parallels
  package/update coverage.
- `product`: package profile plus broader product surfaces: MCP channels,
  cron/subagent cleanup, OpenAI web search, and OpenWebUI.
- `full`: split Docker release-path chunks with OpenWebUI.
- `custom`: exact `docker_lanes` list for a focused rerun.

Candidate sources:

- `source=npm`: `openclaw@beta`, `openclaw@latest`, or an exact release version.
- `source=ref`: pack `package_ref` using the trusted `workflow_ref` harness.
  This intentionally separates old package commits from new workflow/test code.
- `source=url`: HTTPS `.tgz` plus required `package_sha256`.
- `source=artifact`: download one `.tgz` from `artifact_run_id`/`artifact_name`.

Ref model:

- `gh workflow run ... --ref <workflow-ref>` selects the workflow file revision
  GitHub executes.
- `workflow_ref` is the trusted harness/script ref passed to reusable Docker
  E2E.
- `package_ref` is the source ref to build when `source=ref`. It can be an
  older branch/tag/SHA as long as it is reachable from an OpenClaw branch or
  release tag.

Example: run latest package acceptance harness against an older trusted commit:

```bash
gh workflow run package-acceptance.yml --ref main \
  -f workflow_ref=main \
  -f source=ref \
  -f package_ref=<branch-or-sha> \
  -f suite_profile=package \
  -f telegram_mode=mock-openai
```

Use `telegram_mode=mock-openai` or `telegram_mode=live-frontier` when the same
resolved `package-under-test` tarball should also run through the Telegram QA
workflow in the `qa-live-shared` environment. The standalone Telegram workflow
still accepts a published npm spec for post-publish checks, but Package
Acceptance passes the resolved artifact for `source=npm`, `ref`, `url`, and
`artifact`. Use `telegram_mode=none` only when intentionally skipping Telegram
credentialed package proof for a focused rerun.

Docker E2E images never copy repo sources as the app under test: the bare image
is a Node/Git runner, and the functional image installs the same prebuilt npm
tarball that bare lanes mount. `scripts/package-openclaw-for-docker.mjs` is the
single packer for local scripts and CI and validates the tarball inventory
before Docker consumes it. `scripts/test-docker-all.mjs --plan-json` is the
scheduler-owned CI plan for image kind, package, live image, lane, and
credential needs. Docker lane definitions live in the single scenario catalog
`scripts/lib/docker-e2e-scenarios.mjs`; planner logic lives in
`scripts/lib/docker-e2e-plan.mjs`. `scripts/docker-e2e.mjs` converts plan and
summary JSON into GitHub outputs and step summaries. Every scheduler run writes
`.artifacts/docker-tests/**/summary.json` plus `failures.json`. Read those
before rerunning. Lane entries include `command`, `rerunCommand`, status,
timing, timeout state, image kind, and log file path. The summary also includes
top-level phase timings for preflight, image build, package prep, lane pools,
and cleanup. Use `pnpm test:docker:timings <summary.json>` to rank slow lanes
and phases before deciding whether a broader rerun is justified.

Skill install proof: use `pnpm test:docker:skill-install` or targeted
`docker_lanes=skill-install` for live ClawHub skill-install validation. The
lane installs the package tarball in a bare runner, keeps
`skills.install.allowUploadedArchives=false`, resolves the current live slug
from `openclaw skills search`, installs it, and verifies `.clawhub` origin/lock
metadata. Prefer this checked-in script over inline heredoc Testbox recipes.

## Cheap Docker Reruns

First derive the smallest rerun command from artifacts:

```bash
pnpm test:docker:rerun <github-run-id>
pnpm test:docker:rerun .artifacts/docker-tests/<run>/failures.json
```

The script downloads Docker E2E artifacts for a GitHub run, reads
`summary.json`/`failures.json`, and prints a combined targeted workflow command
plus per-lane commands. Prefer the combined targeted command when several lanes
failed for the same patch:

```bash
gh workflow run openclaw-live-and-e2e-checks-reusable.yml \
  -f ref=<sha> \
  -f include_repo_e2e=false \
  -f include_release_path_suites=false \
  -f include_openwebui=false \
  -f docker_lanes='install-e2e bundled-channel-update-acpx' \
  -f include_live_suites=false \
  -f live_models_only=false
```

That path still runs the prepare job, so it creates a new tarball for `<sha>`.
If the SHA-tagged GHCR bare/functional image already exists, CI skips rebuilding
that image and only uploads the fresh package artifact before the targeted lane
job. Do not rerun the full release path unless the failed lane list
or touched surface really requires it.

## Docker Expected Timings

Treat these as ballpark. Blacksmith queue time, GHCR pull speed, provider
latency, npm cache state, and Docker daemon health can dominate.

Current local timing artifact (`.artifacts/docker-tests/lane-timings.json`) has
these rough bands:

- Tiny lanes, seconds to under 1 minute:
  `agents-delete-shared-workspace` ~3s, `plugin-update` ~7s,
  `config-reload` ~14s, `pi-bundle-mcp-tools` ~15s, `onboard` ~18s,
  `session-runtime-context` ~20s, `gateway-network` ~34s, `qr` ~44s.
- Medium deterministic lanes, ~1-5 minutes:
  `npm-onboard-channel-agent` ~96s, `openai-image-auth` ~99s,
  bundled channel/update lanes usually ~90-300s when split, `openwebui` ~225s,
  `mcp-channels` ~274s.
- Heavy deterministic lanes, ~6-10 minutes:
  `bundled-channel-root-owned` ~429s,
  `bundled-channel-setup-entry` ~420s,
  `bundled-channel-load-failure` ~383s,
  `cron-mcp-cleanup` ~567s.
- Live provider lanes, often ~15-20 minutes:
  `live-gateway` ~958s, `live-models` ~1054s.
- Installer/release lanes:
  `install-e2e` and package-update paths can vary widely with npm, provider,
  and package registry behavior. Budget tens of minutes; prefer GitHub targeted
  reruns over local repeats.

Default fallback lane timeout is 120 minutes. A timeout usually means debug the
lane log/artifacts first, not "run the whole thing again."