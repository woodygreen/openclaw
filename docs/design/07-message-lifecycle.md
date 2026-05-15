# IM 消息流处理

## 1. 从 Turn-Based 到 Context-Stream-Based

### 1.1 现状问题

当前消息处理模型是 **turn-based**：

```
一条消息 → 一个 queue entry → 一个 agent turn → 一条回复
```

这不符合 IM 对话的真实行为。人在 IM 中的行为模式是：
- 快速发送多条消息，整体理解后才响应
- 后续消息可能是补充、修正、甚至撤回
- 不是逐条"收到→理解→回复"的机械流程

### 1.2 新模型：Context-Stream-Based

改为**消息流观察 + 整体理解 + 拟人响应**：

```
消息流 → 观察窗口 → 聚合 user context → Supervisor 整体理解 → 分发执行 → 回复
```

核心转变：**消息不再是独立的 turn trigger，而是构成连续的信息流**。Supervisor 在流的节点上做决策，而不是在每个消息上做决策。

## 2. Context Accumulator 设计

### 2.1 替代 SequentialQueue

Context Accumulator 替代 Feishu extension 的 SequentialQueue，作为入站层：

| SequentialQueue | Context Accumulator |
|-----------------|---------------------|
| 同 chat 严格 FIFO 串行 | 观察窗口内消息自然聚合 |
| 一条消息 = 一个 queue entry | 一个窗口内的消息流 = 一个决策周期 |
| 无撤回事件处理路径 | 撤回事件直接拦截 → Supervisor |
| 无意图变更检测 | 窗口内检测意图变更/补充/修正 |

### 2.2 组件结构

```typescript
interface ContextAccumulator {
  // Per-chat observation windows
  windows: Map<string, ObservationWindow>

  // Debouncer (reuse existing inboundDebouncer)
  debouncer: InboundDebouncer

  // Dedup (reuse existing persistent + in-memory)
  dedup: PersistentDedup
  processingClaims: ProcessingClaimsMap

  // Withdrawal event interceptor
  withdrawalInterceptor: WithdrawalInterceptor

  // Window timeout configuration
  defaultWindowTimeoutMs: number     // default: 3000ms
  maxWindowTimeoutMs: number         // max: 8000ms
  rapidSendThresholdMs: number       // if user sends within this interval, extend window
}
```

### 2.3 Observation Window

每个 chat 有一个观察窗口：

```typescript
interface ObservationWindow {
  chatId: string
  accountId: string
  messages: AccumulatedMessage[]      // messages accumulated in this window
  windowStartTime: number             // when the first message arrived
  windowDeadline: number              // when the window closes (extended with each new message)
  lastMessageTime: number             // timestamp of last received message
  intentHint?: IntentHint             // preliminary intent detection (updated with each message)
  state: "collecting" | "ready" | "dispatched"
}
```

### 2.4 消息流处理流程

```
Feishu event arrives
  │
  ├── Is it a withdrawal/recall event?
  │     → YES: route to WithdrawalInterceptor (see §3)
  │     → Skip normal accumulation flow
  │
  ├── Is it a duplicate? (processing claims check)
  │     → YES: drop silently
  │
  ├── Is it a rapid-fire text message? (debouncer check)
  │     → YES: add to debouncer buffer, don't open new window
  │     → Debouncer flush → add to existing window
  │
  ├── Is it a new conversation turn? (no active window for this chat)
  │     → YES: create new ObservationWindow
  │     → Set initial windowDeadline = now + defaultWindowTimeoutMs
  │
  ├── Is there an active window for this chat?
  │     → YES: add message to window, extend deadline
  │     → newDeadline = max(now + rapidSendThresholdMs, currentDeadline)
  │     → Cap at maxWindowTimeoutMs
  │
  └── Window deadline reached (timer fires)
       → Mark window as "ready"
       → Aggregate messages into user context
       → Dispatch to Supervisor
       → Mark window as "dispatched"
```

### 2.5 窗口超时策略

| 信号 | 动作 | 说明 |
|------|------|------|
| 用户发送消息 | 延长窗口 `rapidSendThresholdMs`（默认 1.5s） | 用户还在说，继续观察 |
| 窗口总时长超过 `maxWindowTimeoutMs`（默认 8s） | 强制关闭窗口 | 不能无限等待 |
| 窗口空闲超过 `defaultWindowTimeoutMs`（默认 3s） | 关闭窗口 | 用户似乎说完了 |
| 用户发送 `/` 开头的命令 | 立即关闭窗口 | 命令不需要聚合 |
| 用户发送撤回 | 立即触发 WithdrawalInterceptor | 不进窗口 |

