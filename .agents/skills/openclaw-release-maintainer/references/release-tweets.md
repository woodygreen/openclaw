# Release Tweets Reference

Read this file when drafting or reviewing release tweets or X posts for OpenClaw releases.

Use the OpenClaw account's existing release-post style:

- Format: `OpenClaw YYYY.M.D 🦞` or `🦞 OpenClaw YYYY.M.D is live`, blank line,
  then 3-4 emoji-led bullets, blank line, one short punchline, then the release
  link.
- For beta: say `OpenClaw YYYY.M.D-beta.N 🦞` or `OpenClaw YYYY.M.D beta N is
live`; keep it clearly beta and avoid implying stable promotion.
- Lead with user-visible capabilities, then important integrations, then
  reliability/security/install fixes. Compress "lots of fixes" into one
  readable bullet.
- Read the full changelog section before drafting. Do not lead with coverage,
  CI, validation, or internal release mechanics unless the release is explicitly
  about those. Peter prefers concrete user wins: features, integrations,
  workflow improvements, and practical reliability fixes.
- Tone: high-signal, slightly cheeky, confident, not corporate. One joke is
  enough. Avoid punching down, insulting users, or promising what was not
  verified.
- Peter likes dry, compact taglines when they feel earned. Good example:
  `Big release, tiny release notes... kidding.` Keep the joke short and let the
  feature bullets carry the tweet; do not turn the punchline into a second
  paragraph or a forced bit.
- Length: release tweets are always standard tweets under 280 characters, with
  room for one URL. Trim to 3-4 bullets and count the final text before posting.
- Links/media: include the GitHub release or changelog link at the end of the
  first release tweet.
- Thread follow-ups: if doing a thread, keep the first release tweet as the
  compact launch post, then publish one focused feature explainer per reply.
  Follow-up replies should not repeat "new in VERSION" or the version number
  when the thread context already makes it obvious.
- Peter's preferred thread workflow: first agree on the generic launch tweet,
  then proceed through follow-up tweets one by one. When he says `next`, provide
  or copy the next follow-up only; do not dump the full thread again unless asked.
- Every follow-up tweet should include a docs URL for that specific feature.
  Prefer a bare URL over `Docs: <url>` unless the label is needed for clarity.
  Keep follow-ups concise: around 160-220 raw characters is usually the sweet
  spot; under 280 is the hard cap. If a URL makes a tweet fail, trim prose
  before dropping the URL.
  Prefer explaining diagnostics, trajectory/export, provider setup, model
  commands, or other setup-heavy features in follow-ups instead of overloading
  the first release tweet.
- Hotfix/correction: be direct and accountable. State what slipped, what is
  fixed, and the new version. Keep jokes out of incident-style posts.

Examples to adapt:

```text
OpenClaw 2026.4.20-beta.1 🦞

🐳 Docker install/update smoke
🖥️ Parallels upgrade checks
🔧 Package verification tightened

Beta first. Stable after the gauntlet.
<release link>
```

```text
OpenClaw 2026.4.20 🦞

🚀 Faster install + update
🐳 Docker + Parallels verified
🍎 macOS signed + notarized
🔧 Channel/plugin fixes

Good boring release. Best kind.
<release link>
```

```text
Packaging issue in 2026.4.20-beta.1.

2026.4.20-beta.2 fixes install/update verification. No tag rewrites; beta moves
forward.

Upgrade with the beta channel.
<release link>
```