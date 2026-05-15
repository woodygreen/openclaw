# 上下文工程与记忆设计

## 1. 上下文工程原则

基于 agents_rules.md §2 的验证，确立上下文工程核心原则：

| 原则 | 在 Supervisor 架构中的体现 |
|------|---------------------------|
| **角色隔离** | Supervisor transcript ≠ 子 agent transcript ≠ 用户 transcript ≠ tool result。各层有明确边界 |
| **信息裁剪** | 子 agent 只收到 task + 必要上下文片段，不是整个对话历史。Supervisor 做裁剪决策 |
| **格式控制** | Supervisor 给子 agent 的 task 是结构化 JSON，不是自然语言泛指 |
| **来源可信度分层** | Supervisor prompt 明确声明：自身拆解 > agent 结果 > 用户输入 > 模型猜测 |

## 2. 可信度分层实现

### 2.1 Prompt 内可信度声明

Supervisor 的 system prompt 必须包含可信度层级声明：

```markdown
## Information Credibility Hierarchy

When making decisions, trust information in this order:
1. **System Rules** (highest) — your own task decomposition logic, routing rules
2. **Agent Results** (high) — structured results from specialized agents
3. **User Input** (medium) — intent is trusted but specifics may be imprecise
4. **Model Guesses** (lowest) — any inference not backed by evidence must be verified

When conflict occurs:
- System rule overrides user input (e.g. routing rule overrides ambiguous request)
- Agent result overrides model guess (e.g. bitable data overrides estimated numbers)
- Fresh agent result overrides stale agent result (e.g. recent query overrides cached answer)
```

### 2.2 结果标注可信度

子 agent 产出 `AgentResult`（含 `confidence: number`，agent 自评可信度）。Supervisor 在回收时附加可信度标注，生成独立结构：

```typescript
// Supervisor adds credibility annotation on top of AgentResult
// Does NOT extend AgentResult — the original result is preserved intact
interface CredibilityAnnotatedResult {
  result: AgentResult                    // original agent result (with its self-assessed confidence)
  credibility: CredibilityAnnotation     // supervisor-added credibility assessment
}

interface CredibilityAnnotation {
  level: "system_rule" | "agent_result" | "user_input" | "model_guess"
  sourceAgentId: string
  domainExpertise: number        // 0-1, how well this agent's expertise matches the result domain
  freshness: number              // 0-1, how recent the result is
  // note: selfAssessedConfidence is available via result.confidence — no duplication
}
```

### 2.3 冲突时的可信度裁决

当两个结果冲突时，比较可信度得分：

```
可信度得分 = domainExpertise * 0.4 + freshness * 0.3 + selfAssessedConfidence * 0.2 + sourcePriority * 0.1

sourcePriority:
  system_rule = 1.0
  agent_result = 0.7
  user_input = 0.5
  model_guess = 0.2
```

这确保了 domain expert 的结果比通用 agent 的结果更可信，也确保了新鲜数据比旧数据更可信。

## 3. 子 Agent 上下文裁剪

### 3.1 裁剪原则

子 agent 不应该看到完整对话历史。只收到：

| 内容 | 来源 | 说明 |
|------|------|------|
| 结构化 Task | Supervisor | task_type、目标、约束、截止条件 |
| 限定范围 Tool Schema | Manifest | 只有 manifest 允许的 tool schema |
| 必要上下文片段 | Supervisor 选择 | 与当前 task 相关的对话片段（不是全量） |
| 用户原始消息 | Context Accumulator | 与当前 task 关联的用户消息原文 |

**不传递给子 agent 的**：
- 其他子 agent 的执行过程和中间结果（除非有数据依赖）
- 与当前 task 无关的历史对话
- Supervisor 的调度决策过程

### 3.2 上下文片段选择

Supervisor 根据任务相关性裁剪传递给子 agent 的对话片段：

```typescript
interface TaskContextFragment {
  relevantMessages: MessageSummary[]   // recent messages relevant to this task
  priorResults?: AgentResult[]         // results from prior tasks this task depends on
  userPreferences?: UserProfileSnapshot // relevant user preferences from materialized view
}

function selectContextFragments(task: SupervisorTask, fullHistory: ConversationHistory): TaskContextFragment {
  // 1. Select messages directly related to this task's parentMessageIds
  const directMessages = fullHistory.filter(m => task.parentMessageIds.includes(m.id));

  // 2. Select recent messages in same chat (last 5 messages for context)
  const recentContext = fullHistory.slice(-5);

  // 3. If task depends on prior results, include them
  const priorResults = task.dependsOn?.map(depId => executionBoard.finalizedResults.get(depId));

  // 4. Include relevant user preferences
  const preferences = getUserPreferencesForTask(task);

  return {
    relevantMessages: [...directMessages, ...recentContext],
    priorResults,
    userPreferences: preferences,
  };
}
```

