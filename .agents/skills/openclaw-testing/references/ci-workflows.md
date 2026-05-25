# CI Workflows Reference

Read this file when dispatching GitHub Actions workflows for release validation, full release checks, or live/E2E proof.

## GitHub Release Workflows

Use the smallest workflow that proves the current risk. The full umbrella is
available, but it is usually the last step after narrower proof, not the first
rerun after a focused patch.

### Full Release Validation

`Full Release Validation` (`.github/workflows/full-release-validation.yml`) is
the manual "everything before release" umbrella. It resolves a target ref, then
dispatches:

- manual `CI` for the full normal CI graph, with Android enabled via
  `include_android=true`
- `Plugin Prerelease` for release-only plugin static checks, extension shards,
  the release-only `agentic-plugins` shard, and plugin product Docker lanes
- `OpenClaw Release Checks` for install smoke, cross-OS release checks, live and
  E2E checks, Docker release-path suites, OpenWebUI, QA Lab, fast Matrix, and
  Telegram release lanes
- optional post-publish Telegram E2E when a package spec is supplied

Run it only when validating an actual release candidate, after broad shared CI
or release orchestration changes, or when explicitly asked:

```bash
gh workflow run full-release-validation.yml \
  --repo openclaw/openclaw \
  --ref main \
  -f ref=<branch-or-sha> \
  -f provider=openai \
  -f mode=both \
  -f release_profile=stable
```

Run the workflow itself from the trusted current ref, normally `--ref main`;
child workflows are dispatched from that same ref even when `ref` points at an
older release branch or tag. Full Release Validation has no separate child
workflow ref input; choose the trusted harness by choosing the workflow run ref.
Use `release_profile=minimum|stable|full` to control live/provider breadth:
`minimum` keeps the fastest OpenAI/core release-critical set, `stable` adds the
stable provider/backend set, and `full` adds the broad advisory provider/media
matrix. Do not make `full` faster by silently dropping suites; optimize setup,
artifact reuse, and sharding instead. The parent verifier job appends a child
overview plus slowest-job tables for child runs; rerun only that verifier after
a child rerun turns green.

Standalone manual `CI` dispatches do not run the plugin prerelease suite, the
extension batch sweep, or the release-only `agentic-plugins` Vitest shard. Those
lanes are intentionally reserved for the separate `Plugin Prerelease` child so
PRs, main pushes, and ad hoc broad CI checks do not spend Docker/package time or
all-plugin runtime time on release-only product coverage.

If a full run is already active on a newer `origin/main`, prefer watching that
run over dispatching a duplicate. Do not cancel release, release-check, or child
workflow runs unless Peter explicitly asks for cancellation.

The child-dispatch jobs record the child run ids. The final
`Verify full validation` job re-queries those child runs and is the canonical
parent gate. If a child workflow failed but was later rerun successfully, rerun
only the failed parent verifier job; do not dispatch a new full umbrella unless
the release evidence is stale.

For bounded recovery after a focused fix, pass `-f rerun_group=<group>`.
Supported umbrella groups are `all`, `ci`, `plugin-prerelease`,
`release-checks`, `install-smoke`, `cross-os`, `live-e2e`, `package`, `qa`,
`qa-parity`, `qa-live`, and `npm-telegram`. Use the narrowest group that covers
the failed box. After a targeted release-check fix, do not restart the full
umbrella by habit: dispatch the matching `rerun_group` and rerun only the parent
verifier/evidence step after the child is green unless the release evidence is
stale. For a single failed live/E2E shard, use
`-f rerun_group=live-e2e -f live_suite_filter=<suite_id>` so the Blacksmith
workflow only spends setup and queue time on that suite.

### Release Evidence

After release-candidate validation or before a release decision, record the
important run ids in the private `openclaw/releases-private` evidence ledger.
Use the manual `OpenClaw Release Evidence`
(`openclaw-release-evidence.yml`) workflow there. It writes durable summaries
under `evidence/<release-id>/` and commits:

- `release-evidence.md`
- `release-evidence.json`
- `index.json`
- `runs/<label>.json`

