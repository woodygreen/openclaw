---
name: openclaw-secret-scanning-maintainer
description: |
  处理 OpenClaw repo 的 GitHub Secret Scanning 告警，识别泄露凭据并执行清除、通知、解决流程。当用户说 "secret scanning"、"security alert"、"leaked secret"、"credential exposure"、"secret leak"、"redact secret"、"secret scan"、"leaked credentials"、"GHSA" 时，立即使用此 skill。即使用户没有明确说出 skill 名称，只要意图符合处理安全扫描告警或凭据泄露，也应触发。仅限维护者使用 — 需要仓库管理员权限来编辑/删除评论和解决告警。
allowed-tools:
  - Bash(node .agents/skills/openclaw-secret-scanning-maintainer/scripts/secret-scanning.mjs *)
  - Bash(gh api repos/openclaw/openclaw/secret-scanning/*)
  - Bash(gh api repos/openclaw/openclaw/issues/*)
  - Bash(gh api repos/openclaw/openclaw/pulls/*)
  - Bash(gh api graphql *)
  - Read
  - Edit
---

# OpenClaw Secret Scanning Maintainer

**Maintainer-only.** This skill requires repo admin / maintainer permissions to edit or delete other users' comments and resolve secret scanning alerts.

Use this skill when processing alerts from `https://github.com/openclaw/openclaw/security/secret-scanning`.

**Language rule:** All notification comments and replacement comments must be written in English.

## Script

All mechanical operations (API calls, temp file management, security enforcements) are handled by:

```
$REPO_ROOT/.agents/skills/openclaw-secret-scanning-maintainer/scripts/secret-scanning.mjs
```

The script enforces:

- `hide_secret=true` on all alert fetches (no plaintext secrets in stdout)
- `mktemp` with random UUIDs for all temp files
- `-F body=@file` for all body uploads (no inline shell quoting)
- Notification templates branched by location type
- Never prints `.secret` or `.body` to stdout

## Overall Flow

Supports single or multiple alerts. For multiple alerts, process in ascending order.

For each alert:

1. **Identify** — `fetch-alert` + `fetch-content` to get metadata and body
2. **Decide** — Agent reads the body file, identifies all secrets, produces redacted version
3. **Redact** — `redact-body` for issue/PR body; skip for comments (delete directly)
4. **Purge** — `delete-comment` + `recreate-comment` for comments; cannot purge body history
5. **Notify** — `notify` posts the right template per location type
6. **Resolve** — `resolve` closes the alert
7. **Summary** — `summary` prints formatted results

## Step 1: Identify

```bash
# List all open alerts
node secret-scanning.mjs list-open

# Fetch specific alert metadata + locations
node secret-scanning.mjs fetch-alert <NUMBER>

# Fetch content for each location (saves body to temp file)
node secret-scanning.mjs fetch-content '<location-json>'
```

The `fetch-content` output includes:

- `body_file`: path to temp file with full body content
- `author`: who posted it
- `issue_number` / `pr_number`: where it is
- `edit_history_count`: number of existing edits
- `type`: location type for routing
- For `discussion_comment`, it also includes `comment_node_id`, `discussion_node_id`, and `reply_to_node_id` when the original comment was a reply.

### Location type routing

| type                          | Flow                                          |
| ----------------------------- | --------------------------------------------- |
| `issue_comment`               | Comment: delete+recreate                      |
| `pull_request_comment`        | Comment: delete+recreate                      |
| `pull_request_review_comment` | Comment: delete+recreate                      |
| `discussion_comment`          | Discussion comment: delete+recreate (GraphQL) |
| `issue_body`                  | Body: redact in place                         |
| `pull_request_body`           | Body: redact in place                         |
| `commit`                      | Notify only                                   |
| _other_                       | Skip and report                               |

## Step 2: Decide (Agent)

The agent reads the body file from `fetch-content` output and:

1. Identifies ALL secrets in the content (there may be more than the alert flagged)
2. Replaces each secret with `[REDACTED <secret_type>]` — **no partial values, no prefix/suffix**
3. Saves the redacted content to a new temp file

This is the only step that requires semantic understanding. Everything else is mechanical.

## Step 3: Redact

### For comments (issue_comment / PR comments)

**Do NOT redact.** Skip directly to Step 4 (delete + recreate). PATCHing before DELETE creates an unnecessary edit history revision.

### For issue_body / pull_request_body

```bash
node secret-scanning.mjs redact-body <issue|pr> <NUMBER> <redacted-body-file>
```

## Step 4: Purge Edit History

### Comments — Delete and Recreate

For issue/PR comments:

```bash
# Delete original (all edit history gone)
node secret-scanning.mjs delete-comment <COMMENT_ID>

# Recreate with redacted content
node secret-scanning.mjs recreate-comment <ISSUE_NUMBER> <body-file>
```

For discussion comments (uses GraphQL):

```bash
# Delete original
node secret-scanning.mjs delete-discussion-comment <COMMENT_NODE_ID>

# Recreate with redacted content
node secret-scanning.mjs recreate-discussion-comment <DISCUSSION_NODE_ID> <body-file> [REPLY_TO_NODE_ID]
```

The `fetch-content` output for `discussion_comment` includes `comment_node_id` and `discussion_node_id` for these commands. When the original discussion comment was a reply, it also includes `reply_to_node_id`; pass that optional third argument so the redacted replacement stays in the original thread.

The recreated comment should follow this format:

```
> **Note:** The original comment by @<AUTHOR> has been removed due to secret leakage. Below is the redacted version of the original content.

---

<redacted original content>
```

### issue_body / pull_request_body — Cannot Purge

Editing creates an edit history revision with the pre-edit plaintext. This cannot be cleared via API.

**Output to maintainer terminal only (never in public comments):**

```
⚠️ Issue/PR body edit history still contains plaintext secrets.
Contact GitHub Support to purge: https://support.github.com/contact
Request purge of issue/PR #{NUMBER} userContentEdits.
```

> **Important:** Do not mention edit history or the "edited" button in any public comment or resolution_comment — this information could help attackers locate plaintext secrets in edit history.

### Commits

Cannot clean. Notify author to delete branch or force-push (for unmerged PRs).

## Step 5: Notify

```bash
node secret-scanning.mjs notify <TARGET> <AUTHOR> <LOCATION_TYPE> <SECRET_TYPES> [REPLY_TO_NODE_ID]
```

- For non-discussion types, `<TARGET>` is the issue/PR number.
- For `discussion_comment`, `<TARGET>` is the `discussion_node_id` returned by `fetch-content`.
- For reply-style `discussion_comment` locations, pass the optional `reply_to_node_id` from `fetch-content` so the notification stays in the same thread.

Secret types are comma-separated: `"Discord Bot Token,Feishu App Secret"`

The script picks the right template:

- **comment types**: "your comment … removed and replaced"
- **body types**: "your issue/PR description … redacted in place"
- **commit**: "code you committed"

## Step 6: Resolve

```bash
node secret-scanning.mjs resolve <ALERT_NUMBER>
# or with custom resolution:
node secret-scanning.mjs resolve <ALERT_NUMBER> revoked "Custom comment"
```

Resolution is `revoked` by default. As maintainers we cannot control whether users rotate — our responsibility is to redact + notify. The `revoked` means "this secret should be considered leaked", not "I confirmed it was revoked".

## Step 7: Summary

After processing, create a JSON results file and pass it to the summary command:

```bash
node secret-scanning.mjs summary /tmp/results.json
```

The script outputs a block delimited by `---BEGIN SUMMARY---` and `---END SUMMARY---`. **Output the content between these markers verbatim to the user (any modification breaks the dedup hash). Do not rephrase, reformat, abbreviate, or create your own summary.** The script already includes full URLs for every alert and location.

The JSON format:

```json
[
  {
    "number": 72,
    "secret_type": "Discord Bot Token",
    "location_label": "Issue #63101 comment",
    "location_url": "https://github.com/openclaw/openclaw/issues/63101#issuecomment-xxx",
    "actions": "Deleted+Recreated+Notified",
    "history_cleared": true
  }
]
```

For unsupported types, add `"skipped": true, "unsupported_type": "<type>"`.

## Safety Rules

- **Agent reads content, identifies secrets, produces redaction.** Script handles all API calls.
- **never include any portion of a secret** in public comments, redaction markers, or terminal output (even partial matches enable reconstruction).
- **never include alert URLs or numbers** in public comments (they link directly to plaintext secrets).
- **For comments, skip PATCH — go directly to DELETE + recreate.**
- **never mention edit history, "edited" button, or commit SHAs** in any public content (same reason — helps attackers locate plaintext).
- **Ask for confirmation** before deleting any comment.
- **One alert at a time** unless user requests batch.
- **All public comments in English.**
- **Skip unsupported location types** and report in summary.
