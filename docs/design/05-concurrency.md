# 并发控制与冲突解决

## 1. 并发模型：从被动排队到主动调度

### 1.1 现状问题

当前三层锁是被动排队机制：

| 锁 | 机制 | 问题 |
|----|------|------|
| SequentialQueue | 同 chat FIFO Promise chain | 同 chat 内所有消息严格串行，无法并发规划 |
| CommandQueue Lane | maxConcurrent=1 | 同 session 内所有 agent turn 严格串行 |
| SessionWriteLock | 文件锁保护 transcript | 硬性串行保障，无法协调 |

问题核心：**没有全局调度者决定哪些操作可以并发、哪些必须串行**。排队是"不管三七二十一先锁住"，而不是"分析依赖后按需调度"。

### 1.2 新架构并发模型

Supervisor 作为全局调度者，**主动决定并发策略**：

| 层级 | 并发策略 | 决策者 |
|------|----------|--------|
| Agent 间 | 不同 agent 的 task 天然并发 | Supervisor（Execution Board 状态） |
| Agent 内 | 同一 agent 的多个 task 默认串行 | Supervisor（可主动合并为复合 task） |
| Tool 间 | 无依赖的 tool call 可以并发 | 子 agent 的 PI Runner（模型自选 + 依赖检测） |
| 消息间 | 观察窗口内并发积累，窗口后统一分发 | Context Accumulator |

关键变化：**并发决策权从"锁机制"转移到"Supervisor 判断"**。

### 1.3 并发场景矩阵

| 场景 | 是否并发 | 原因 |
|------|----------|------|
| 用户要求同时查项目进度+团队信息 | **并发** | 不同 agent（Agent-B 数据查询）的不同 task |
| 用户要求写文档+同时查数据 | **并发** | Agent-A（写）和 Agent-B（查）独立 |
| 用户要求写文档引用 CI 数据 | **串行或半并发** | Agent-A 需要 Agent-C 的结果 → 有依赖 |
| 同一用户同一话题的两条补充消息 | **合并** | 不并发，合并为一个 task |
| Agent-A 执行中，用户补充信息 | **注入** | 不开新 task，注入当前执行 |
| Agent-A 执行中，用户意图改变 | **中断+新 task** | 并发执行中断+新意图分发 |

## 2. Execution Board — 主动调度面板

### 2.1 Board 数据结构

ExecutionBoard 的 canonical 定义见 [02-architecture.md §5.3](02-architecture.md)。核心字段：

- `agents: Map<string, AgentExecState>` — 每个 agent 的执行状态
- `pendingQueue: SupervisorTask[]` — FIFO + priority sort 的待分配队列
- `stagingResults: Map<string, AgentResult>` — 临时观察区（见 §3）
- `finalizedResults: Map<string, FinalReply>` — 已提交的组装结果
- `traceLog: ExecutionTrace[]` — 全局执行 trace
- `totalTasksCompleted / totalTasksFailed / averageLatencyMs` — Board-level metrics

### 2.2 调度决策流程

```
新 task 进入 Supervisor
  │
  ├── 检查 Execution Board
  │     ├── 目标 agent idle → 立即分配
  │     ├── 目标 agent running →
  │     │     ├── task 可与当前 task 合并 → 合并注入
  │     │     ├── task 独立 → 排入 pending queue
  │     │     └── task 紧急（用户撤回等） → 中断当前 task
  │     ├── 目标 agent failed →
  │     │     ├── 检查失败原因 → 可恢复 → 重试
  │     │     └── 不可恢复 → 换 agent 或告知用户
  │     └── 无匹配 agent → fallback 到 agent-chat
  │
  ├── 更新 Execution Board 状态
  │
  └── 记录 ExecutionTrace
```

### 2.3 Task 依赖检测

Supervisor 在拆解任务时检查依赖：

```typescript
interface TaskDependency {
  taskId: string
  dependsOn: string[]         // task IDs that must complete before this task
  dependencyType: "data" | "parameter" | "ordering" | "none"
}

// Dependency resolution
function resolveTaskDependencies(tasks: SupervisorTask[]): TaskDependency[] {
  // Known dependency templates:
  // - "写文档引用CI数据" → write_task depends on ci_task (data dependency)
  // - "查询后更新bitable" → update_task depends on query_task (parameter dependency)

  // For unknown cases: LLM-assisted dependency detection
  // (lightweight call to determine if tasks have data/parameter dependencies)
}
```

依赖关系决定了并发策略：
- `dependencyType: "none"` → 两个 task 并发执行
- `dependencyType: "data" | "parameter"` → 有依赖的 task 串行执行
- `dependencyType: "ordering"` → 按顺序执行但不需要数据传递

## 3. 临时观察区与结果合并

