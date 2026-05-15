# 整体架构设计

## 1. 架构全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Channel Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Feishu      │  │  WhatsApp    │  │  Telegram    │  ...          │
│  │  Extension   │  │  Extension   │  │  Extension   │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│         │                │                │                          │
│         ▼                ▼                ▼                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Context Accumulator (消息观察窗口)                │   │
│  │  - 去抖合并 (inboundDebouncer)                                │   │
│  │  - 消息流聚合 (同类消息打包)                                    │   │
│  │  - 撤回事件拦截 (飞书撤回 → Supervisor 通知)                  │   │
│  │  - Dedup (persistent + in-memory)                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Supervisor Orchestrator                          │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────┐   │
│  │  Intent Engine  │  │  Agent Router   │  │  Result Collector │   │
│  │  (意图理解)      │  │  (任务路由)      │  │  (结果回收/组装)  │   │
│  │  LLM + 规则混合 │  │  精确/语义/广播  │  │  正常/异常/冲突   │   │
│  └─────────────────┘  └─────────────────┘  └───────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Execution Board                            │   │
│  │  Agent-A: [running] task-1 (doc write)                       │   │
│  │  Agent-B: [idle]                                              │   │
│  │  Agent-C: [running] task-2 (CI build)                        │   │
│  │  Pending Queue: task-3 → Agent-B, task-4 → Agent-B           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Interrupt Mgr   │  │  Withdrawal Mgr  │  │  Conflict Arb.   │  │
│  │  (中断子 agent)   │  │  (撤回处理)       │  │  (冲突仲裁)      │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Supervisor Memory (事件流 → 物化视图)                        │   │
│  │  - Cross-agent user profile                                   │   │
│  │  - Per-event source_agent_id + confidence_weight              │   │
│  │  - Time-decay + conflict resolution                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ (task assignment + manifest-bound tool schemas)
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Sub-Agent Layer                                │
│                                                                     │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐ │
│  │   Agent-A (Doc)   │ │   Agent-B (Data)  │ │   Agent-C (CI)    │ │
│  │                   │ │                   │ │                   │ │
│  │  Manifest:        │ │  Manifest:        │ │  Manifest:        │ │
│  │  feishu_doc       │ │  feishu_bitable   │ │  exec, gateway    │ │
│  │  feishu_wiki      │ │  web_search       │ │  cron             │ │
│  │  feishu_drive     │ │  feishu_chat      │ │  sessions_list    │ │
│  │                   │ │                   │ │                   │ │
│  │  PI Runner        │ │  PI Runner        │ │  PI Runner        │ │
│  │  (独立 transcript) │ │  (独立 transcript) │ │  (独立 transcript) │ │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘ │
│                                                                     │
│  ┌───────────────────┐                                              │
│  │   Agent-D (Chat)  │  (通用对话/问答，走单 agent fallback 路径)   │
│  │                   │                                              │
│  │  Manifest:        │                                              │
│  │  message, image   │                                              │
│  │  memory_search    │                                              │
│  │                   │                                              │
│  │  PI Runner        │                                              │
│  └───────────────────┘                                              │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ (results → Supervisor Result Collector)
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Output Layer                                   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Supervisor Reply Composer                        │   │
│  │  - 组装子 agent 产出为最终回复                                  │   │
│  │  - 撤回处理：调用飞书撤回 API                                   │   │
│  │  - 中间状态通知：typing indicator / block streaming            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Feishu      │  │  WhatsApp    │  │  Telegram    │              │
│  │  Reply       │  │  Reply       │  │  Reply       │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 核心组件职责

### 2.1 Context Accumulator

替代原有 SequentialQueue 的入站层。核心职责：

| 职责 | 说明 | 对应现有代码 |
|------|------|-------------|
| 去抖合并 | 同一用户同一 chat 的快速连续文本消息合并（保留现有 inboundDebouncer） | `extensions/feishu/src/monitor.message-handler.ts` 的 `inboundDebouncer` |
| 消息流聚合 | 观察窗口内的多条消息打包为一个完整的 user context | 新增 |
| 撤回事件拦截 | 飞书撤回事件不进消息队列，直接通知 Supervisor 的 Withdrawal Manager | 新增 |
| Dedup | 持久化 + 内存去重（保留现有机制） | `extensions/feishu/src/dedup.ts` + `extensions/feishu/src/processing-claims.ts` |

