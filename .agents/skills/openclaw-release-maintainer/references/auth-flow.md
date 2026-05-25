# Auth Flow Reference

Read this file when managing npm dist-tag promotion, 1Password fallback, or release workflow auth.

- OpenClaw publish uses GitHub trusted publishing.
- Stable npm promotion from `beta` to `latest` uses the private
  `openclaw/releases-private/.github/workflows/openclaw-npm-dist-tags.yml`
  workflow because `npm dist-tag` management needs `NPM_TOKEN`, while the
  public npm release workflow stays OIDC-only.
- Prefer fixing the private workflow token path over any local 1Password
  fallback. The desired setup is a granular npm token stored as the private
  repo's `NPM_TOKEN` secret, scoped to the `openclaw` package with read/write
  and 2FA bypass for automation.
- If the private dist-tag workflow cannot promote because `NPM_TOKEN` is absent
  or stale, use the local tmux + 1Password fallback:
  - Start or reuse a tmux session so interactive `npm login` and OTP prompts
    are observable and recoverable.
  - Hard rule: never run `op` directly in the main agent shell during release
    work. Any 1Password CLI use must happen inside that tmux session so prompts
    and alerts are contained and observable.
  - Use the 1Password item `op://Private/Npmjs` for npm credentials and OTP.
    Do not print passwords, tokens, or OTPs to the transcript; send them through
    tmux buffers, env vars scoped to the tmux command, or `expect` with
    `log_user 0`.
  - Re-authenticate npm inside that tmux session with
    `npm login --auth-type=legacy`, then confirm `npm whoami` reports
    `steipete`.
  - Promote with a fresh OTP:
    `npm dist-tag add openclaw@YYYY.M.D latest --otp "$OTP"`.
  - Verify with a cache-bypassed registry read, for example:
    `npm view openclaw dist-tags --json --prefer-online --cache /tmp/openclaw-npm-cache-verify-$$`
    and `npm view openclaw@latest version dist.tarball --json --prefer-online`.
- Direct stable publishes can also use that private dist-tag workflow to point
  `beta` at the already-published `latest` version when the operator wants both
  tags aligned immediately.
- The publish run must be started manually with `workflow_dispatch`.
- The npm workflow and the private mac publish workflow accept
  `preflight_only=true` to run validation/build/package steps without uploading
  public release assets.
- Real npm publish requires a prior successful npm preflight run id so the
  publish job promotes the prepared tarball instead of rebuilding it.
- Real private mac publish requires a prior successful private mac preflight
  run id so the publish job promotes the prepared artifacts instead of
  rebuilding or renotarizing them again.
- The private mac workflow also accepts `smoke_test_only=true` for branch-safe
  workflow smoke tests that use ad-hoc signing, skip notarization, skip shared
  appcast generation, and do not prove release readiness.
- `preflight_only=true` on the npm workflow is also the right way to validate an
  existing tag after publish; it should keep running the build checks even when
  the npm version is already published.
- npm validation-only preflight may still be dispatched from ordinary branches
  when testing workflow changes before merge. Release checks and real publish
  use only `main` or `release/YYYY.M.D`.
- `.github/workflows/macos-release.yml` in `openclaw/openclaw` is now a
  public validation-only handoff. It validates the tag/release state and points
  operators to the private repo. It still rebuilds the JS outputs needed for
  release validation, but it does not sign, notarize, or publish macOS
  artifacts.
- `openclaw/releases-private/.github/workflows/openclaw-macos-validate.yml`
  is the required private mac validation lane for `swift test`; keep it green
  before any real stable mac publish run starts.
- Real mac preflight and real mac publish both use
  `openclaw/releases-private/.github/workflows/openclaw-macos-publish.yml`.
- The private mac validation lane runs on GitHub's standard macOS runner.
- The private mac preflight path runs on GitHub's xlarge macOS runner and uses
  a SwiftPM cache because the build/sign/notarize/package path is CPU-heavy.
- Private mac preflight uploads notarized build artifacts as workflow artifacts
  instead of uploading public GitHub release assets.
- Private smoke-test runs upload ad-hoc, non-notarized build artifacts as
  workflow artifacts and intentionally skip stable `appcast.xml` generation.
- For stable releases, npm preflight, public mac validation, private mac
  validation, and private mac preflight must all pass before any real publish
  run starts. For beta releases, npm preflight plus the selected Docker,
  install/update, Parallels, and release-check lanes are sufficient unless mac
  beta validation was explicitly requested.
- Real publish runs may be dispatched from `main` or from a
  `release/YYYY.M.D` branch. For release-branch runs, the tag must be contained
  in that release branch, and the real publish must reuse a successful preflight
  from the same branch.
- The release workflows stay tag-based; rely on the documented release sequence
  rather than workflow-level SHA pinning.
- The `npm-release` environment must be approved by `@openclaw/openclaw-release-managers` before publish continues.
- Mac publish uses
  `openclaw/releases-private/.github/workflows/openclaw-macos-publish.yml` for
  private mac preflight artifact preparation and real publish artifact
  promotion.
- Real private mac publish uploads the packaged `.zip`, `.dmg`, and
  `.dSYM.zip` assets to the existing GitHub release in `openclaw/openclaw`
  automatically when `OPENCLAW_PUBLIC_REPO_RELEASE_TOKEN` is present in the
  private repo `mac-release` environment.
- For stable releases, the agent must also download the signed
  `macos-appcast-<tag>` artifact from the successful private mac workflow and
  then update `appcast.xml` on `main`.
- For beta mac releases, do not update the shared production `appcast.xml`
  unless a separate beta Sparkle feed exists.
- The private repo targets a dedicated `mac-release` environment. If the GitHub
  plan does not yet support required reviewers there, do not assume the
  environment alone is the approval boundary; rely on private repo access and
  CODEOWNERS until those settings can be enabled.
- Do not use `NPM_TOKEN` or the plugin OTP flow for the OpenClaw package
  publish path; package publishing uses trusted publishing.
- Use `NPM_TOKEN` only for explicit npm dist-tag management modes, because npm
  does not support trusted publishing for `npm dist-tag add`.
- `@openclaw/*` plugin publishes use a separate maintainer-only flow.
- Only publish plugins that already exist on npm; bundled disk-tree-only plugins stay unpublished.