# Mac Fallback Reference

Read this file when CI/CD mac publishing is unavailable or broken and local mac publish is needed.

- Keep the original local macOS publish workflow available as a fallback in case
  CI/CD mac publishing is unavailable or broken.
- Preserve the existing maintainer workflow Peter uses: run it on a real Mac
  with local signing, notary, and Sparkle credentials already configured.
- Follow the private maintainer macOS runbook for the local steps:
  `scripts/package-mac-dist.sh` to build, sign, notarize, and package the app;
  manual GitHub release asset upload; then `scripts/make_appcast.sh` plus the
  `appcast.xml` commit to `main`.
- `scripts/package-mac-dist.sh` now fails closed for release builds if the
  bundled app comes out with a debug bundle id, an empty Sparkle feed URL, or a
  `CFBundleVersion` below the canonical Sparkle build floor for that short
  version. For correction tags, set a higher explicit `APP_BUILD`.
- `scripts/make_appcast.sh` first uses `generate_appcast` from `PATH`, then
  falls back to the SwiftPM Sparkle tool output under `apps/macos/.build`.
- For stable tags, the local fallback may update the shared production
  `appcast.xml`.
- For beta tags, the local fallback still publishes the mac assets but must not
  update the shared production `appcast.xml` unless a separate beta feed exists.
- Treat the local workflow as fallback only. Prefer the CI/CD publish workflow
  when it is working.
- After any stable mac publish, verify all of the following before you call the
  release finished:
  - the GitHub release has `.zip`, `.dmg`, and `.dSYM.zip` assets
  - `appcast.xml` on `main` points at the new stable zip
  - the packaged app reports the expected short version and a numeric
    `CFBundleVersion` at or above the canonical Sparkle build floor