**关键变化**：从"一条消息 = 一个 queue entry = 一个 agent turn"改为"一个观察窗口内的消息流 = 一个 Supervisor 决策周期"。

### 2.2 Supervisor Orchestrator

系统的中枢调度器。由五个子系统组成：

| 子系统 | 职责 | 决策方式 |
|--------|------|----------|
| Intent Engine | 意图理解 + 整体判断 | 规则优先（命令检测、意图分类模板）→ LLM 辅助（复杂意图） |
| Agent Router | 任务拆解 + 子 agent 分配 | 精确匹配（意图类型 → agent manifest）→ 语义匹配（LLM rerank） |
| Execution Board | 全局执行状态管理 | 纯规则引擎，维护 agent 状态 + pending queue |
| Result Collector | 结果回收 + 组装回复 | 规则优先（正常/过期回收）→ LLM 辅助（冲突合并、复杂组装） |
| Interrupt/Withdrawal Mgr | 中断/注入/撤回决策 | 规则优先（撤回 → 直接中断）→ LLM 辅助（复杂注入判断） |

### 2.3 Sub-Agent

独立执行单元。每个子 agent：

- 有独立的 PI Runner 和 transcript（复用现有 `pi-embedded-runner`）
- 有 Manifest 限定可用 tool 范围（复用现有 PI Runner 的 tool construction plan 机制）
- 接收结构化 task（从 Supervisor），而非自然语言泛指
- 产出回流到 Supervisor Result Collector，而非直接发回复给用户

### 2.4 Output Layer

Supervisor Reply Composer 负责组装最终回复。子 agent 的产出不直接到达用户——这是一个根本性的架构变化。

## 3. 数据流

### 3.1 正常消息流（信息补充场景）

```
User: "帮我查项目A的进度"
  → Context Accumulator: 观察窗口开始计时

User: "也包括团队成员完成情况"
  → Context Accumulator: 消息聚合，观察窗口内追加

  → 观察窗口结束（超时或用户停止发送）
  → Context Accumulator 输出聚合 user context:
    "帮我查项目A的进度，也包括团队成员完成情况"

  → Supervisor Intent Engine: 意图 = "查询项目进度+团队信息"
  → Supervisor Agent Router: 路由到 Agent-B (Data)
  → Supervisor Execution Board: Agent-B 状态变为 [running] task-1

  → Agent-B 执行: feishu_bitable.list_records + feishu_chat.members
  → Agent-B 产出回流到 Supervisor Result Collector

  → Supervisor Reply Composer: 组装最终回复 → 发给用户
```

### 3.2 撤回场景

```
User: "帮我查项目A的进度"
  → Context Accumulator: 聚合
  → Supervisor: 路由到 Agent-B, 开始执行

User: 撤回原消息
  → Context Accumulator: 撤回事件拦截（不进消息队列）
  → Supervisor Withdrawal Mgr:
    (a) 检查 Execution Board: Agent-B 正在跑 → 发 interrupt
    (b) Agent-B 收到 interrupt → 停止执行
    (c) 检查 Agent-B 是否已发出中间回复 → 如有，调用飞书撤回 API
    (d) Execution Board: Agent-B 状态变为 [idle]
    (e) Supervisor 更新上下文状态: 意图已撤回
```

### 3.3 信息修正场景

```
User: "帮我查项目进度"
  → Supervisor: 路由到 Agent-B, 开始执行

User: "是项目A不是项目B"
  → Context Accumulator: 新消息到来
  → Supervisor Interrupt Mgr:
    - 判断: 这是信息修正，不是意图变更 → 注入而非中断
    - 将修正信息注入 Agent-B 的执行上下文
  → Agent-B: 调整查询参数，继续执行
```

### 3.4 跨域授权场景

