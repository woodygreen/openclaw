---
name: openclaw-release-maintainer
description: Use immediately when preparing, verifying, or publishing OpenClaw stable/beta releases, changelogs, release notes, npm packages, macOS apps, or release artifacts. Also trigger when user says "release", "ship", "deploy", "cut a release", "beta release", "changelog", or asks about version bumping, npm publish, or mac signing/notarizing.
allowed-tools:
  - Bash(pnpm build *)
  - Bash(pnpm release:check *)
  - Bash(pnpm qa:otel:smoke)
  - Bash(pnpm test:install:smoke *)
  - Bash(pnpm test:docker *)
  - Bash(pnpm test:parallels *)
  - Bash(pnpm check *)
  - Bash(pnpm ui:build *)
  - Bash(pnpm check:architecture *)
  - Bash(gh workflow run *)
  - Bash(gh run view *)
  - Bash(gh run list *)
  - Bash(gh release create *)
  - Bash(gh release edit *)
  - Bash(npm view *)
  - Bash(npm dist-tag *)
  - Bash(node --import tsx scripts/*)
  - Bash(git tag *)
  - Bash(git checkout *)
  - Bash(set -a; source *)
---

# OpenClaw Release Maintainer

Use this skill for release and publish-time workflow. Keep ordinary development changes and GHSA-specific advisory work outside this skill.

## Contents

- [Respect release guardrails](#respect-release-guardrails)
- [Keep release channel naming aligned](#keep-release-channel-naming-aligned)
- [Handle versions and release files consistently](#handle-versions-and-release-files-consistently)
- [Build changelog-backed release notes](#build-changelog-backed-release-notes)
- [Write release tweets](#write-release-tweets)
- [Run publish-time validation](#run-publish-time-validation)
- [Check all relevant release builds](#check-all-relevant-release-builds)
- [Use the right auth flow](#use-the-right-auth-flow)
- [Fallback local mac publish](#fallback-local-mac-publish)
- [Run the release sequence](#run-the-release-sequence)
- [GHSA advisory work](#ghsa-advisory-work)

## Reference Files

- **Release Tweets**: read `references/release-tweets.md` when drafting or reviewing X/Twitter posts for a release.
- **Release Builds**: read `references/release-builds.md` when running the full beta/stable test roster, setting lane timeout caps, or checking release builds.
- **Auth Flow**: read `references/auth-flow.md` when managing npm dist-tag promotion, 1Password fallback, or release workflow auth details.
- **Mac Fallback**: read `references/mac-fallback.md` when CI/CD mac publishing is unavailable and local mac publish is needed.

## Respect release guardrails

- Change version numbers only with explicit operator approval.
- Ask permission before any npm publish or release step.
- This skill should be sufficient to drive the normal release flow end-to-end.
- Use the private maintainer release docs for credentials, recovery steps, and mac signing/notary specifics, and use `docs/reference/RELEASING.md` for public policy.
- Core `openclaw` publish is manual `workflow_dispatch`; creating or pushing a tag does not publish by itself.
- Normal release work happens on a branch cut from `main`, not directly on
  `main`. Use `release/YYYY.M.D` for the branch name.
- If the operator asks for a release without saying stable/full, default to
  beta only. Continue from beta to stable only when the operator explicitly asks
  for the full release or an automated beta-and-stable train.
- Before release branching, pull latest `main` and confirm current `main` CI is
  green. Then branch from that commit so regular development can continue on
  `main` while release validation runs.
- Before release branching, commit any dirty files in coherent groups, push,
  pull/rebase, then run `/changelog` on `main` and commit/push/pull that
  changelog rewrite immediately before creating the release branch.
- During release planning, inspect both `src/plugins/compat/registry.ts` and
  `src/commands/doctor/shared/deprecation-compat.ts` before branching and again
  before final publish. For every deprecated or removal-pending compatibility
  record whose `removeAfter` date is on or before the release date, either
  remove the compatibility path where safe and validate the affected tests, or
  write down why removal is blocked and get explicit maintainer approval before
  shipping the expired compatibility path.
- When removing deprecated runtime/config compatibility, preserve any doctor
  migration, repair, or hint that is still needed by supported upgrade paths.
  Doctor-side compatibility should stay tracked in
  `src/commands/doctor/shared/deprecation-compat.ts` until maintainers confirm
  the repair is no longer needed.
- Revalidate compatibility replacement text during release planning. The
  recommended replacement can shift as plugin ownership, externalization, and
  config footprint move, so do not blindly copy stale replacement annotations
  into release notes.
- Do not delete or rewrite beta tags after their matching npm package has been
  published. If a pushed beta tag fails before npm publish, the version is not
  consumed: keep the same `-beta.N`, delete/recreate or force-move the git tag
  and prerelease to the fixed commit, and rerun preflight. Do not increment to
  the next beta number until the matching npm package has actually published.
  If a published beta needs a fix, commit the fix on the release branch and
  increment to the next `-beta.N`.
- For a beta release train, run the fast local preflight first, publish the
  beta to npm `beta`, then run the expensive published-package roster focused
  on install/update/Docker/Parallels/NPM Telegram. If anything fails, fix it on
  the release branch, commit/push/pull, increment beta number, and repeat. Run
  the full expensive roster at least once before stable/latest promotion; for
  later beta attempts, rerun only lanes whose evidence changed unless the fix
  touches broad release, install/update, plugin, Docker, Parallels, or live QA
  behavior. After each beta is published, scan current `main` once for critical
  fixes that landed after the release branch cut and backport only important
  low-risk fixes. Operators may authorize up to 4 autonomous beta attempts;
  after 4 failed beta attempts, stop and report.
- Use `/changelog` before version/tag preparation so the top changelog section
  is deduped and ordered by user impact.
- Do not create beta-specific `CHANGELOG.md` headings. Beta releases use the
  stable base version section, for example `v2026.4.20-beta.1` uses
  `## 2026.4.20` release notes.
- When any beta or stable release is live, make a best-effort Discord
  announcement using Peter's bot token from `.profile`; do not block or roll
  back the release if the announcement fails.
- When asked to announce on X, use `~/Projects/bird/bird` and follow the
  release tweet style in `references/release-tweets.md`.

## Keep release channel naming aligned

- `stable`: tagged releases only, published to npm `beta` by default; operators may target npm `latest` explicitly or promote later
- `beta`: prerelease tags like `vYYYY.M.D-beta.N`, with npm dist-tag `beta`
- Prefer `-beta.N`; do not mint new `-1` or `-2` beta suffixes
- `dev`: moving head on `main`
- When using a beta Git tag, publish npm with the matching beta version suffix so the plain version is not consumed or blocked

## Handle versions and release files consistently

- Version locations include:
  - `package.json`
  - `apps/android/app/build.gradle.kts`
  - `apps/ios/Sources/Info.plist`
  - `apps/ios/Tests/Info.plist`
  - `apps/macos/Sources/OpenClaw/Resources/Info.plist`
  - `docs/install/updating.md`
  - Peekaboo Xcode project and plist version fields
- Before creating a release tag, make every version location above match the version encoded by that tag.
- For fallback correction tags like `vYYYY.M.D-N`, the repo version locations still stay at `YYYY.M.D`.
- "Bump version everywhere" means all version locations above except `appcast.xml`.
- Release signing and notary credentials live outside the repo in the private maintainer docs.
- Every stable OpenClaw release ships the npm package and macOS app together.
  Beta releases normally ship npm/package artifacts first and skip mac app
  build/sign/notarize unless the operator requests mac beta validation.
- Publish npm independently once npm preflight passes, then run mac validation in parallel. Keep mac validation/publish running in
  parallel, publish npm from the successful npm preflight, then start published
  npm install/update, Docker, and Parallels verification while mac artifacts
  continue.
- After a beta is published, overlap remote/manual release rosters where useful,
  but avoid piling local Docker, Parallels, and QA-Lab work onto the same host
  when it would create system-load noise. Use selective reruns after failures or
  fixes, but keep proof that Docker, Parallels, and QA-Lab each passed at least
  once before stable/latest promotion.
- Mac packaging may be built from a slight release-branch variation of the
  tagged commit when the delta is mac packaging, signing, workflow, or
  validation-only release machinery. If mac packaging needs release-branch-only
  fixes after the stable npm package or GitHub tag is already published, do not
  create a `vYYYY.M.D-N` correction tag just to change the workflow source.
  Dispatch the private mac workflows for the original `tag=vYYYY.M.D` with
  `source_ref=release/YYYY.M.D` and `public_release_branch=release/YYYY.M.D`;
  provenance checks must prove the source SHA descends from the tag and
  validation/preflight use the same source. Reserve `vYYYY.M.D-N` correction
  tags for emergency hotfixes that must publish a new npm package/release
  identity, not for ordinary mac-only packaging recovery.
- The production Sparkle feed lives at `https://raw.githubusercontent.com/openclaw/openclaw/main/appcast.xml`, and the canonical published file is `appcast.xml` on `main` in the `openclaw` repo.
- That shared production Sparkle feed is stable-only. Beta mac releases may
  upload assets to the GitHub prerelease, but they must not replace the shared
  `appcast.xml` unless a separate beta feed exists.
- For fallback correction tags like `vYYYY.M.D-N`, the repo version still stays
  at `YYYY.M.D`, but the mac release must use a strictly higher numeric
  `APP_BUILD` / Sparkle build than the original release so existing installs
  see it as newer.

## Build changelog-backed release notes

- Before release branching or tagging, rewrite the target `CHANGELOG.md`
  section from commit history, not just from existing notes: scan commits since
  the last reachable release tag, add missed user-facing changes, dedupe
  overlapping entries, and sort each section from most to least interesting for
  users.
- Changelog entries should be user-facing, not internal release-process notes.
- GitHub release and prerelease bodies must use the full matching
  `CHANGELOG.md` version section, not highlights or an excerpt. When creating
  or editing a release, extract from `## YYYY.M.D` through the line before the
  next level-2 heading and use that complete block as the release notes.
- When preparing release notes, scan `src/plugins/compat/registry.ts` and
  `src/commands/doctor/shared/deprecation-compat.ts` for compatibility records
  with `warningStarts` or `removeAfter` within 7 days after the release date.
  Add an `Upcoming deprecations` note to the release notes when any exist,
  including the compatibility code, target date, replacement, and a link to the
  record's `docsPath` or `/plugins/compatibility` when no more specific
  deprecation page exists.
- When cutting a mac release with a beta GitHub prerelease:
  - tag `vYYYY.M.D-beta.N` from the release commit
  - create a prerelease titled `openclaw YYYY.M.D-beta.N`
  - use release notes from the stable base `CHANGELOG.md` version section
    (`## YYYY.M.D`), not a beta-specific heading
  - attach at least the zip and dSYM zip, plus dmg if available
- Keep the top version entries in `CHANGELOG.md` sorted by impact:
  - `### Changes` first
  - `### Fixes` deduped with user-facing fixes first

## Write release tweets

For tweet format, style, thread workflow, and examples, read `references/release-tweets.md`.

## Run publish-time validation

Before tagging or publishing, run:

```bash
pnpm check:architecture
pnpm build
pnpm ui:build
pnpm qa:otel:smoke
pnpm release:check
pnpm test:install:smoke
```

- Use `pnpm qa:otel:smoke` when release validation needs telemetry coverage.
  It starts a local OTLP/HTTP trace receiver, runs QA-lab's
  `otel-trace-smoke`, and checks span names plus content/identifier redaction
  without external Opik or Langfuse credentials.

For a non-root smoke path:

```bash
  OPENCLAW_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke
```

After npm publish, run:

```bash
node --import tsx scripts/openclaw-npm-postpublish-verify.ts <published-version>
```

- This verifies the published registry install path in a fresh temp prefix.
- For stable correction releases like `YYYY.M.D-N`, it also verifies the
  upgrade path from `YYYY.M.D` to `YYYY.M.D-N` so a correction publish cannot
  silently leave existing global installs on the old base stable payload.
- Treat install smoke as a pack-budget gate too. `pnpm test:install:smoke`
  now fails the candidate update tarball when npm reports an oversized
  `unpackedSize`, so release-time e2e cannot miss pack bloat that would risk
  low-memory install/startup failures.
- Keep direct npm global coverage enabled in install smoke. It exercises plain
  `npm install -g <candidate>` fresh installs and npm-driven update installs,
  because many users install with npm even when docs prefer pnpm.
- Use `pnpm test:live:media video` for bounded video-provider smoke when video
  generation is in release scope. The default video smoke skips `fal`, runs one
  text-to-video attempt per provider with a one-second lobster prompt, and caps
  each provider operation with `OPENCLAW_LIVE_VIDEO_GENERATION_TIMEOUT_MS`
  (`180000` by default).
- Run `pnpm test:live:media video --video-providers fal` only when FAL-specific
  proof is required. Its queue latency can dominate release time.
- Set `OPENCLAW_LIVE_VIDEO_GENERATION_FULL_MODES=1` only when intentionally
  validating the slower image-to-video and video-to-video transform lanes.

## Check all relevant release builds

For the full beta/stable test roster, lane timeout caps, and release build details, read `references/release-builds.md`.

## Use the right auth flow

For npm dist-tag promotion, 1Password fallback, workflow auth details, and mac release auth, read `references/auth-flow.md`.

## Fallback local mac publish

For local mac publish steps when CI/CD is unavailable, read `references/mac-fallback.md`.

## Run the release sequence

1. Confirm the operator explicitly wants to cut a release.
2. Choose the exact target version and git tag.
3. Commit any dirty files in coherent groups, push, pull/rebase, and verify the
   worktree is clean.
4. Pull latest `main` and confirm current `main` CI is green.
5. Run `/changelog` for the stable base target version on `main`, commit the
   changelog rewrite immediately, push, and pull/rebase. For beta releases,
   keep the changelog heading as `## YYYY.M.D`, not `## YYYY.M.D-beta.N`.
6. Create `release/YYYY.M.D` from that post-changelog `main` commit.
7. Make every repo version location match the beta tag before creating it.
8. Commit release preparation changes on the release branch and push the branch.
9. Run the fast local beta preflight from the release branch before any npm
   preflight or publish. Keep expensive Docker, Parallels, and published-package
   install/update lanes for after the beta is live unless the operator asks to
   run them before beta publication.
10. For beta releases, skip mac app build/sign/notarize unless beta scope or a
    release blocker specifically requires it. For stable releases, include the
    mac app, signing, notarization, and appcast path.
11. Confirm the target npm version is not already published.
12. Create and push the git tag from the release branch.
13. Create or refresh the matching GitHub release.
14. Dispatch Actions > `QA-Lab - All Lanes` against the release tag and wait
    for the mock parity, live Matrix, and live Telegram credentialed-channel
    lanes to pass.
15. Start `.github/workflows/openclaw-npm-release.yml` from the release branch
    with `preflight_only=true`
    and choose the intended `npm_dist_tag` (`beta` default; `latest` only for
    an intentional direct stable publish). Wait for it to pass. Save that run id
    because the real publish requires it to reuse the prepared npm tarball.
16. For stable releases, start `.github/workflows/macos-release.yml` in
    `openclaw/openclaw` and wait for the public validation-only run to pass.
17. For stable releases, start
    `openclaw/releases-private/.github/workflows/openclaw-macos-validate.yml`
    with the same tag and wait for the private mac validation lane to pass.
18. For stable releases, start
    `openclaw/releases-private/.github/workflows/openclaw-macos-publish.yml`
    with `preflight_only=true` and wait for it to pass. Save that run id because
    the real publish requires it to reuse the notarized mac artifacts.
19. If any preflight or validation run fails, fix the issue on a new commit,
    delete the tag and matching GitHub release, recreate them from the fixed
    commit, and rerun all relevant preflights from scratch before continuing.
    Never reuse old preflight results after the commit changes. For pushed or
    published beta tags, do not delete/recreate; increment to the next beta tag.
    For preflight-only failures where npm did not publish the beta version,
    delete/recreate the same beta tag and prerelease at the fixed commit instead
    of skipping a prerelease number.
20. Start `.github/workflows/openclaw-npm-release.yml` from the same branch with
    the same tag for the real publish, choose `npm_dist_tag` (`beta` default,
    `latest` only when you intentionally want direct stable publish), keep it
    the same as the preflight run, and pass the successful npm
    `preflight_run_id`.
21. Wait for `npm-release` approval from `@openclaw/openclaw-release-managers`.
22. Run postpublish verification:
    `node --import tsx scripts/openclaw-npm-postpublish-verify.ts <published-version>`.
23. Run the post-published beta verification roster. First scan current `main`
    for critical fixes that landed after the release branch cut; backport only
    important low-risk fixes before starting expensive lanes, or increment to
    the next beta if the fix must change the already-published package. If any
    lane fails after the beta package is published, fix, commit/push/pull,
    increment to the next beta tag, and rerun the affected beta evidence. Once
    the beta is live, start remote/manual rosters where they
    can overlap safely, but keep local Docker and Parallels load controlled.
    Ensure the full expensive roster has passed at least once before
    stable/latest promotion. The roster includes the manual Actions >
    `NPM Telegram Beta E2E` workflow against the exact published beta package.
    If a pre-npm lane fails before any tag/package leaves the machine, fix and
    rerun the same intended beta attempt. Repeat up to the operator's
    authorized beta-attempt limit, normally 4.
24. Announce the beta/stable release on Discord best-effort using Peter's bot
    token from `.profile`.
25. If the operator requested beta only, stop after beta verification and the
    announcement.
26. If the stable release was published to `beta`, use the light stable
    promotion roster when the matching beta already carried the full confidence
    pass: published npm postpublish verify, Docker install/update smoke,
    macOS-only Parallels install/update smoke, and required QA signal.
    Then start the private
    `openclaw/releases-private/.github/workflows/openclaw-npm-dist-tags.yml`
    workflow to promote that stable version from `beta` to `latest`, then
    verify `latest` now points at that version.
27. If the stable release was published directly to `latest` and `beta` should
    follow it, start that same private dist-tag workflow to point `beta` at the
    stable version, then verify both `latest` and `beta` point at that version.
28. For stable releases, start
    `openclaw/releases-private/.github/workflows/openclaw-macos-publish.yml`
    for the real publish with the successful private mac `preflight_run_id` and
    wait for success.
29. Verify the successful real private mac run uploaded the `.zip`, `.dmg`,
    and `.dSYM.zip` artifacts to the existing GitHub release in
    `openclaw/openclaw`.
30. For stable releases, download `macos-appcast-<tag>` from the successful
    private mac run, update `appcast.xml` on `main`, and verify the feed. Merge
    or cherry-pick release branch changes back to `main` after stable succeeds.
31. For beta releases, publish the mac assets only when intentionally requested;
    expect no shared production
    `appcast.xml` artifact and do not update the shared production feed unless a
    separate beta feed exists.
32. After publish, verify npm and the attached release artifacts.

## GHSA advisory work

- Use `openclaw-ghsa-maintainer` for GHSA advisory inspection, patch/publish flow, private-fork validation, and GHSA API-specific publish checks.