Use one run per line:

```text
full-release-validation openclaw/openclaw <run-id> blocking
package-acceptance openclaw/openclaw <run-id> blocking
release-checks openclaw/openclaw <run-id> blocking
```

Store summaries, run URLs, artifact metadata, timings, pass/fail state, and
short release-manager notes there. Do not store raw logs, provider
prompts/responses, channel transcripts, signing material, or secret-bearing
config in git; raw logs stay in Actions artifacts.

When `Full Release Validation` completes and
`OPENCLAW_RELEASES_PRIVATE_DISPATCH_TOKEN` is configured in the public repo, it
requests the private `OpenClaw Release Evidence From Full Validation` workflow.
That private workflow reads the parent full-validation run, extracts the child
CI/release-checks/Telegram run ids from the parent logs, and opens the evidence
PR automatically. If the token is absent or the run predates this wiring, trigger
that private workflow manually with the full-validation run id.

### Release Checks

`OpenClaw Release Checks` (`openclaw-release-checks.yml`) is the release child
workflow. It is broader than normal CI but narrower than the umbrella because it
does not dispatch the separate full normal CI child. It runs Package Acceptance
with artifact-native delta lanes and `telegram_mode=mock-openai`, so the release
package tarball also goes through offline plugin proof, bundled-channel compat,
and Telegram package QA. The Docker release-path chunks cover the overlapping
package/update/plugin lanes. Use it when release-path validation is needed
without rerunning the entire umbrella.

```bash
gh workflow run openclaw-release-checks.yml \
  --repo openclaw/openclaw \
  --ref main \
  -f ref=<branch-or-sha> \
  -f provider=openai \
  -f mode=both \
  -f release_profile=stable \
  -f rerun_group=all
```

Release-check rerun groups are `all`, `install-smoke`, `cross-os`, `live-e2e`,
`package`, `qa`, `qa-parity`, and `qa-live`.
`OpenClaw Release Checks` uses the trusted workflow ref to resolve the selected
ref once as `release-package-under-test` and passes that artifact into cross-OS
release checks, release-path Docker live/E2E checks, and Package Acceptance.
When `Full Release Validation` dispatches release checks, it passes the requested
branch/tag plus an `expected_sha` so branch/tag refs resolve through the fast
remote-ref path while the package and QA jobs still validate the exact SHA.

The full install-smoke child is split on purpose: one job prepares or reuses the
target-SHA GHCR root Dockerfile smoke image, QR package install runs in its own
job, root Dockerfile/gateway smokes pull the prepared image, and installer/Bun
smokes pull the same image while building only their small installer images.
If install-smoke gets slow again, first check whether the root image was reused
or rebuilt before adding/removing coverage.

The full-profile native live media shards use the prebuilt
`ghcr.io/openclaw/openclaw-live-media-runner:ubuntu-24.04` container so
`ffmpeg`/`ffprobe` are already present. If those jobs suddenly spend minutes in
dependency setup again, first check the `Live Media Runner Image` workflow and
the `Verify preinstalled live media dependencies` step before assuming the media
tests themselves slowed down.

The release Docker path intentionally shards the plugin/runtime tail. The
workflow uses `plugins-runtime-plugins`, `plugins-runtime-services`, and
`plugins-runtime-install-a` through `plugins-runtime-install-d`; aggregate
aliases such as `plugins-runtime-core`, `plugins-runtime`, and
`plugins-integrations` remain for manual reruns.

The release QA parity box is internally split into candidate and baseline lane
jobs, followed by a report job that downloads both artifacts and runs
`pnpm openclaw qa parity-report`. For parity failures, inspect the failed lane
first; inspect the report job when both lane summaries exist but the comparison
fails.

### QA Lab Matrix Profiles

`pnpm openclaw qa matrix` defaults to `--profile all`. Do not assume the CLI
default is the fast release path. Use explicit profiles:

- `--profile fast`: release-critical Matrix transport contract; add
  `--fail-fast` only when the target CLI supports it