### 3.1 临时观察区（Staging Area）

子 agent 的 tool call 结果不直接写入共享 transcript，而是先写入**临时观察区**：

```
Tool call result
  │
  ├── 写入 staging area（临时观察区）
  │     ├── key: trace_id + step_id
  │     ├── value: tool name, input, output, timestamp
  │     ├── status: "pending" (not yet committed)
  │
  ├── Supervisor 或子 agent 确认结果有效
  │     → commit: 从 staging 移到 finalized
  │
  ├── Supervisor 判断结果过期/不需要
  │     → discard: 从 staging 删除
  │
  └── 子 agent 的后续 tool call 需要引用前一个结果
  │     → 从 staging area 读取（而不是从 transcript）
  │     → 这保证了并发结果的一致性
```

### 3.2 统一合并

Supervisor 收集所有子 agent 的 staging results 后，统一合并为最终回复：

```typescript
function mergeResults(results: AgentResult[]): FinalReply {
  // 1. Simple case: single result
  if (results.length === 1 && results[0].status === "completed") {
    return {
      text: results[0].output,
      artifacts: results[0].artifacts,
      traceId: results[0].traceId,
    };
  }

  // 2. Multiple independent results: concatenate
  if (results.every(r => r.status === "completed" && !hasConflicts(results))) {
    return {
      text: results.map(r => r.output).join("\n\n---\n\n"),
      artifacts: results.flatMap(r => r.artifacts),
      traceId: generateCompositeTraceId(results),
    };
  }

  // 3. Conflicting results: needs arbitration
  // → Delegate to Conflict Arbitrator (see section 4)
}
```

## 4. 冲突解决机制

### 4.1 冲突类型

| 冲突类型 | 示例 | 解决方式 |
|----------|------|----------|
| Claim 冲突 | 两个 agent 都 claim 同一任务 | 优先级仲裁 |
| 结果矛盾 | Agent-A 和 Agent-B 对同一查询返回不同数据 | 来源可信度裁决 |
| 边界冲突 | 两个 agent 尝试操作同一资源（如同一 bitable record） | 操作序列化 |
| 时序冲突 | 后到的结果与先到的结果矛盾 | 时间戳+可信度裁决 |

### 4.2 三级递进解决

```
冲突检测
  │
  ├── Level 1: 优先级仲裁（规则，< 10ms）
  │     → 比较 manifest.priority
  │     → 高优先级者胜
  │     → 如果优先级相同 → 进入 Level 2
  │
  ├── Level 2: 来源可信度裁决（规则，< 50ms）
  │     → 比较结果的 source_agent_id 和 domain expertise
  │     → domain expert 的结果可信度更高
  │     → agent-doc 关于文档的数据 > agent-data 关于文档的数据
  │     → 如果仍然无法判断 → 进入 Level 3
  │
  └── Level 3: LLM 裁决（语义判断，< 3s）
       → Supervisor 调轻量级 LLM 比较两个结果
       → LLM 判断哪个更合理 / 是否可以合并
       → 裁决结果写入 Execution Board trace
```

### 4.3 Claim 冲突处理

```typescript
function resolveClaimConflict(claims: [AgentManifest, SupervisorTask][]): AgentManifest {
  // Sort by priority (descending)
  const sorted = claims.sort((a, b) => b[0].priority - a[0].priority);

  // If top two have same priority
  if (sorted.length >= 2 && sorted[0][0].priority === sorted[1][0].priority) {
    // Check domain expertise match
    const match0 = domainExpertiseMatch(sorted[0][0], sorted[0][1]);
    const match1 = domainExpertiseMatch(sorted[1][0], sorted[1][1]);
    if (match0 !== match1) return match0 > match1 ? sorted[0][0] : sorted[1][0];

    // Fallback to LLM arbitration (Level 3)
    return llmArbitrateClaim(sorted);
  }

  return sorted[0][0]; // highest priority wins
}
```

### 4.4 结果矛盾处理

```typescript
function resolveResultConflict(results: AgentResult[]): ConflictResolution {
  // Level 2: source credibility
  const domainExperts = results.map(r => ({
    result: r,
    credibility: domainCredibilityScore(r.agentId, r.toolCallTrace),
  }));

  const sorted = domainExperts.sort((a, b) => b.credibility - a.credibility);

  if (sorted[0].credibility > sorted[1].credibility * 1.5) {
    // Clear winner by credibility
    return { type: "take_one", winner: sorted[0].result };
  }

  // Level 3: LLM arbitration
  return llmArbitrateResults(results);
}
```

## 5. 结果回收策略

### 5.1 四种回收路径