这个策略模拟人的自然阅读行为：收到第一条消息后等一下，看用户是否还有补充，如果短时间内有新消息就继续等，等用户"说完"后再整体理解。

### 2.6 聚合输出

窗口关闭后，聚合消息为 Supervisor 可理解的 user context：

```typescript
interface AccumulatedUserContext {
  chatId: string
  accountId: string
  messages: RawMessage[]              // original messages (with metadata)
  aggregatedText: string              // merged text content
  intentHint: IntentHint              // preliminary intent detection
  mediaAttachments: MediaAttachment[] // images, files, etc.
  mentions: Mention[]                 // @mentions
  threadKey?: string                  // thread ID if threaded conversation
  senderId: string
  windowDurationMs: number            // how long the window was open
}
```

## 3. 撤回事件处理

### 3.1 飞书撤回事件

飞书的消息撤回产生 `im.message.recall_v1` 事件。当前架构没有处理这个事件。

### 3.2 WithdrawalInterceptor

撤回事件不进 Context Accumulator 的消息窗口，而是直接进入 WithdrawalInterceptor：

```typescript
interface WithdrawalInterceptor {
  // Route withdrawal events directly to Supervisor
  handleWithdrawal(event: FeishuRecallEvent): Promise<void>
}

async function handleWithdrawal(event: FeishuRecallEvent): Promise<void> {
  // 1. Find which task(s) were spawned from the recalled message
  const relatedTasks = executionBoard.findTasksByParentMessageId(event.messageId);

  // 2. For each related task:
  for (const task of relatedTasks) {
    // a. Check if task's agent is still running
    const agentState = executionBoard.agents.get(task.targetAgentId);
    if (agentState?.status === "running") {
      // b. Send interrupt to the agent
      await supervisor.interruptAgent(task.targetAgentId, {
        reason: "user_message_recalled",
        messageId: event.messageId,
      });
    }

    // c. Check if agent already sent intermediate reply
    const intermediateReplies = getIntermediateRepliesForTask(task.id);
    for (const reply of intermediateReplies) {
      // d. Withdraw the reply via Feishu API
      await feishuChannel.deleteMessage(reply.channelMessageId);
    }

    // e. Update Execution Board
    executionBoard.markTaskAborted(task.id, "user_recall");
  }

  // 3. Update Supervisor context state
  supervisorState.recordWithdrawal(event.messageId, event.chatId);

  // 4. If there's an active ObservationWindow for this chat, mark the recalled message
  const window = contextAccumulator.windows.get(`${event.accountId}:${event.chatId}`);
  if (window) {
    // Don't delete recalled messages from the window — mark them as recalled
    // This preserves conversation continuity for intent understanding
    const recalledMsg = window.messages.find(m => m.messageId === event.messageId);
    if (recalledMsg) {
      recalledMsg.isRecalled = true;
    }

    // If the first/primary message in window is recalled, check remaining completeness
    const firstNonRecalled = window.messages.find(m => !m.isRecalled);
    if (!firstNonRecalled) {
      // All messages in window were recalled → close window, don't dispatch to Supervisor
      window.state = "dispatched";  // mark as dispatched to prevent further processing
      return;
    }
  }
}
```

### 3.3 飞书撤回 API 调用

撤回已发出的回复需要调用飞书消息撤回 API：

```typescript
// Feishu message recall API
// POST /open-apis/im/v1/messages/{message_id}?user_id_type=open_id
// Requires: app message created by the bot itself

async function recallFeishuMessage(messageId: string, accountId: string): Promise<boolean> {
  const client = getFeishuClient(accountId);
  try {
    await client.im.message.delete({ path: { message_id: messageId } });
    return true;
  } catch (error) {
    // Message may have been already recalled or not found
    logger.warn(`Failed to recall Feishu message ${messageId}: ${error.message}`);
    return false;
  }
}
```

**限制**：飞书只允许撤回 bot 自己发出的消息，且有时间限制（通常 24h 内）。超出限制的消息无法撤回。

### 3.4 撤回场景矩阵