```
User: "帮我写项目A的进度周报，同时查看最近的CI构建状态"
  → Supervisor: 拆解为 task-1(写文档) → Agent-A, task-2(查CI) → Agent-C
  → 两个 agent 并发执行

  Agent-A 执行中发现需要引用 CI 数据:
    → Agent-A 向 Supervisor 发跨域授权请求: "需要 CI 构建结果"
    → Supervisor: 检查 Agent-C 是否正在执行 task-2
      - 如果 Agent-C task-2 已完成 → 直接将结果授权给 Agent-A
      - 如果 Agent-C task-2 还在跑 → Agent-A yield 等待，或 Supervisor 调整 task-1 优先级
```

## 4. 与现有架构的映射

| 新架构组件 | 现有代码 | 改造方式 |
|-----------|---------|---------|
| Context Accumulator | `sequential-queue.ts` + `monitor.message-handler.ts` (inboundDebouncer) | 重构 SequentialQueue → Context Accumulator；保留 inboundDebouncer；新增撤回事件拦截 |
| Supervisor Orchestrator | 无（需新增） | 新增 `src/supervisor/` 目录 |
| Intent Engine | `src/auto-reply/reply/dispatch-from-config.ts` (slash command detection) + `src/auto-reply/reply/inbound-context.ts` | 扩展：在现有 inbound context resolution 上增加意图分类层 |
| Agent Router | `src/agents/agent-scope.ts` (agent config resolution) | 扩展：从"静态 agent ID 绑定"变为"动态路由" |
| Execution Board | `src/process/command-queue.ts` (lane management) + `src/sessions/session-write-lock.ts` | 替换：CommandQueue Lane 的 maxConcurrent=1 变为 Supervisor 主动调度 |
| Result Collector | `src/auto-reply/reply-dispatcher.ts` (直接发回复) | 重构：子 agent 产出 → Supervisor → 组装 → 发回复 |
| Interrupt/Withdrawal Mgr | `src/agents/tools/subagents-tool.ts` (steer/kill) | 扩展：从 agent 自管理变为 Supervisor 管理 |
| Supervisor Memory | `packages/memory-host-sdk/` (session files, semantic search) | 扩展：新增事件流 + 物化视图 + 跨 agent 聚合 |
| Sub-Agent (PI Runner) | `src/agents/pi-embedded-runner/` | 复用：保持现有 PI Runner 作为子 agent 执行引擎 |
| Sub-Agent Manifest | `src/agents/tool-catalog.ts` + `src/agents/tool-policy-pipeline.ts` | 重构：从"全量 catalog + 白名单过滤"变为"manifest-based 按需构建" |
| Sub-Agent Tool Injection | `src/agents/pi-tools.ts` (createOpenClawCodingTools) | 重构：从"全量构建 + pipeline 过滤"变为"manifest 范围内构建" |

## 5. 关键接口定义

### 5.1 AgentManifest

```typescript
interface AgentManifest {
  // Identity
  id: string                          // unique agent identifier (e.g. "agent-doc", "agent-data")
  label: string                       // human-readable label (e.g. "Document Operations")
  description: string                 // brief description for routing (max 200 chars)

  // Capability declaration
  capabilities: CapabilitySpec[]      // structured capability list
  boundaries: BoundarySpec[]          // explicit boundary constraints
  rejectPatterns: RejectPattern[]     // rejection rules for routing filtering

  // Tool scope
  toolIds: string[]                   // allowed tool IDs (manifest-bound filtering)
  toolGroups?: string[]               // allowed tool groups (e.g. "group:fs", "group:web")

  // Routing hints
  priority: number                    // conflict resolution priority (0-100, higher wins)
  taskTypes: TaskType[]               // supported task types for exact matching
  keywords: string[]                  // trigger keywords for rule-based matching

  // Context control
  maxContextTokens?: number           // max context window for this agent's tasks
  systemPromptTemplate?: string       // template ID for agent-specific system prompt

  // Compressed version for Supervisor routing
  summaryManifest: string             // ultra-short version (< 100 chars) for top-k screening
}
```