| 路径 | 触发条件 | 处理 | 用户体验 |
|------|----------|------|----------|
| **正常回收** | 子 agent 成功完成，产出到达 | Supervisor 组装回复 → 发给用户 | 收到完整回复 |
| **异常回收** | 子 agent 执行失败 | Supervisor 决定：重试 / 换 agent / 告知用户 | 收到部分回复或错误提示 |
| **冲突回收** | 多个 agent 结果矛盾 | 裁决 → 取其一 / 合并 / 重跑 | 收到合并回复或裁决结果 |
| **过期回收** | 用户意图已变更或撤回 | 丢弃，不发回复 | 无回复或收到撤回通知 |

### 5.2 异常回收策略

```typescript
async function handleAbnormalResult(result: AgentResult): Promise<AbnormalHandlingDecision> {
  // Classify failure type
  const failureType = classifyFailure(result);

  switch (failureType) {
    case "rate_limit":
      return { action: "retry", delayMs: 5000, maxRetries: 3 };

    case "auth_failure":
      return { action: "switch_agent", targetAgentId: "agent-chat" };

    case "tool_error":
      // Check if another agent can handle this task
      const alternativeAgent = findAlternativeAgent(result.taskId);
      if (alternativeAgent) {
        return { action: "switch_agent", targetAgentId: alternativeAgent.id };
      }
      return { action: "inform_user", message: "无法完成此任务，请稍后重试" };

    case "timeout":
      return { action: "retry_with_longer_timeout", timeoutMs: 30000 };

    case "context_overflow":
      return { action: "compact_and_retry" };

    default:
      return { action: "inform_user", message: "执行出错，请重新描述需求" };
  }
}
```

### 5.3 过期回收处理

```typescript
async function handleExpiredResult(result: AgentResult): Promise<void> {
  // Check if user intent has changed since this task was assigned
  const currentIntent = supervisorState.currentIntent;
  const taskIntent = executionBoard.activeTasks.get(result.taskId)?.intent;

  if (currentIntent !== taskIntent || currentIntent === "withdrawn") {
    // Result is stale — discard
    executionBoard.stagingResults.delete(result.taskId);
    logger.info(`Discarded expired result for task ${result.taskId}`);
    return;
  }

  // Intent hasn't changed — treat as normal result
  await handleNormalResult(result);
}
```

## 6. 可回放执行 DAG

### 6.1 Trace 结构

每次任务执行产生可回放 DAG：

```typescript
interface ExecutionTrace {
  traceId: string                       // composite trace ID (supervisor:session:task)
  taskId: string
  agentId: string
  steps: ToolCallTraceEntry[]           // see 02-architecture.md §5.4a for canonical definition
  startTime: number
  endTime: number
  totalDurationMs: number
  status: "completed" | "failed" | "aborted"
}

// ToolCallTraceEntry is the canonical trace step type (defined in 02-architecture.md §5.4a)
// Key fields: stepId, parentStepId?, toolName, toolCallId, input, output,
//             startTime, endTime, durationMs, status, parallelGroup?
```

### 6.2 Trace 收集

PI Runner 的 `runToolLifecycle()` 已有 tool call 前后 hook。扩展为收集 trace 信息：

```typescript
// In runToolLifecycle (extended)
async function runToolLifecycleWithTrace(toolCall: ToolCall, context: RunContext): Promise<ToolResult> {
  const stepId = generateStepId();
  const startTime = Date.now();

  // Before: emit trace start event
  emitTraceEvent({
    traceId: context.traceId,
    stepId,
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    input: toolCall.input,
    startTime,
    status: "running",
  });

  try {
    const result = await tool.execute(toolCall.id, toolCall.input, context.signal);

    // After: emit trace complete event
    emitTraceEvent({
      traceId: context.traceId,
      stepId,
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      output: result,
      endTime: Date.now(),
      durationMs: Date.now() - startTime,
      status: "completed",
    });

    return result;
  } catch (error) {
    emitTraceEvent({
      traceId: context.traceId,
      stepId,
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      output: { error: error.message },
      endTime: Date.now(),
      durationMs: Date.now() - startTime,
      status: "failed",
    });
    throw error;
  }
}
```

### 6.3 DAG 可回放用途

- **事后审计**：用户投诉回复错误 → 查 trace DAG 找到出错环节
- **失败诊断**：task 失败 → 查 DAG 找到失败的 step 和原因
- **性能分析**：统计各 tool 的平均耗时、并发利用率
- **重放**：相同输入重放 tool call，验证幂等性

## 7. 幂等性保障

### 7.1 幂等键设计

涉及副作用操作的 tool call 需加幂等键：