### 3.3 子 Agent System Prompt 结构

```markdown
# Agent-{id} System Prompt

## Role
You are {label}. You handle tasks in: {capability domains}.
You DO NOT handle: {boundary domains}.

## Current Task
{structured task description in JSON}

## Available Tools
{manifest-bound tool schemas}

## Context
{selected context fragments}

## Constraints
- Stay within your declared capabilities
- If you need a tool outside your scope, send a cross-domain request to Supervisor
- Report confidence level in your results (0-1)
- If task is unclear, ask Supervisor for clarification rather than guessing
```

## 4. 记忆系统设计

### 4.1 现状

当前 OpenClaw 的记忆系统：
- `memory-host-sdk/`：session files + semantic search + embedding
- `memory flush`：between turns 的后台 compaction
- Persistent dedup：24h TTL，防止重复处理
- 没有：事件流模式、跨 session 聚合、物化视图、来源标注

### 4.2 事件流模式

子 agent 的关键产出以**事件**形式回流到 Supervisor，而不是直接写入共享 transcript：

```typescript
interface MemoryEvent {
  eventId: string
  eventType: "task_completed" | "task_failed" | "task_aborted" | "insight_generated" | "user_preference_observed"
  sourceAgentId: string
  taskId: string
  timestamp: number
  data: {
    output?: string                  // task output (if completed)
    error?: string                   // error message (if failed)
    insights?: Insight[]             // extracted insights
    preferenceUpdates?: PreferenceUpdate[] // observed user preferences
  }
  metadata: {
    confidence: number
    domain: string
    traceId: string
  }
}
```

事件流的好处：
- **审计性**：每条事件有 source_agent_id + trace_id，可溯源
- **可回滚**：事件是 append-only，物化视图从事件聚合，回滚只需重算物化视图
- **隔离性**：子 agent 只产事件，不直接写 Supervisor 的 transcript

### 4.3 物化视图

Supervisor 维护跨 agent 的物化视图——从事件流异步聚合：

```typescript
interface MaterializedView {
  userProfile: UserProfile            // aggregated user preferences and behavior patterns
  taskHistory: TaskHistorySummary[]   // summarized history of completed/failed tasks
  activeContext: ActiveContextState   // current conversation state and pending intents
}

interface TaskHistorySummary {
  taskId: string
  taskType: TaskType                  // operational task type
  agentId: string                     // which agent handled this task
  status: "completed" | "failed" | "aborted"
  summary: string                     // brief outcome description
  timestamp: number                   // when the task completed
}

interface ActiveContextState {
  chatId: string
  currentIntent?: IntentClassification // Supervisor's current intent classification
  pendingTaskIds: string[]             // tasks in pending queue for this chat
  runningAgentIds: string[]            // currently executing agents for this chat
  lastUserMessageTimestamp: number     // most recent user message time
}

interface UserProfile {
  userId: string
  preferences: PreferenceEntry[]      // aggregated from PreferenceUpdate events
  expertiseAreas: string[]            // inferred from conversation patterns
  commonTaskTypes: string[]           // most frequent task types
  preferredAgents: string[]           // agents with highest success rate for this user
  lastUpdated: number
}

interface PreferenceEntry {
  domain: string                     // e.g. "language", "format", "detail_level"
  value: string                      // e.g. "中文", "structured", "简洁"
  sourceAgentId: string              // which agent observed this preference
  confidence: number                 // how confident the observation is
  timestamp: number                  // when observed
  decayWeight: number                // current weight after time decay
}
```

物化视图的更新机制：

```typescript
async function updateMaterializedView(event: MemoryEvent): Promise<void> {
  switch (event.eventType) {
    case "user_preference_observed":
      // Update preference entries
      for (const update of event.data.preferenceUpdates) {
        await mergePreference(userProfile, update, event.sourceAgentId);
      }
      break;

    case "task_completed":
      // Update task history and success rate
      await recordTaskOutcome(taskHistory, event);
      await updateAgentSuccessRate(event.sourceAgentId, "success");
      break;

    case "task_failed":
      // Update task history and failure rate
      await recordTaskOutcome(taskHistory, event);
      await updateAgentSuccessRate(event.sourceAgentId, "failure");
      break;

    case "insight_generated":
      // Store as candidate knowledge (low confidence initially)
      await storeInsightCandidate(insights, event.data.insights, event.metadata);
      break;
  }
}
```

### 4.4 来源标注与可信度

每条记忆记录标注来源：