| 场景 | 处理 |
|------|------|
| 用户撤回消息，子 agent 还在执行 | 中断子 agent，丢弃结果 |
| 用户撤回消息，子 agent 已完成但未回复 | 丢弃结果，不发回复 |
| 用户撤回消息，子 agent 已发出中间回复 | 中断子 agent + 撤回中间回复 |
| 用户撤回消息，Supervisor 已发出最终回复 | 撤回最终回复 |
| 用户撤回消息，但相关 task 已过期回收 | 无需额外操作 |
| 用户撤回消息，撤回 API 调用失败 | 记录失败，告知用户"无法自动撤回回复" |

## 4. 信息补充与修正处理

### 4.1 窗口内补充（最简场景）

用户在观察窗口内发送补充消息——这是最自然的场景，Context Accumulator 直接处理：

```
User: "帮我查项目进度"
  → Window opens, deadline set to now + 3s

User: "也包括团队成员"
  → Window extended, message added

  → Window closes (3s after last message)
  → Aggregated: "帮我查项目进度，也包括团队成员"
  → Supervisor: 意图 = 查询项目进度+团队 → Agent-B
```

窗口内补充不需要 Supervisor 介入——因为观察窗口本身就是聚合机制。

### 4.2 窗口外补充（跨窗口注入）

用户在窗口已关闭、子 agent 正在执行时发送补充信息：

```
User: "帮我查项目进度"
  → Window closed, dispatched to Agent-B

  (Agent-B is running...)

User: "是项目A不是项目B"
  → New message arrives, no active window
  → Create new window? OR inject into running task?

  → Supervisor decision:
    - Is this a supplement/correction to the current task? → Inject
    - Is this a new unrelated intent? → New window → new task
```

判断逻辑：

```typescript
function classifyFollowupMessage(
  newMessage: RawMessage,
  currentExecutionContext: ExecutionContext
): FollowupClassification {
  // 1. Check if same chat + same user + same topic
  if (isSameChatAndUser(newMessage, currentExecutionContext)) {
    // 2. Check if message semantically relates to current task
    const relationScore = semanticRelationScore(newMessage, currentExecutionContext.currentTask);
    if (relationScore > 0.7) {
      // Likely supplement/correction
      return { type: "inject", targetTaskId: currentExecutionContext.currentTask.id };
    }
    if (relationScore > 0.3) {
      // Ambiguous — need LLM to clarify
      return { type: "needs_llm_classification" };
    }
    // Unrelated — new intent
    return { type: "new_intent" };
  }

  return { type: "new_intent" };
}
```

### 4.3 注入实现

注入使用现有的 steer 机制（`sessions_send` / `subagents steer`），但由 Supervisor 自动触发而非用户手动操作：

```typescript
async function injectIntoRunningAgent(agentId: string, taskId: string, injectionMessage: string): Promise<void> {
  // Get session info from ExecutionBoard's AgentExecState (runtime state, not task definition)
  const agentState = executionBoard.agents.get(agentId);
  if (!agentState?.currentTask) return;

  // Use existing steer mechanism
  await steerAgentSession(agentState.currentTask.id, {
    message: injectionMessage,
    type: "supervisor_inject",
    metadata: {
      injectionReason: "supplement" | "correction",
    },
  });
}
```

### 4.4 修正 vs 补充 vs 意图变更

| 分类 | 信号 | 处理 |
|------|------|------|
| **补充** | "也包括..."、"还有..."、"加上..." | 注入当前执行，不中断 |
| **修正** | "不是A而是B"、"只查本周"、"错了，应该是..." | 注入当前执行，标记为修正（agent 应调整参数） |
| **意图变更** | "算了不用了"、"取消"、"换个..." | 中断当前执行，分发新意图 |
| **撤回** | 飞书撤回事件 | 中断 + 撤回回复 |
| **全新意图** | 不相关的新话题 | 不中断当前，新开 task 分发到其他 agent |

## 5. 观察窗口与现有机制的整合

### 5.1 保留的机制

| 机制 | 保留原因 | 改造方式 |
|------|----------|----------|
| inboundDebouncer | 去抖合并是刚需 | 保留在 Context Accumulator 内部，作为窗口内子机制 |
| persistent dedup | 防止重复处理 | 保留，在窗口关闭前做最终 dedup 检查 |
| processing claims | 防止并发处理同一消息 | 保留，但检查时机从"消息到达时"改为"窗口关闭时" |
| Feishu challenge response | URL verification | 保留，不经过 Context Accumulator |

