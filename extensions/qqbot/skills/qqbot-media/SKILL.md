---
name: qqbot-media
description: QQ富媒体收发 skill。当用户说发图片、传文件、发语音、发视频、send image、share file、attach media时，立即使用此 skill。即使用户没有明确说出 skill 名称，只要意图符合，也应触发。
metadata: { "openclaw": { "emoji": "📸", "requires": { "config": ["channels.qqbot"] } } }
allowed-tools: ["exec"]
---

# QQBot 富媒体收发

## 用法

```
<qqmedia>路径或URL</qqmedia>
```

系统根据文件扩展名自动识别类型并路由：

- `.jpg/.png/.gif/.webp/.bmp` → 图片
- `.silk/.wav/.mp3/.ogg/.aac/.flac` 等 → 语音
- `.mp4/.mov/.avi/.mkv/.webm` 等 → 视频
- 其他扩展名 → 文件
- 无扩展名的 URL → 默认按图片处理

## 接收媒体

- 用户发来的**图片**自动下载到本地，路径在上下文【附件】中，可直接用 `<qqmedia>路径</qqmedia>` 回发
- 用户发来的**语音**路径在上下文中；若有 STT 能力则优先转写

## 规则

1. **Always use absolute paths for media files**（以 `/` 或 `http` 开头）— relative paths are unstable across different runtime environments
2. **Wrap file paths with open/close <qqmedia> tags**：`<qqmedia>路径</qqmedia>`
3. **Write local files to the OpenClaw media directory before sending**：生成、下载或复制出的文件应写入 **`~/.openclaw/media/qqbot/`**（或其子目录），再写进 `<qqmedia>`。不要只放在 `~/.openclaw/workspace/` 等工作区根目录——平台安全策略只允许从 `~/.openclaw/media/`（含 `media/qqbot`）等受信根路径上传，否则会拦截、发不出去。
4. **Respect file size limits**：图片 30 MB（QQ platform limits image uploads to 30 MB）/ 视频 100 MB / 文件 100 MB / 语音 20 MB
5. **You can send local images directly** — wrap the path with `<qqmedia>` tags, never say "I cannot send files"
6. Do not repeat transcribed text when sending voice messages
7. Use separate `<qqmedia>` tags for each media item
8. Follow the capability description in the conversation context (e.g. do not send voice if not enabled)