### 5.1a CapabilitySpec, BoundarySpec, RejectPattern

```typescript
interface CapabilitySpec {
  domain: string                      // e.g. "feishu_doc", "feishu_bitable", "ci_build"
  actions: string[]                   // e.g. ["read", "write", "append", "create"]
  scopeDescription: string            // natural language scope explanation
}

interface BoundarySpec {
  domain: string                      // boundary domain (e.g. "ci", "database", "payment")
  reason: string                      // why this boundary exists
  overrideAllowed: boolean            // can Supervisor override this boundary with explicit authorization?
}

interface RejectPattern {
  pattern: string                     // regex or keyword pattern (e.g. "CI|部署|构建")
  reason: string                      // explanation for the rejection
  redirectTo?: string                 // suggested alternative agent (e.g. "agent-ci")
}
```

### 5.2 SupervisorTask

```typescript
interface SupervisorTask {
  id: string                          // unique task identifier
  type: TaskType                      // task operation category (see §5.7 TaskType enum)
  description: string                 // structured task description
  targetAgentId: string               // assigned agent
  constraints: TaskConstraint[]        // boundary constraints from Supervisor
  priority: number                    // execution priority
  parentMessageIds: string[]          // originating user message IDs
  dependsOn?: string[]                // task IDs this task depends on (for sequential execution)
  deadlineMs?: number                 // optional execution deadline
  crossDomainRequests?: string[]      // pre-approved cross-domain tool IDs
  isFollowup?: boolean                // is this a followup task queued after a deferred task?
}
```

### 5.2a TaskConstraint

```typescript
interface TaskConstraint {
  type: "time_limit" | "scope_limit" | "resource_limit" | "side_effect_policy"
  value: string | number              // constraint value (e.g. "300000" for 5min time limit)
  description: string                 // human-readable constraint explanation
}
```

### 5.3 ExecutionBoard

```typescript
interface ExecutionBoard {
  // Per-agent state
  agents: Map<string, AgentExecState>

  // Task management
  pendingQueue: SupervisorTask[]       // FIFO + priority sort
  activeTasks: Map<string, SupervisorTask>

  // Result staging (temporary observation area for concurrency safety)
  stagingResults: Map<string, AgentResult>  // results not yet committed to main context
  finalizedResults: Map<string, FinalReply>  // committed, assembled results ready for delivery

  // Execution trace
  traceLog: ExecutionTrace[]

  // Board-level metrics (for routing decisions and observability)
  totalTasksCompleted: number
  totalTasksFailed: number
  averageLatencyMs: number
}

interface AgentExecState {
  agentId: string
  status: "idle" | "running" | "waiting" | "failed"
  currentTask?: SupervisorTask          // object reference (not just ID, for convenience)
  lastCompletedTask?: string            // ID of last completed task
  successRate: number                   // rolling success rate for routing decisions
  lastResult?: AgentResult              // last result from this agent
}
```

### 5.4 AgentResult

```typescript
interface AgentResult {
  taskId: string
  agentId: string
  status: "completed" | "failed" | "aborted"
  output: string                       // primary output text
  artifacts?: Artifact[]               // secondary outputs (files, URLs, etc.)
  toolCallTrace: ToolCallTraceEntry[]  // execution DAG for this result
  confidence: number                   // self-assessed confidence (0-1)
  crossDomainRequests?: string[]       // requested but unapproved cross-domain tools
  timestamp: number                    // when this result was produced
  traceId: string                      // composite trace ID for DAG linking and audit
}
```

### 5.4a Artifact, ToolCallTraceEntry, FinalReply

