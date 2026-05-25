# Release Builds Reference

Read this file when checking release builds, running the beta test roster, or setting lane timeout caps.

- Always validate the OpenClaw npm release path before creating the tag.
- Source Peter's profile before live release validation so OpenAI and Anthropic
  credentials are available without printing secrets:
  `set -a; source "$HOME/.profile"; set +a`.
- Parallels validation and any local live model QA for this train must use both
  `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. If either is missing after sourcing
  `.profile`, stop before starting those local long lanes and report the
  missing key.
- Live credentialed channel QA is the GitHub Actions workflow
  `QA-Lab - All Lanes` (`.github/workflows/qa-live-telegram-convex.yml`), not a
  local substitute. Dispatch it from Actions against the release tag and wait
  for it to pass before npm preflight/publish readiness. Use a SHA only when it
  satisfies the workflow's secret-bearing trust gate: main ancestor or open PR
  head. It runs the QA Lab mock parity gate plus live Matrix and live Telegram
  lanes using the `qa-live-shared` environment; Telegram uses Convex CI
  credential leases.
- Default release checks:
  - `pnpm check`
  - `pnpm check:test-types`
  - `pnpm check:architecture`
  - `pnpm build`
  - `pnpm ui:build`
  - `pnpm release:check`
  - `OPENCLAW_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke`
- Full pre-npm beta test roster:
  - default release checks above
  - all Docker tests: `pnpm test:docker:all`, plus standalone Docker live lanes
    not covered by the aggregate when operator says "all docker tests":
    `pnpm test:docker:live-acp-bind`, `pnpm test:docker:live-cli-backend`, and
    `pnpm test:docker:live-codex-harness`
  - all Parallels install/update tests:
    `pnpm test:parallels:npm-update -- --json` plus any needed individual
    rerun lanes from `openclaw-parallels-smoke`
  - all QA release validation: dispatch GitHub Actions > `QA-Lab - All Lanes`
    against the release tag and require success. This is the release gate for
    live credentialed Matrix/Telegram channel coverage. Use a SHA only when it
    satisfies the workflow trust gate. Run local OpenAI/Anthropic suites or
    repo-backed character evals only when the operator asks for extra model
    coverage or a failure needs local debugging.
- Post-published beta verification roster:
  - `node --import tsx scripts/openclaw-npm-postpublish-verify.ts <beta-version>`
  - install/update smoke against the published beta channel
  - Docker install/update coverage that exercises the published beta package
  - published npm Telegram proof: dispatch Actions > `NPM Telegram Beta E2E`
    from `main` with `package_spec=openclaw@<beta-version>` and
    `provider_mode=mock-openai`, and require success. This workflow is
    maintainer-dispatched and intentionally has no `npm-release` approval gate;
    `qa-live-shared` only supplies the shared QA secrets. This is the default
    button path for installed-package onboarding, Telegram setup, and real
    Telegram E2E against the published npm package.
    Use the local `pnpm test:docker:npm-telegram-live` lane with the matching
    `OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC` and Convex CI env only as a fallback
    or debugging path.
  - Parallels published beta install/update coverage with both OpenAI and
    Anthropic provider keys available
  - Parallels install/update proof must keep plugin installs enabled unless the
    operator explicitly scopes a harness-only isolation check; a lane that
    disables bundled plugin installs is not valid plugin/dependency release
    evidence.
  - targeted QA reruns only for areas touched by fixes after the full pre-npm
    roster, unless the operator requests the full QA roster again. If the fix
    touches live channel QA, credential plumbing, Matrix, Telegram, or the QA
    harness, rerun Actions > `QA-Lab - All Lanes`.
- Check all release-related build surfaces touched by the release, not only the npm package.
- For beta-style full e2e batteries, hard-cap top-level long lanes instead of letting them run indefinitely. Use host `timeout --foreground`/`gtimeout --foreground` caps such as:
  - `45m` for `OPENCLAW_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke`
  - `90m` for `pnpm test:docker:all`
  - `60m` each for standalone Docker live lanes
  - `180m` for local full QA live OpenAI + Anthropic rosters when explicitly
    requested; the default release channel QA gate is Actions >
    `QA-Lab - All Lanes`
  - Parallels caps from the `openclaw-parallels-smoke` skill
    If a lane hits its cap, stop and inspect/fix the affected lane before continuing; do not continue to wait on the same process.
- Actual npm install/update phases are capped at 5 minutes. If `npm install -g`, installer package install, or `openclaw update` takes longer than 300s in release e2e, stop treating the run as healthy progress and debug the installer/updater or harness.
- Serialize host build/package mutations ahead of VM lanes. Finish `pnpm build`, `pnpm ui:build`, `pnpm release:check`, install smoke, and any Docker/package-prep lanes before starting Parallels `npm pack` lanes; otherwise `dist` can disappear during VM pack prep and produce false failures.
- Include mac release readiness in preflight by running the public validation
  workflow in `openclaw/openclaw` and the real mac preflight in
  `openclaw/releases-private` for every release.
- Treat the `appcast.xml` update on `main` as part of mac release readiness, not an optional follow-up.
- The workflows remain tag-based. The agent is responsible for making sure
  preflight runs complete successfully before any publish run starts.
- Any fix after preflight means a new commit. Delete and recreate the tag and
  matching GitHub release from the fixed commit, then rerun preflight from
  scratch before publishing.
  Exception: never delete or recreate a beta tag whose matching npm package has
  already been published; increment to the next beta number instead. If only the
  pushed tag/prerelease exists and npm publish has not happened, recreate that
  same beta tag at the fixed commit.
- For stable mac releases, generate the signed `appcast.xml` before uploading
  public release assets so the updater feed cannot lag the published binaries.
- Serialize stable appcast-producing runs across tags so two releases do not
  generate replacement `appcast.xml` files from the same stale seed.
- For stable releases, rely primarily on the latest beta's broader release
  workflow confidence. When promoting the matching non-beta build to npm
  `latest`, prefer a light time-bounded verification pass: published npm
  postpublish verify, Docker install/update smoke, macOS-only Parallels
  install/update smoke, and required QA signal. Do not rerun the full
  Docker/Parallels matrix unless the beta evidence is stale, the stable build
  differs materially from beta, or the operator explicitly asks for full
  retesting.
- If any required build, packaging step, or release workflow is red, do not say the release is ready.