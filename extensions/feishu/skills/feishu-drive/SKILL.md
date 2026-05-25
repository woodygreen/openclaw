---
name: feishu-drive
description: |
  飞书云盘文件管理（list/create_folder/move/delete 等）。当用户说 "upload file"、"download"、"storage"、"cloud files"、"云盘"、"飞书云盘" 时，立即使用此 skill。即使用户没有明确说出 skill 名称，只要意图符合，也应触发。
---

# Feishu Drive Tool

Single tool `feishu_drive` for cloud storage operations.

## Token Extraction

From URL `https://xxx.feishu.cn/drive/folder/ABC123` → `folder_token` = `ABC123`

## Drive Workflow

To find a file: start with `list` to browse folders, then use `info` for details on a specific file.
To upload: use `upload` with the local file path and target folder_token.
To download: use `download` with the file_token.
To create a folder: first obtain a parent folder_token (e.g. from `list`), then use `create_folder`.
To move a file: use `move` with the file_token and destination folder_token.

⚠️ Bot accounts have no root folder by default — always use a folder_token obtained from `list` or shared by the user.

## Actions

### List Folder Contents

```json
{ "action": "list" }
```

Root directory (no folder_token).

```json
{ "action": "list", "folder_token": "fldcnXXX" }
```

Returns: files with token, name, type, url, timestamps.

### Get File Info

```json
{ "action": "info", "file_token": "ABC123", "type": "docx" }
```

Searches for the file in the root directory. Note: file must be in root or use `list` to browse folders first.

`type`: `doc`, `docx`, `sheet`, `bitable`, `folder`, `file`, `mindnote`, `shortcut`

### Create Folder

```json
{ "action": "create_folder", "name": "New Folder" }
```

In parent folder:

```json
{ "action": "create_folder", "name": "New Folder", "folder_token": "fldcnXXX" }
```

### Move File

```json
{ "action": "move", "file_token": "ABC123", "type": "docx", "folder_token": "fldcnXXX" }
```

### Delete File

```json
{ "action": "delete", "file_token": "ABC123", "type": "docx" }
```

## File Types

| Type       | Description             |
| ---------- | ----------------------- |
| `doc`      | Old format document     |
| `docx`     | New format document     |
| `sheet`    | Spreadsheet             |
| `bitable`  | Multi-dimensional table |
| `folder`   | Folder                  |
| `file`     | Uploaded file           |
| `mindnote` | Mind map                |
| `shortcut` | Shortcut                |

## Configuration

```yaml
channels:
  feishu:
    tools:
      drive: true # default: true
```

## Permissions

- `drive:drive` - Full access (create, move, delete)
- `drive:drive:readonly` - Read only (list, info)

## Known Limitations

- **Bots have no root folder**: Feishu bots use `tenant_access_token` and don't have their own "My Space". The root folder concept only exists for user accounts. This means:
  - `create_folder` without `folder_token` will fail (400 error)
  - Bot can only access files/folders that have been **shared with it**
  - **Workaround**: User must first create a folder manually and share it with the bot, then bot can create subfolders inside it