### 5.2 替换的机制

| 机制 | 替换原因 | 替换为 |
|------|----------|--------|
| SequentialQueue | 逐条排队不符合 IM 行为 | Context Accumulator + ObservationWindow |
| CommandQueue Lane (per-chat) | 同 chat 串行约束过强 | Supervisor 主动调度（不同 task 可并发） |
| FollowupQueue (steer/followup) | 队列模式是被动策略 | Supervisor 主动判断：inject/interrupt/new_task |

### 5.3 与飞书 Extension 的集成

Context Accumulator 位于 Feishu extension 的 `monitor.message-handler.ts` 层。改造点：

```typescript
// Current: createFeishuMessageReceiveHandler creates SequentialQueue + debouncer
// New: createFeishuMessageReceiveHandler creates ContextAccumulator

const handler = createFeishuMessageReceiveHandler({
  // Replace SequentialQueue with ContextAccumulator
  accumulator: createContextAccumulator({
    defaultWindowTimeoutMs: config.windowTimeout ?? 3000,
    maxWindowTimeoutMs: config.maxWindowTimeout ?? 8000,
    rapidSendThresholdMs: config.rapidSendThreshold ?? 1500,
  }),

  // Add withdrawal event handler
  withdrawalHandler: createWithdrawalInterceptor(supervisorRef),

  // Keep existing debouncer as sub-mechanism
  debouncer: core.channel.debounce.createInboundDebouncer(...),

  // Keep existing dedup
  dedup: createPersistentDedupe(...),
  claims: createProcessingClaimsMap(),
});
```

新增 Feishu event handler 注册：

```typescript
// In registerEventHandlers (monitor.account.ts)
// Add withdrawal/recall event handler
dispatcher.register({
  name: "im.message.recall_v1",
  handler: async (event) => {
    const payload = parseFeishuRecallEventPayload(event);
    await withdrawalInterceptor.handleWithdrawal(payload);
  },
});
```

## 6. 消息流状态机

整个消息流从到达到回复，经历以下状态：

```
Message lifecycle state machine:

  ARRIVED → dedup check
    → duplicate → DROPPED
    → new → DEDUPED

  DEDUPED → debouncer check
    → rapid-fire text → DEBOUNCED (buffered)
    → normal → WINDOWED

  DEBOUNCED → debouncer flush
    → WINDOWED (merged into existing window)

  WINDOWED → window timeout
    → READY (aggregated user context)

  WITHDRAWAL → bypass window → WITHDRAWN
    → direct to Supervisor WithdrawalInterceptor

  READY → Supervisor dispatch
    → PENDING_DECISION (Supervisor doing intent classification, may involve LLM call)

  PENDING_DECISION → decision completes
    → RUNNING (task assigned to agent)

  PENDING_DECISION → race condition handling
    → new supplement/correction arrives → APPEND_SUPPLEMENT (queue supplement, continue decision)
    → new withdrawal arrives → CANCEL_DECISION (cancel LLM call, process withdrawal)
    → new unrelated intent arrives → NEW_WINDOW (start new decision cycle independently)

  APPEND_SUPPLEMENT → decision completes
    → RUNNING (supplement merged into task constraints)

  RUNNING → agent execution
    → COMPLETED (result ready)
    → FAILED (execution error)
    → ABORTED (Supervisor interrupt or user withdrawal)

  COMPLETED → Supervisor collection
    → REPLYING (composing final reply)

  REPLYING → channel delivery
    → DELIVERED (reply sent to user)
    → RECALLED (reply withdrawn by Supervisor)
```

## 7. 配置参数

| 参数 | 默认值 | 说明 | 配置来源 |
|------|--------|------|----------|
| `windowTimeoutMs` | 3000 | 观察窗口基础超时 | channel config / openclaw.yaml |
| `maxWindowTimeoutMs` | 8000 | 观察窗口最大超时 | channel config |
| `rapidSendThresholdMs` | 1500 | 快速发送延长窗口 | channel config |
| `debounceMergeWindowMs` | 500 | 去抖合并窗口 | 保留现有配置 |
| `dedupTTLMs` | 86400000 (24h) | 去重 TTL | 保留现有配置 |
| `claimTTLMs` | 300000 (5min) | 处理声明 TTL | 保留现有配置 |