# OpenClaw Dev 分支本地部署文档

## 概述

本文档说明如何在本地部署和验证 `dev` 分支上的新模块（agent-state、memory-layered、session-identity、tool-call-lifecycle、sse-standard）。

---

## 1. 前置条件

- **Node.js**: >= 22.x（项目使用 `node:sqlite` 等实验性内置模块）
- **pnpm**: >= 9.x（monorepo 包管理器）
- **Git**: 已安装
- **操作系统**: Windows 11（当前开发环境）

## 2. 克隆代码

```powershell
# 从 woodygreen 的 dev 分支拉取
git clone -b dev https://github.com/woodygreen/openclaw.git D:\MT\OpenClaw\dev
cd D:\MT\OpenClaw\dev
```

如果已有仓库，直接切换分支：

```powershell
cd D:\MT\OpenClaw\dev
git fetch woodygreen
git checkout dev
git pull woodygreen dev
```

## 3. 安装依赖

```powershell
cd D:\MT\OpenClaw\dev
pnpm install
```

> 注意：这是 monorepo（pnpm-workspace.yaml 含 packages/*、extensions/*），首次安装可能需要几分钟。

## 4. 运行测试

### 4.1 仅测试新模块（快速验证）

```powershell
npx vitest run src/agent-state/ src/memory-layered/ src/session-identity/ src/tool-call-lifecycle/ src/sse-standard/
```

期望结果：6 test files, 118 tests passed。

### 4.2 测试单个模块（针对性调试）

```powershell
# 状态机模块
npx vitest run src/agent-state/

# 长短记忆模块
npx vitest run src/memory-layered/

# 会话身份绑定模块
npx vitest run src/session-identity/

# 工具调用生命周期模块
npx vitest run src/tool-call-lifecycle/

# SSE 标准格式模块
npx vitest run src/sse-standard/
```

### 4.3 运行项目完整测试套件

```powershell
pnpm test
```

> 完整测试套件包含大量现有模块测试，耗时较长（10-30分钟），仅在做全面验证时运行。

## 5. 本地启动 OpenClaw

### 5.1 开发模式启动

```powershell
pnpm dev
```

这会运行 `node scripts/run-node.mjs`，启动 OpenClaw 的 gateway 服务。

### 5.2 构建后启动

```powershell
pnpm build:docker
pnpm start
```

### 5.3 配置飞书机器人

要验证飞书状态栏等新功能，需要配置飞书扩展：

1. 创建 `.env` 文件或在 config 中设置飞书凭据：
```
FEISHU_APP_ID=<your_app_id>
FEISHU_APP_SECRET=<your_app_secret>
```

2. 确保飞书机器人已在飞书开放平台注册并配置了事件订阅。

3. 启动 OpenClaw 后，在飞书群聊中发送消息触发机器人，观察卡片底部是否出现状态栏（显示 ● running 等状态）。

## 6. 新模块验证清单

| 模块 | 验证方式 | 期望结果 |
|---|---|---|
| **agent-state** | 运行 `npx vitest run src/agent-state/` | 38 tests passed |
| **memory-layered** | 运行 `npx vitest run src/memory-layered/` | 26 tests passed |
| **session-identity** | 运行 `npx vitest run src/session-identity/` | 21 tests passed |
| **tool-call-lifecycle** | 运行 `npx vitest run src/tool-call-lifecycle/` | 13 tests passed |
| **sse-standard** | 运行 `npx vitest run src/sse-standard/` | 20 tests passed |
| **飞书状态栏** | 在飞书群聊触发机器人对话 | 卡片底部显示彩色状态标签 |

## 7. 新模块文件结构

```
src/
├── agent-state/               # Task 1: 状态机
│   ├── types.ts               # 13个AgentState、转移图、标签、颜色
│   ├── state-machine.ts       # 状态机实现
│   ├── tui-status-bar-adapter.ts  # TUI状态映射
│   ├── feishu-status-bar-adapter.ts  # 飞书状态映射
│   ├── index.ts               # barrel export
│   ├── state-machine.test.ts  # 18 tests
│   └── status-bar-adapters.test.ts  # 20 tests
│
├── memory-layered/            # Task 2+3: 长短记忆分层
│   ├── types.ts               # MemoryLayer, MemoryPriority, 配置
│   ├── layered-store.ts       # 双层存储实现
│   ├── priority.ts            # 优先级排序
│   ├── dedup.ts               # §分隔符去重
│   ├── memory-scrubber.ts     # 流式压缩器 + 反抖动
│   ├── index.ts               # barrel export
│   └── memory-layered.test.ts # 26 tests
│
├── session-identity/          # Task 4: 会话身份绑定
│   ├── errors.ts              # SessionIdentityError
│   ├── session-identity.ts    # 会话身份存储
│   ├── feishu-chat-binding.ts # 飞书chat绑定
│   ├── helpers.ts             # bind/verify便捷函数
│   ├── index.ts               # barrel export
│   └── session-identity.test.ts  # 21 tests
│
├── tool-call-lifecycle/       # Task 5: 工具调用生命周期
│   ├── lifecycle-tracker.ts   # 7阶段追踪器
│   ├── lifecycle-validation.ts # 参数/权限校验
│   ├── index.ts               # barrel export
│   └── tool-call-lifecycle.test.ts  # 13 tests
│
├── sse-standard/              # Task 6+7: SSE标准格式
│   ├── sse-event-types.ts     # 7种SSE事件类型 + 格式化/解析
│   ├── tool-call-sse-fields.ts # 工具调用事件字段规范
│   ├── index.ts               # barrel export
│   └── sse-standard.test.ts   # 20 tests
│
extensions/feishu/src/
└── streaming-card.ts          # 修改: 增加status_bar元素和updateStatusBar方法
```

## 8. 与现有 runtime 的集成说明

新模块目前是独立的类型+逻辑层，尚未与 OpenClaw runtime 自动集成。要启用完整功能，需要手动在以下位置接入：

### 8.1 飞书状态栏（最直观的效果）

在飞书 `bot.ts` 或 `bot-content.ts` 的消息处理流程中：
```typescript
import { createAgentStateMachine } from "../../src/agent-state"
import { createFeishuStatusBarListener } from "../../src/agent-state/feishu-status-bar-adapter"

// 创建状态机
const sm = createAgentStateMachine({
  onStateChange: createFeishuStatusBarListener(streamingSession)
})

// 在流式卡片创建时传入 statusBar
const session = new FeishuStreamingSession(client, creds)
session.start(chatId, "chat_id", {
  statusBar: { label: "idle", color: "grey" },
  // ... other options
})

// 在agent运行时更新状态
sm.transition("running")
sm.transition("streaming")
sm.transition("completed")
```

### 8.2 会话身份绑定

在飞书消息处理入口：
```typescript
import { createSessionIdentityStore } from "../../src/session-identity"

const identityStore = createSessionIdentityStore({ strictOneSessionPerChat: true })

// 绑定会话
identityStore.bind(sessionId, senderOpenId, chatId, "feishu")

// 验证后续请求
if (!identityStore.verify(sessionId, currentSenderOpenId)) {
  // 拒绝非绑定用户的请求
}
```

### 8.3 SSE 标准格式

在 gateway SSE 输出中：
```typescript
import { formatSseMessage, SseEventType, createSseEvent } from "../../src/sse-standard"

// 替代或补充现有的 writeSse
res.write(formatSseMessage(createSseEvent(SseEventType.Token, {
  runId, sessionId, agentId, delta: textChunk
})))
```

### 8.4 长短记忆分层

在 memory-core extension 的短记忆管理中：
```typescript
import { createLayeredMemoryStore } from "../../src/memory-layered"

const memoryStore = createLayeredMemoryStore({
  shortTermMaxChars: 2200,
  longTermMaxChars: 1375,
})

// 添加短记忆
memoryStore.add({
  id: "st-session-xyz",
  content: "user prefers dark mode",
  layer: MemoryLayer.ShortTerm,
  priority: MemoryPriority.UserPreference,
  timestamp: Date.now(),
  tags: ["preference"],
  source: "session",
})

// 查看快照
const snapshot = memoryStore.snapshot()
```

## 9. 故障排查

| 问题 | 解决方案 |
|---|---|
| `pnpm install` 失败 | 确保 Node >= 22，pnpm >= 9；尝试 `pnpm install --no-frozen-lockfile` |
| vitest 找不到测试文件 | 确保在 `D:\MT\OpenClaw\dev` 目录下运行 |
| 飞书状态栏不显示 | 检查 `streaming-card.ts` 的 `start()` 是否传入了 `statusBar` 参数 |
| 测试超时 | 用 `npx vitest run <path>` 替代 `pnpm test`（后者运行全部测试） |
| git push 失败 | 确保 woodygreen remote 配置正确：`git remote add woodygreen https://github.com/woodygreen/openclaw.git` |