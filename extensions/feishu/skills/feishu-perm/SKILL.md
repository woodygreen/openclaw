---
name: feishu-perm
description: |
  飞书文档/文件权限管理（list/add/remove collaborators）。当用户说 "授权"、"访问控制"、"access control"、"grant access"、"分享设置"、"sharing"、"permissions"、"collaborators"、"权限"、"共享" 时，立即使用此 skill。即使用户没有明确说出 skill 名称，只要意图符合，也应触发。
---

# Feishu Permission Tool

Single tool `feishu_perm` for managing file/document permissions.

## Permission Workflow

To share a document: first use `list` to check existing collaborators, then use `add` to grant access with the desired permission level.
To audit access: use `list` to see all current collaborators and their roles.
To revoke access: use `remove` with the target collaborator's open_id.
To check who can access: use `list` before making changes to avoid duplicate grants.

⚠️ The feishu_perm tool is disabled by default. It must be explicitly enabled before use — ask the user to enable it if permission operations fail.

## Actions

### List Collaborators

```json
{ "action": "list", "token": "ABC123", "type": "docx" }
```

Returns: members with member_type, member_id, perm, name.

### Add Collaborator

```json
{
  "action": "add",
  "token": "ABC123",
  "type": "docx",
  "member_type": "email",
  "member_id": "user@example.com",
  "perm": "edit"
}
```

### Remove Collaborator

```json
{
  "action": "remove",
  "token": "ABC123",
  "type": "docx",
  "member_type": "email",
  "member_id": "user@example.com"
}
```

## Token Types

| Type       | Description             |
| ---------- | ----------------------- |
| `doc`      | Old format document     |
| `docx`     | New format document     |
| `sheet`    | Spreadsheet             |
| `bitable`  | Multi-dimensional table |
| `folder`   | Folder                  |
| `file`     | Uploaded file           |
| `wiki`     | Wiki node               |
| `mindnote` | Mind map                |

## Member Types

| Type               | Description        |
| ------------------ | ------------------ |
| `email`            | Email address      |
| `openid`           | User open_id       |
| `userid`           | User user_id       |
| `unionid`          | User union_id      |
| `openchat`         | Group chat open_id |
| `opendepartmentid` | Department open_id |

## Permission Levels

| Perm          | Description                          |
| ------------- | ------------------------------------ |
| `view`        | View only                            |
| `edit`        | Can edit                             |
| `full_access` | Full access (can manage permissions) |

## Examples

Share document with email:

```json
{
  "action": "add",
  "token": "doxcnXXX",
  "type": "docx",
  "member_type": "email",
  "member_id": "alice@company.com",
  "perm": "edit"
}
```

Share folder with group:

```json
{
  "action": "add",
  "token": "fldcnXXX",
  "type": "folder",
  "member_type": "openchat",
  "member_id": "oc_xxx",
  "perm": "view"
}
```

## Configuration

```yaml
channels:
  feishu:
    tools:
      perm: true # default: false (disabled)
```

**Note:** This tool is disabled by default because permission management is a sensitive operation. Enable explicitly if needed.

## Permissions

Required: `drive:permission`