```typescript
interface Artifact {
  type: "file" | "url" | "image" | "table" | "document"
  content: string                      // file path, URL, or inline content
  label?: string                       // human-readable label
  metadata?: Record<string, string>    // extra info (e.g. mimeType, size)
}

interface ToolCallTraceEntry {
  stepId: string                       // unique step identifier within this task's trace
  parentStepId?: string                // for DAG edges (dependency tracking)
  toolName: string
  toolCallId: string
  input: any                           // tool call input (JSON)
  output: any                          // tool call output (JSON)
  startTime: number
  endTime: number
  durationMs: number
  status: "completed" | "failed" | "skipped"
  parallelGroup?: string               // steps in same parallelGroup executed concurrently
}

interface FinalReply {
  text: string                         // assembled reply text
  artifacts: Artifact[]                // all artifacts from participating agents
  traceId: string                      // composite trace ID (links to execution DAG)
  sourceAgentIds: string[]             // which agents contributed to this reply
}
```

### 5.5 WithdrawalEvent

```typescript
interface WithdrawalEvent {
  type: "message_recall"              // Feishu message recall
  messageId: string                    // the recalled message ID
  chatId: string
  accountId: string
  timestamp: number
  relatedTaskIds?: string[]           // tasks spawned from this message
}
```

### 5.6 IntentHint, MediaAttachment, Mention, RawMessage

These types are primarily used by the Context Accumulator (see [07-message-lifecycle.md](07-message-lifecycle.md) for detailed usage):

```typescript
interface IntentHint {
  type: IntentType                    // preliminary intent classification (see §5.7)
  keywords: string[]                  // detected keywords
  confidence: number                   // preliminary confidence (0-1, may be refined by Supervisor)
}

interface MediaAttachment {
  type: "image" | "file" | "audio" | "video" | "post"
  messageKey: string                   // Feishu message key for media retrieval
  fileName?: string
  fileSize?: number
}

interface Mention {
  userId: string                       // mentioned user's open_id
  name: string                         // mentioned user's display name
  isBotMention: boolean                // is this a mention of the bot itself
}

interface RawMessage {
  messageId: string
  chatId: string
  accountId: string
  senderId: string
  text: string                         // raw text content
  mediaAttachments: MediaAttachment[]
  mentions: Mention[]
  timestamp: number
  isRecalled: boolean                  // marked as recalled but kept in window (see §14 fix)
}
```

### 5.7 IntentType vs TaskType — 明确区分

**IntentType**（意图类别）用于 Supervisor 意图理解，描述"用户想要做什么语义层面的事"：

```typescript
type IntentType = "simple" | "compound" | "withdrawal" | "supplement" | "correction" | "ambiguous"
```

**TaskType**（任务操作类型）用于 SupervisorTask.type，描述"执行层面需要做什么操作"：

```typescript
type TaskType = "query" | "create" | "update" | "delete" | "chat" | "compound"
```

### 5.7a SubTaskSpec — 意图拆解的子任务规格

IntentType "compound" 拆解为多个 SubTaskSpec，每个子任务规格包含：

```typescript
interface SubTaskSpec {
  goal: string                        // what this sub-task should achieve
  targetAgentId?: string              // suggested agent (Router may override)
  taskType: TaskType                  // operational task type
  priorityHint?: number               // priority suggestion for Supervisor
  constraints?: TaskConstraint[]      // boundary constraints for this sub-task
}
```

**映射关系**：一个 IntentType 可能拆出多个 TaskType 不同的 task。例如：
- IntentType "compound" → 拆出 TaskType "create"（写文档）+ TaskType "query"（查 CI 数据）
- IntentType "withdrawal" → 不产生任何 TaskType（走 WithdrawalInterceptor）
- IntentType "supplement" → 不产生新 task（注入到现有 running task）

## 6. 模式选择

本架构是以下模式的**混合体**：

| 模式 | 在本架构中的体现 |
|------|----------------|
| Plan-and-Execute | Supervisor 规划 → 子 agent 执行 |
| Router | Supervisor 根据 manifest 路由到子 agent |
| Workflow+Agent | IM 对话流是半结构化 workflow：观察 → 判断 → 分发 → 收集 → 回复，中间有 agent 决策点 |
| Supervisor 多 Agent | 全局调度 + 仲裁 |
| Event-driven | 撤回事件、webhook 事件触发 Supervisor 决策（不走 turn-based 路径） |

不要试图把系统归入某个单一模式——生产系统是混合模式，不同场景激活不同子模式。