```typescript
interface AnnotatedMemoryEntry {
  content: string                    // memory content
  sourceAgentId: string              // which agent produced this
  sourceDomain: string               // agent's expertise domain
  sourceCredibility: number          // agent's credibility in this domain (0-1)
  observationTime: number            // when observed
  observationCount: number           // how many times this fact has been confirmed
  decayWeight: number                // current weight after time decay
  conflictingEntries?: string[]      // IDs of entries that conflict with this one
}
```

来源可信度计算：
- `sourceCredibility = domainExpertise(sourceAgentId, memoryDomain)`
- `agent-doc` 在 `feishu_doc` domain 的可信度 = 0.9（domain expert）
- `agent-chat` 在 `feishu_doc` domain 的可信度 = 0.3（通用 agent，非 domain expert）
- `agent-doc` 在 `ci` domain 的可信度 = 0.1（超出 expertise 范围）

### 4.5 时效衰减

```typescript
function calculateDecayWeight(entry: AnnotatedMemoryEntry, currentTime: number): number {
  const ageMs = currentTime - entry.observationTime;

  // Short-term hot info: high initial weight, fast decay
  if (isShortTermFact(entry)) {
    const halfLifeMs = 4 * 3600 * 1000; // 4 hours
    return entry.observationCount * Math.exp(-ageMs / halfLifeMs);
  }

  // Long-term stable preferences: slow decay, not easily deleted
  if (isLongTermPreference(entry)) {
    const halfLifeMs = 30 * 24 * 3600 * 1000; // 30 days
    return entry.observationCount * Math.exp(-ageMs / halfLifeMs);
  }

  // Default: moderate decay
  const halfLifeMs = 7 * 24 * 3600 * 1000; // 7 days
  return entry.observationCount * Math.exp(-ageMs / halfLifeMs);
}
```

### 4.6 冲突消解

当多条记忆冲突时：

```
冲突检测: 两条记忆对同一事实给出不同值
  │
  ├── 比较可信度得分
  │     credibleScore = sourceCredibility * decayWeight * observationCount
  │
  ├── 高可信度覆盖低可信度?
  │     如果 credibleScore(A) > 2 * credibleScore(B)
  │     → A 覆盖 B，B 标记为 "suppressed"
  │
  ├── 可信度接近?
  │     → 两条都保留，标记为 "conflicting"
  │     → Supervisor LLM 辅助裁决时考虑两条
  │
  └── 都是低可信度?
  │     → 两条都标记为 "candidate"，不写入物化视图
  │     → 等待更多观察来提升可信度
```

### 4.7 记忆写回策略

不是所有事件都需要持久化。写回过滤：

```typescript
function shouldPersistEvent(event: MemoryEvent): boolean {
  // High-value stable info: always persist
  if (event.eventType === "user_preference_observed") return true;
  if (event.eventType === "task_completed" && event.metadata.confidence > 0.8) return true;

  // Insights: persist only if confidence > 0.5
  if (event.eventType === "insight_generated" && event.metadata.confidence > 0.5) return true;

  // Failures: persist for analytics but not for user profile
  if (event.eventType === "task_failed") return true; // for success rate tracking

  // Aborted tasks: don't persist (user withdrew intent)
  if (event.eventType === "task_aborted") return false;

  return false;
}
```

## 5. Supervisor Transcript 与子 Agent Transcript 的关系

### 5.1 Transcript 分层

```
Supervisor Transcript:
  - 意图判断记录
  - 路由决策记录
  - 中断/注入决策记录
  - 结果组装记录
  - 不包含子 agent 的具体 tool call

Sub-Agent Transcript (per task):
  - PI Runner 的完整执行记录
  - Tool call 详细过程
  - 中间推理过程
  - 不包含 Supervisor 的决策过程

User Transcript (in channel):
  - 用户看到的最终回复
  - 不包含内部决策和执行过程
```

### 5.2 Compaction 策略

各层 transcript 的 compaction 独立进行：

| Transcript | Compaction 时机 | 保留内容 |
|-----------|----------------|---------|
| Supervisor | Supervisor session 上下文溢出 | 近期决策记录 + 物化视图摘要 |
| Sub-Agent | 子 agent session 上下文溢出 | 与当前 task 相关的 tool call + 结果 |
| Channel | 频道消息历史过长 | 近期用户消息 + 最终回复 |

### 5.3 跨层引用

Supervisor transcript 可以引用子 agent transcript（通过 traceId），但不包含其完整内容：

```typescript
// Supervisor transcript entry
interface SupervisorTranscriptEntry {
  type: "intent" | "routing" | "interrupt" | "inject" | "result_collection"
  timestamp: number
  content: string
  relatedTaskIds: string[]          // references to sub-agent task transcripts
  relatedTraceIds: string[]         // references to execution DAGs
}
```

这保证了 Supervisor transcript 紧凑（不含大量 tool call 详情），同时保持了完整的可审计链路——通过 traceId 可以随时追溯到子 agent 的详细执行过程。