- `--profile transport|media|e2ee-smoke|e2ee-deep|e2ee-cli`: sharded full
  Matrix proof
- `OPENCLAW_QA_MATRIX_NO_REPLY_WINDOW_MS=3000`: CI-friendly no-reply quiet
  window when paired with fast or sharded gates

`QA-Lab - All Lanes` uses explicit fast Matrix on scheduled runs; manual
dispatch keeps `matrix_profile=all` as the default and always shards that full
Matrix selection. `OpenClaw Release Checks` uses explicit fast Matrix; run the
all-lanes workflow when release investigation needs full Matrix media/E2EE
inventory.

### Reusable Live/E2E Checks

`OpenClaw Live And E2E Checks (Reusable)`
(`openclaw-live-and-e2e-checks-reusable.yml`) is the preferred entry point for
targeted live, Docker, model, and E2E proof. Inputs let you turn off unrelated
lanes:

```bash
gh workflow run openclaw-live-and-e2e-checks-reusable.yml \
  --repo openclaw/openclaw \
  --ref main \
  -f ref=<sha> \
  -f include_repo_e2e=false \
  -f include_release_path_suites=false \
  -f include_openwebui=false \
  -f include_live_suites=true \
  -f live_models_only=true \
  -f live_model_providers=fireworks
```

Useful knobs:

- `docker_lanes='<lane[,lane]>'`: run selected Docker scheduler lanes against
  prepared artifacts instead of the release chunk matrix. Multiple selected
  lanes fan out as parallel targeted Docker jobs after one shared package/image
  preparation step.
- `include_live_suites=false`: skip live/provider suites when testing Docker
  scheduler or release packaging only.
- `live_models_only=true`: run only Docker live model coverage.
- `live_model_providers=fireworks` (or comma/space separated providers): run one
  targeted Docker live model job instead of the full provider matrix.
- blank `live_model_providers`: run the full live-model provider matrix.

Release-path Docker chunks are currently `core`, `package-update-openai`,
`package-update-anthropic`, `package-update-core`,
`plugins-runtime-plugins`, `plugins-runtime-services`,
`plugins-runtime-install-a`, `plugins-runtime-install-b`,
`plugins-runtime-install-c`, `plugins-runtime-install-d`,
`bundled-channels-core`, `bundled-channels-update-a`,
`bundled-channels-update-b`, and `bundled-channels-contracts`. The aggregate
`bundled-channels`, `plugins-runtime-core`, `plugins-runtime`, and
`plugins-integrations` chunks remain valid for manual one-shot reruns, but
release checks use the split chunks.

When live suites are enabled, the workflow shards broad native `pnpm test:live`
coverage through `scripts/test-live-shard.mjs` instead of one serial `live-all`
job:

- `native-live-src-agents`
- `native-live-src-gateway-core`
- `native-live-src-gateway-profiles` (release CI runs this with provider
  filters such as `OPENCLAW_LIVE_GATEWAY_PROVIDERS=anthropic`)
- `native-live-src-gateway-backends`
- `native-live-src-gateway-backends`
- `native-live-test`
- `native-live-extensions-a-k`
- `native-live-extensions-l-n`
- `native-live-extensions-openai`
- `native-live-extensions-o-z`
- `native-live-extensions-o-z-other`
- `native-live-extensions-xai`
- `native-live-extensions-media`
- `native-live-extensions-media-audio`
- `native-live-extensions-media-music`
- `native-live-extensions-media-music-google`
- `native-live-extensions-media-music-minimax`
- `native-live-extensions-media-video`

Use `node scripts/test-live-shard.mjs <shard> --list` to see the exact files
before rerunning a failed native live shard. The aggregate `o-z` and `media`
shards remain useful locally; release CI uses the smaller provider/media shards
so one live-provider flake does not force a broad native live rerun.

For model-list or provider-selection fixes, use `live_models_only=true` plus the
specific `live_model_providers` allowlist. Confirm logs show the expected
`OPENCLAW_LIVE_PROVIDERS` and selected model ids before declaring proof.