```typescript
interface IdempotentToolCall {
  toolCallId: string                    // LLM-generated call ID
  idempotencyKey: string                // derived from: agentId + taskId + toolName + inputHash
  toolName: string
  input: any
}

// Key derivation
function deriveIdempotencyKey(params: {
  agentId: string,
  taskId: string,
  toolName: string,
  input: any,
}): string {
  const inputHash = hash(JSON.stringify(params.input));
  return `${params.agentId}:${params.taskId}:${params.toolName}:${inputHash}`;
}
```

### 7.2 需要幂等键的 Tool

| Tool | 副作用类型 | 幂等策略 |
|------|-----------|----------|
| feishu_doc (write/append/insert/create) | 文档写入 | 同一 doc_token + content hash → 跳过 |
| feishu_bitable (create_record) | 数据写入 | 同一 table + record hash → 跳过 |
| message | 消息发送 | 同一 chat + content hash → 跳过 |
| feishu_drive (create_folder/move/delete) | 文件操作 | 同一操作 + 目标 hash → 跳过 |
| exec | 命令执行 | 需要人工判断，不自动幂等 |

### 7.3 幂等键检查流程

```
Tool call 到达
  │
  ├── 检查是否为副作用操作（idempotentRequired flag on tool manifest）
  │
  ├── 如果是：
  │     ├── 计算 idempotencyKey
  │     ├── 检查 idempotency store（近期 5 分钟内是否已执行相同 key）
  │     │     ├── 已执行 → 返回缓存结果（跳过实际执行）
  │     │     └── 未执行 → 正常执行 + 写入 idempotency store
  │
  └── 如果不是：正常执行（无幂等检查）
```

## 8. 并行 Tool Calling 依赖检测

### 8.1 问题

LLM 可能同时发出多个 tool_use block，认为它们互不依赖，但实际上存在隐式依赖：

```
模型同时发出:
  tool_use #1: feishu_doc.read(doc_token="abc")
  tool_use #2: feishu_bitable.list_records(table_token=???)

如果 table_token 需要从 doc.read 的结果中获取 → 隐式依赖
但模型不知道 → 并行执行 → tool #2 失败
```

### 8.2 轻量级依赖检测

不是全 DAG 分析，而是**先写后读检测**：

```typescript
function detectReadWriteDependency(calls: ToolCall[]): DependencyMap {
  // Heuristic: if a later call's input references data that an earlier call produces
  // This is detected by:
  // 1. Explicit variable references in tool input (model may reference earlier results)
  // 2. Known tool sequences (e.g. read → list_records with data from read)

  const knownDependencies = TOOL_DEPENDENCY_RULES;

  for (const pair of calls) {
    if (knownDependencies.hasDependency(pair[0].name, pair[1].name)) {
      return { [pair[1].id]: { dependsOn: pair[0].id } };
    }
  }

  return {}; // no detected dependencies → can execute in parallel
}
```

### 8.3 已知依赖规则

```typescript
// Known tool dependency rules (extensible)
const TOOL_DEPENDENCY_RULES: DependencyRule[] = [
  // Doc operations: read must complete before write/insert that references read result
  { producer: "feishu_doc.read", consumer: "feishu_doc.write", condition: "input_refs_read_result" },

  // Bitable: get_meta must complete before list_records (needs table structure)
  { producer: "feishu_bitable_get_meta", consumer: "feishu_bitable_list_records", condition: "always" },

  // Doc → Bitable: if doc result contains table_token needed for bitable operations
  { producer: "feishu_doc.read", consumer: "feishu_bitable_*", condition: "input_refs_doc_result" },
];
```

### 8.4 检测结果处理

```
依赖检测完成
  │
  ├── 无依赖 → 全部并行执行
  │
  ├── 有依赖 →
  │     ├── 依赖链清晰 → 按依赖顺序串行执行
  │     ├── 部分有依赖 →
  │     │     ├── 无依赖组并行执行
  │     │     ├── 依赖组等前置完成后执行
  │     │
  │     └── 依赖不确定 → 保守串行执行（安全优先）
```

## 9. 与现有锁机制的过渡

改造过程中，逐步替换三层锁：

| 阶段 | 操作 | 说明 |
|------|------|------|
| Phase 1 | 保留三层锁，新增 Execution Board | Board 只做状态展示，不替代锁 |
| Phase 2 | Execution Board 接管 Agent 间并发决策 | 不同 agent 不再通过 CommandQueue Lane 串行 |
| Phase 3 | Execution Board 接管 Agent 内并发决策 | 同一 agent 的任务由 Supervisor 主动排序/合并 |
| Phase 4 | 移除 SequentialQueue | Context Accumulator 替代入站排队 |
| Phase 5 | SessionWriteLock 保留 | transcript 保护是刚需，保留最后一层保障 |

**SessionWriteLock 是唯一保留的锁**——因为 transcript 文件写入确实需要防并发写，这不是调度决策能替代的。