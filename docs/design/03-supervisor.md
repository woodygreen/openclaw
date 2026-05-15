# Supervisor Agent 详细设计

## 1. 角色定义

Supervisor 不是"更聪明的 agent"，而是**调度器 + 仲裁器 + 全局观察者**。三重角色：

| 角色 | 决策方式 | 延迟目标 |
|------|----------|----------|
| 调度器 | 规则引擎为主，LLM 为辅 | 规则决策 < 50ms，LLM 辅助 < 2s |
| 仲裁器 | 规则优先（priority 数值），LLM 裁决为兜底 | 规则仲裁 < 10ms，LLM 裁决 < 3s |
| 全局观察者 | 纯规则（维护 Execution Board 状态） | 实时 |

**关键约束**：Supervisor 自身不执行任何**业务 tool**。Supervisor 的操作是调度决策（LLM 辅助意图分类、路由、中断/注入/撤回），不是业务操作（不直接读文件、查数据、发消息）。Supervisor 的"tool"是调度操作（assign_task、interrupt_agent、inject_context、withdraw_reply），不是业务 tool。

## 2. 决策边界

### 2.1 Supervisor 决策的领域

| 决策 | 触发条件 | 决策逻辑 |
|------|----------|----------|
| 意图理解 | 观察窗口结束，聚合 user context 到达 | 规则优先（slash command 检测、关键词分类）→ LLM 辅助（复杂/模糊意图） |
| 任务拆解 | 意图包含多个子目标 | LLM 判断（语义拆解）→ 规则补充（已知拆解模板） |
| Agent 路由 | 任务拆解完成，需要分配 agent | 精确匹配（意图类型 → manifest capability）→ 语义匹配（LLM rerank） |
| 中断 | 用户后续消息改变意图 / 撤回消息 | 规则决策（撤回 → 直接中断；意图反转 → 中断） |
| 注入 | 用户后续消息补充信息但不改变意图 | 规则决策（补充 → 注入；修正 → 注入并标记） |
| 结果回收 | 子 agent 产出到达 | 规则优先（正常回收 → 组装；过期 → 丢弃）→ LLM 辅助（冲突合并） |
| 冲突仲裁 | 两个子 agent 结果矛盾 | 规则优先（priority 比较）→ LLM 裁决（语义判断） |
| 跨域授权 | 子 agent 请求超出 manifest 的 tool | 规则优先（已知跨域模板 → 直接授权）→ LLM 判断（新场景） |

### 2.2 Supervisor 不决策的领域

| 领域 | 负责者 | 原因 |
|------|--------|------|
| Tool 选择 | 子 agent 的 LLM | manifest 范围内的 tool 选择是子 agent 的自主决策 |
| Tool 执行顺序 | 子 agent 的 LLM | 子 agent 自行编排 tool call 序列 |
| 具体业务逻辑 | 子 agent | Supervisor 是调度层，不碰业务细节 |
| 单条消息的语义理解 | 观察窗口结束时整体理解 | 不是逐条理解 |

## 3. 意图理解机制

### 3.1 规则优先层

在 Context Accumulator 输出聚合 user context 后，先走规则层：

```typescript
// Rule classification result — produced by the rule-priority layer
interface RuleClassificationResult {
  matched: boolean                         // did any rule match?
  intentType?: IntentType                  // classified intent type (if matched)
  subTasks?: SubTaskSpec[]                 // decomposed sub-tasks (if matched)
  confidence: number                       // classification confidence (0-1)
  matchMethod?: "slash_command" | "keyword" | "template"  // how the match was made
}
```

```
聚合 user context
  │
  ├── slash command 检测？（/models, /new, /compact 等）
  │     → 已有机制，走 command handler
  │
  ├── 关键词/模板匹配？
  │     → "帮我查..." → TaskType.query
  │     → "帮我写/创建..." → TaskType.create
  │     → "帮我更新/修改..." → TaskType.update
  │     → "不用了/算了/撤回" → TaskType.withdrawal
  │     → 匹配成功 → 直接路由，不走 LLM
  │
  ├── 意图是否简单单一？（只有一个明确目标）
  │     → 单任务 → 直接路由到对应 agent
  │     → 跳过 LLM 意图理解
  │
  └── 未命中规则 → 进入 LLM 辅助层
```

### 3.2 LLM 辅助层

规则层未命中时，Supervisor 调用轻量级 LLM（推荐用 Haiku 或 Sonnet，不用 Opus——调度决策不需要最强模型）：

```typescript
// Supervisor Intent Engine LLM call
const intentPrompt = buildIntentPrompt({
  userContext: aggregatedUserContext,    // 聚合后的用户消息
  agentManifests: getSummaryManifests(), // 各 agent 的摘要 manifest
  conversationHistory: recentHistory,    // 近期对话摘要
});

const intentResult = await callLightweightLLM(intentPrompt);
// intentResult: { intentType, subTasks[], priorityHints }
```

**Token 控制**：LLM 辅助层输入只含：
- 聚合 user context（不是全部历史）
- 各 agent 的摘要 manifest（不是完整 tool schema）
- 近期对话摘要（compacted，不是原始 transcript）

目标：单次调度 LLM call 的 token 消耗 < 2K input + 500 output。

### 3.2a LLM 降级策略

LLM 辅助层可能失败（网络超时、API 异常、格式错误）。降级策略分三级：

| 级别 | 触发条件 | 处理 |
|------|----------|------|
| **Level 1: 规则层回退** | LLM call 超时 (>3s) 或 API 返回非 200 | 使用规则层最后一次判断结果（关键词匹配/模板匹配）路由；如果规则层也无命中 → Level 2 |
| **Level 2: Agent-D fallback** | 规则层无命中 + LLM 失效 | 路由到 Agent-D（通用 Chat agent），走单 agent 路径。这是最低成本的兜底——通用 agent 可以处理大多数简单意图，虽然不够精细但不会丢失用户请求 |
| **Level 3: 格式错误丢弃** | LLM 返回了结果但无法解析为 IntentClassification | 丢弃 LLM 输出，回退到 Level 1/2。不尝试"修补"格式错误的 LLM 输出——修补可能引入错误路由 |

```typescript
async function classifyIntentWithFallback(
  userContext: AccumulatedUserContext,
  ruleResult: RuleClassificationResult,
): Promise<IntentClassification> {
  // 1. Try LLM-assisted classification
  try {
    const llmResult = await callLightweightLLM(
      buildIntentPrompt(userContext),
      { timeoutMs: 3000 },  // strict timeout for scheduling decisions
    );

    // 2. Validate LLM output format
    const parsed = parseIntentClassification(llmResult);
    if (parsed && parsed.type && parsed.confidence >= 0.5) {
      return parsed;  // SUCCESS: use LLM result
    }
    // Format error → Level 3 fallback
    logger.warn("LLM intent classification format error, falling back to rules");
  } catch (error) {
    // LLM call failure → Level 1 fallback
    logger.warn(`LLM intent classification failed: ${error.message}`);
  }

  // 3. Level 1: Use rule-layer result if available
  if (ruleResult.matched && ruleResult.confidence >= 0.6) {
    return {
      type: ruleResult.intentType,
      subTasks: ruleResult.subTasks,
      confidence: ruleResult.confidence,
    };
  }

  // 4. Level 2: Agent-D fallback
  return {
    type: "simple",
    subTasks: [{ goal: userContext.aggregatedText, targetAgentId: "agent-chat" }],
    confidence: 0.3,  // low confidence marker for monitoring
  };
}
```

**关键约束**：降级不是"重试"。Level 1 使用的是规则层已有的结果（不是重新跑规则），Level 2 是直接 fallback。每级降级都有对应的 confidence 标记，便于后续监控和优化。

### 3.2b 决策期间竞态处理

Supervisor 在做 LLM 意图分类时（尤其是 compound/ambiguous 意图），可能收到新的用户消息。这产生竞态：LLM 还在思考，新消息已经改变了意图。

```typescript
// PendingDecision tracks an in-progress LLM intent classification call
interface PendingDecision {
  decisionId: string                 // unique decision session identifier
  llmCallId: string                  // the pending LLM API call ID (for cancellation)
  userContext: AccumulatedUserContext // the aggregated context being classified
  ruleResult: RuleClassificationResult // rule-layer result for fallback
  pendingSupplements: RawMessage[]    // queued supplements received during decision
  startTime: number                   // when the LLM call was initiated
}

// Race condition action types
type RaceConditionAction =
  | { action: "cancel_and_withdraw", withdrawalTarget: PendingDecision }
  | { action: "append_after_decision" }
  | { action: "new_window_for_new_message" }
```

处理策略：

| 竞态场景 | 处理 |
|----------|------|
| LLM 分类进行中 + 新消息属于同一话题的补充/修正 | **不中断 LLM 分类**：LLM 完成后，将新消息作为 supplement/correction 注入到分类结果中（即追加到已有 task 的 constraints） |
| LLM 分类进行中 + 新消息完全反转意图（"不用了"） | **中断 LLM 分类**：取消 LLM call，直接走 withdrawal 处理 |
| LLM 分类进行中 + 新消息是无关新意图 | **不中断 LLM 分类**：LLM 完成后处理原始意图，新消息开新窗口 → 新的 Supervisor 决策周期 |

```typescript
// Decision-period race condition handler
async function handleDecisionPeriodMessage(
  pendingDecision: PendingDecision,
  newMessage: RawMessage,
): Promise<RaceConditionAction> {
  // 1. Quick rule check on new message
  const quickRuleResult = quickRuleClassify(newMessage.text);

  // 2. Withdrawal detection → cancel LLM immediately
  if (quickRuleResult.intentType === "withdrawal") {
    cancelPendingLLMCall(pendingDecision.llmCallId);
    return { action: "cancel_and_withdraw", withdrawalTarget: pendingDecision };
  }

  // 3. Supplement/correction to same topic → append after LLM completes
  if (isRelatedToPendingDecision(newMessage, pendingDecision)) {
    // Queue the new message as a supplement modifier
    pendingDecision.pendingSupplements.push(newMessage);
    return { action: "append_after_decision" };
  }

  // 4. Unrelated new intent → let LLM continue, new message gets its own window
  return { action: "new_window_for_new_message" };
}

// After LLM classification completes, apply any queued supplements
async function applyQueuedSupplements(
  classification: IntentClassification,
  supplements: RawMessage[],
): Promise<IntentClassification> {
  if (supplements.length === 0) return classification;

  // Merge supplement context into task constraints
  for (const task of classification.subTasks ?? []) {
    task.constraints.push({
      type: "scope_limit",
      value: supplements.map(s => s.text).join("; "),
      description: "Supervisor-detected supplement/correction during decision period",
    });
  }

  return classification;
}
```

**状态标记**：在 07-message-lifecycle.md 的状态机中，Supervisor 决策期新增 `PENDING_DECISION` 状态。此状态下的新消息处理不走常规窗口聚合路径，而是走竞态处理路径。

### 3.3 意图分类输出

```typescript
type IntentClassification = {
  type: "simple" | "compound" | "withdrawal" | "supplement" | "correction" | "ambiguous"
  subTasks?: SubTaskSpec[]
  supplementTo?: string           // supplement/correction 关联的 task ID
  originalTaskToWithdraw?: string // withdrawal 关联的 task ID
  confidence: number              // 0-1
}
```

## 4. Agent 路由机制

### 4.1 路由策略

| 策略 | 适用场景 | 实现 |
|------|----------|------|
| 精确匹配 | 意图类型与 agent manifest 有明确对应 | 规则：TaskType → manifest.capabilities 匹配表 |
| 语义匹配 | 意图模糊，无法精确匹配 | LLM rerank：给 LLM 各 agent 摘要 manifest，让其排序 |
| 广播竞标 | 完全不确定 | 向所有 idle agent 广播 task，谁先 claim 就归谁（P2 优先级，暂不实现） |

### 4.2 路由优先级排序

当多个 agent 都匹配时，按以下维度排序：

1. **manifest.priority**（数值越大优先级越高）
2. **agent 当前状态**（idle 优先于 running，running 优先于 waiting）
3. **历史成功率**（同类型任务的历史完成率）

### 4.3 路由失败处理

| 情况 | 处理 |
|------|------|
| 所有匹配 agent 都在 running | 排入 Execution Board pending queue，等待 agent idle |
| 无任何 agent 匹配 | fallback 到 Agent-D（通用 Chat agent），走单 agent 路径 |
| 意图太模糊无法路由 | 先走 LLM 辅助层澄清意图，再路由 |

## 5. 执行状态管理（Execution Board）

### 5.1 状态模型

ExecutionBoard 的 canonical 定义见 [02-architecture.md §5.3](02-architecture.md)。此处列出 Supervisor 视角下的关键字段说明：

| 字段 | Supervisor 视角说明 |
|------|---------------------|
| `agents: Map<string, AgentExecState>` | 每个 agent 的状态追踪，Supervisor 用此做路由决策 |
| `pendingQueue: SupervisorTask[]` | FIFO + priority sort，Supervisor 在 agent idle 时分配 |
| `stagingResults: Map<string, AgentResult>` | 临时观察区——并发结果先 staging，Supervisor 确认后才 finalized |
| `finalizedResults: Map<string, FinalReply>` | 已提交的组装结果，可直接发给用户 |
| `traceLog: ExecutionTrace[]` | 全局执行 DAG，用于审计和性能分析 |
| `totalTasksCompleted / totalTasksFailed / averageLatencyMs` | Board-level metrics，用于路由成功率决策和可观测性 |

关键设计：`stagingResults → finalizedResults` 双层结构保证并发安全——多个 agent 的结果先 staging（不互相干扰），Supervisor 确认后统一 finalized（一致性合并）。详见 [05-concurrency.md §3](05-concurrency.md)。

### 5.2 状态转换

```
Agent lifecycle:
  idle → running (task assigned)
  running → idle (task completed, result collected)
  running → idle (task aborted by Supervisor interrupt)
  running → failed (execution error)
  failed → idle (recovered)
  running → waiting (waiting for cross-domain authorization or dependency)
  waiting → running (authorization granted or dependency resolved)
```

### 5.3 主动调度决策

Supervisor 根据 Execution Board 状态主动决策：

| 场景 | 决策 |
|------|------|
| 新 task 到达，目标 agent idle | 立即分配 |
| 新 task 到达，目标 agent running | 排入 pending queue |
| 同一 agent 有多个 pending task | 按优先级排序，或合并为复合 task |
| 不同 agent 的 task 可并发 | 同时分配，各自独立执行 |
| 子 agent 执行超时 | Supervisor 判断：中断+换 agent / 延长超时 |
| 所有 agent 都 idle + 无 pending task | Supervisor 自身 idle，等待新消息流 |

## 6. 中断与注入机制

### 6.1 中断（Interrupt）

触发条件：
- 用户撤回消息 → Supervisor Withdrawal Manager 发 interrupt
- 用户后续消息反转意图（"算了不用了"）→ Supervisor 判断后发 interrupt
- 子 agent 执行超时

实现方式：

```typescript
// Supervisor sends interrupt signal to running sub-agent
async function interruptAgent(agentId: string, reason: InterruptReason): Promise<void> {
  const agentState = executionBoard.agents.get(agentId);
  if (agentState?.status !== "running") return;

  // 1. Capture task reference BEFORE clearing agentState
  const currentTask = agentState.currentTask!;

  // 2. Send abort signal to agent's PI Runner
  await abortAgentSession(currentTask.id, reason);

  // 3. Check if agent already sent intermediate reply
  //    → if yes, call channel withdrawal API (e.g. Feishu message delete)
  const sentReplies = getIntermediateRepliesForTask(currentTask.id);
  for (const reply of sentReplies) {
    await withdrawReply(reply.channelId, reply.messageId);
  }

  // 4. Update Execution Board (after capturing task info)
  agentState.status = "idle";
  agentState.currentTask = undefined;
}
```

### 6.2 注入（Inject）

触发条件：
- 用户补充信息（不改变意图）
- 用户修正参数

实现方式：

```typescript
// Supervisor injects context into running sub-agent
async function injectContext(agentId: string, injection: ContextInjection): Promise<void> {
  const agentState = executionBoard.agents.get(agentId);
  if (agentState?.status !== "running") return;

  // Use existing steer mechanism (sessions_send or subagents steer)
  await steerAgentSession(agentState.currentTask!.id, injection.message);
}
```

**与现有 steer 的区别**：当前 steer 是用户触发的（`subagents` tool 的 steer action），新架构下 Supervisor 根据意图判断自动决定是 interrupt 还是 inject——用户不需要手动操作。

### 6.3 判断逻辑：Interrupt vs Inject vs Defer

```
新消息到来，当前有 task 正在执行
  │
  ├── 新消息是撤回 → Interrupt
  │
  ├── 新消息是意图反转 ("不用了/取消") → Interrupt
  │
  ├── 新消息是信息补充 ("项目A不是B") → Inject
  │
  ├── 新消息是参数修正 ("只查本周数据") → Inject
  │
  ├── 新消息是全新意图（与当前 task 无关） →
  │     当前 task 放入 pending 或继续执行
  │     新意图拆解为新 task → 路由到其他 idle agent
  │
  ├── 新消息与当前 task 相关但需要扩展 →
  │     └── 进入 Interrupt Cost Analysis 决策（见 6.4）
  │
  └── 不确定 → LLM 辅助判断（轻量 call）
```

### 6.4 Interrupt Cost Analysis — 中断成本决策模型

**场景举例**：
1. Agent-A 执行文档写入任务已 51 分钟，接近尾声但遇到预期外问题
2. 用户此时发新消息追加功能需求
3. 如果中断 Agent-A：51 分钟的工作可能需要回滚（已修改的文档状态），恢复成本极高
4. 如果不中断：可以等 Agent-A 完成后再处理追加需求，但用户需要等待

**核心问题**：中断不是免费的。每个中断决策都需要评估成本。

#### 中断成本三维度

```typescript
interface InterruptCostAssessment {
  // 1. Work loss: how much already-completed work will be discarded
  workLoss: {
    elapsedMs: number              // time already spent on this task
    progressPercent: number        // estimated completion percentage (0-100)
    reversible: boolean            // can the work be resumed after interruption?
    rollbackNeeded: boolean        // does stopping require rollback operations?
    rollbackComplexity: "none" | "simple" | "moderate" | "complex" | "impossible"
  }

  // 2. Resume viability: can we resume this task later?
  resumeViability: {
    canResume: boolean             // is it technically possible to resume?
    resumeCost: "none" | "low" | "medium" | "high" | "impossible"
    checkpointAvailable: boolean   // is there a saved checkpoint/state?
    sideEffectsCommitted: boolean  // have irreversible side effects been committed?
  }

  // 3. User impact: how does the decision affect user experience?
  userImpact: {
    waitTimeIfContinueMs: number   // estimated remaining time if we don't interrupt
    waitTimeIfInterruptMs: number  // estimated total time if we interrupt + restart
    userUrgencyLevel: "low" | "medium" | "high"  // inferred from message content
    userExpectationBreach: boolean // will the decision break a promise to user?
  }
}
```

#### 决策规则

```
新消息与当前 task 相关但需要扩展（中断成本分析）

  输入: interruptCost = assessInterruptCost(currentTask, newMessage)

  ├── Rule 1: IRREVERSIBLE SIDE EFFECTS — side effects already committed
  │     → interruptCost.workLoss.sideEffectsCommitted = true
  │     → DECISION: DO NOT INTERRUPT (defer)
  │     → Reason: stopping now would require rollback of committed operations
  │     → Action: notify user "正在处理中，完成后会跟进新需求"
  │     → Queue new requirement as followup task for same agent
  │
  ├── Rule 2: HIGH PROGRESS — task is nearly done
  │     → interruptCost.workLoss.progressPercent > 80%
  │     → AND interruptCost.workLoss.elapsedMs > task.expectedDurationMs
  │     → DECISION: DO NOT INTERRUPT (defer)
  │     → Reason: too much work already done, finishing is cheaper than restarting
  │     → Action: notify user "已经快完成了，完成后会处理追加需求"
  │     → Queue new requirement as followup
  │
  ├── Rule 3: LOW PROGRESS + RESUMABLE — early stage, can checkpoint
  │     → interruptCost.workLoss.progressPercent < 30%
  │     → AND interruptCost.resumeViability.canResume = true
  │     → DECISION: INTERRUPT (checkpoint + defer current task)
  │     → Reason: little work lost, can resume later, new request is more urgent
  │     → Action: checkpoint current task state → interrupt → handle new request → resume
  │
  ├── Rule 4: LOW PROGRESS + NOT RESUMABLE — early stage but cannot resume
  │     → interruptCost.workLoss.progressPercent < 30%
  │     → AND interruptCost.resumeViability.canResume = false
  │     → DECISION: DO NOT INTERRUPT (defer)
  │     → Reason: starting over is not possible, must finish current task
  │     → Action: notify user "当前任务无法暂停，完成后会处理追加需求"
  │
  ├── Rule 5: USER HIGH URGENCY — user request is time-sensitive
  │     → interruptCost.userImpact.userUrgencyLevel = "high"
  │     → AND interruptCost.resumeViability.canResume = true
  │     → DECISION: INTERRUPT (checkpoint + prioritize new request)
  │     → Reason: user urgency overrides task progress cost, but checkpoint first
  │     → Action: checkpoint → interrupt → handle urgent request → resume original
  │
  ├── Rule 6: USER EXPECTATION BREACH — we promised to notify but didn't
  │     → interruptCost.userImpact.userExpectationBreach = true
  │     → DECISION: DO NOT INTERRUPT, but SEND STATUS UPDATE
  │     → Reason: don't break promises — if we said "will notify when done", do it
  │     → Action: send proactive status update to user with estimated remaining time
  │
  └── Rule 7: UNCERTAIN — LLM-assisted decision
       → none of the above rules clearly apply
       → DECISION: LLM-assisted interrupt cost analysis
       → Action: call lightweight LLM with cost assessment data for recommendation
```

#### "完成后生效"机制（Preferred over Rollback）

你提到的"完成后生效"思路非常正确——比起回滚已执行的工作，更好的策略是：

1. **Side-effect operations use staged commits**：副作用操作（如飞书文档写入、bitable record 创建）不立即 commit，而是写入 staging area
2. **Supervisor controls commit timing**：所有副作用操作的 commit 由 Supervisor 决定时机
3. **If interrupted → discard staging area**：中断时，staging area 中的未 commit 操作直接丢弃，没有回滚成本
4. **If task completes → commit staging area**：任务完成时，一次性 commit 所有副作用操作

```typescript
interface StagedSideEffect {
  operationId: string
  agentId: string
  taskId: string
  operationType: "feishu_doc_write" | "feishu_bitable_create" | "message_send" | ...
  targetResource: string           // doc_token, table_token, chat_id, etc.
  operationData: any               // the actual operation payload
  status: "staged" | "committed" | "discarded"
  createdAt: number
  idempotencyKey: string           // for safe retry if needed
}

// Supervisor controls commit/discard decisions
async function commitStagedEffects(taskId: string): Promise<void> {
  const effects = stagedSideEffects.filter(e => e.taskId === taskId && e.status === "staged");
  for (const effect of effects) {
    await executeSideEffect(effect);  // actually perform the operation
    effect.status = "committed";
  }
}

async function discardStagedEffects(taskId: string): Promise<void> {
  const effects = stagedSideEffects.filter(e => e.taskId === taskId && e.status === "staged");
  for (const effect of effects) {
    effect.status = "discarded";
    // No rollback needed — the operation was never actually executed
  }
}
```

**关键约束**：子 agent 在执行副作用操作前，必须先声明为 staged effect。Supervisor 的 Result Collector 在收到 agent result 后决定是 commit 还是 discard。

**与现有 tool 调用的集成**：这个机制要求修改子 agent 的 tool 执行流程——副作用 tool 的 `execute()` 不直接执行操作，而是写入 staging area。只有 Supervisor 确认 commit 后才真正执行。

这是对现有架构的**重大改动**，需要渐进式实现：
- **Phase 1-5**：不实现 staged effects，副作用操作直接执行（接受中断时可能需要手动回滚的风险）
- **Phase 6**：先对低风险副作用 tool（如 feishu_doc.write）实现 staged commit
- **Phase 7+**：逐步扩展到所有副作用 tool

#### 用户承诺与状态通知

中断决策时，Supervisor 必须管理用户承诺：

```typescript
interface UserPromise {
  taskId: string
  promiseType: "will_notify_on_complete" | "will_handle_followup" | "estimated_time"
  promisedAt: number
  estimatedCompleteAt?: number
  fulfilled: boolean
}

// When deferring a task (not interrupting):
async function deferWithPromise(taskId: string, newRequirement: SupervisorTask): Promise<void> {
  // 1. Queue the new requirement as followup for same agent
  executionBoard.pendingQueue.push({
    ...newRequirement,
    dependsOn: [taskId],  // must wait for current task to complete
    isFollowup: true,
  });

  // 2. Send user notification
  await sendUserNotification({
    type: "task_progress_update",
    message: "正在处理中，已经快完成了。完成后会跟进你的追加需求。",
    estimatedRemainingTimeMs: estimateRemainingTime(taskId),
    promiseId: recordPromise({
      taskId,
      promiseType: "will_handle_followup",
      estimatedCompleteAt: Date.now() + estimateRemainingTime(taskId),
    }),
  });
}

// When a task completes, check if there are pending promises
async function fulfillPromisesOnTaskComplete(taskId: string): Promise<void> {
  const promises = userPromises.filter(p => p.taskId === taskId && !p.fulfilled);

  for (const promise of promises) {
    if (promise.promiseType === "will_handle_followup") {
      // Trigger the queued followup task
      await dispatchFollowupTask(taskId);
    }
    if (promise.promiseType === "will_notify_on_complete") {
      // Notify user that original task is done
      await sendUserNotification({
        type: "task_completed_notification",
        message: "之前的任务已完成，现在开始处理你的追加需求。",
      });
    }
    promise.fulfilled = true;
  }
}
```

**承诺原则**：说到做到。如果 Supervisor 通知用户"完成后会跟进"，那么任务完成后必须主动通知并开始处理追加需求。不能发了通知后忘记。

## 7. 结果回收与组装

### 7.1 回收路径

| 路径 | 触发条件 | 处理 |
|------|----------|------|
| 正常回收 | 子 agent 执行完成，产出到达 | Supervisor 组装最终回复 → 发给用户 |
| 异常回收 | 子 agent 执行失败 | Supervisor 决定：重试 / 换 agent / 告知用户 |
| 冲突回收 | 两个 agent 结果矛盾 | Supervisor 裁决：取其一 / 合并 / 要求重跑 |
| 过期回收 | 意图已变更/撤回，结果不再需要 | 丢弃，不发回复 |

### 7.2 组装逻辑

简单场景（单 agent 单结果）：直接透传子 agent 产出。

复合场景（多 agent 多结果）：

```typescript
async function composeReply(results: AgentResult[]): Promise<FinalReply> {
  // Rule-based composition (fast path)
  if (results.length === 1) {
    return { text: results[0].output, artifacts: results[0].artifacts };
  }

  // Multiple results → need composition
  // Option 1: Structured merge (known output format)
  if (hasStructuredMergeTemplate(results)) {
    return structuredMerge(results);
  }

  // Option 2: LLM-assisted composition (complex merge)
  return await llmCompose(results);
}
```

## 8. Supervisor Prompt 设计

### 8.1 System Prompt 结构

```markdown
# Supervisor System Prompt

## Role
You are a task orchestrator. You DO NOT execute business operations directly.
You observe user intent, decompose tasks, route to specialized agents,
collect results, and compose final replies.

## Decision Principles
- System rules > agent results > user input > model guesses
- Simple intents: route directly, do not over-decompose
- Supplement/correction: inject, do not interrupt
- Withdrawal/cancellation: interrupt, do not inject
- If unsure: use lightweight LLM call, do not guess

## Available Agents (Summary Manifests)
[Agent-A summary] [Agent-B summary] [Agent-C summary] ...

## Routing Rules
- "query/search/lookup" → Agent-B (Data)
- "write/create/document" → Agent-A (Doc)
- "build/deploy/ci" → Agent-C (CI)
- "chat/answer/explain" → Agent-D (Chat)
- compound intents → decompose → route each sub-task

## Output Format
Your decisions must be structured JSON:
{ intentType, subTasks[], targetAgentIds[], priorityHints[] }
```

### 8.2 可信度分层声明

Supervisor prompt 必须包含明确的可信度层级：

1. **Supervisor 自身的任务拆解** — 最可信，这是系统规则
2. **子 agent 的执行结果** — 可信但可质疑（agent 可能幻觉）
3. **用户原始输入** — 意图可信但表述可能不精确
4. **模型猜测** — 最不可信，需验证

## 9. Supervisor 自身生命周期

### 9.1 Supervisor Session

Supervisor 有自己的 session（独立 transcript）：
- 记录：意图判断、路由决策、中断/注入决策
- 不记录：子 agent 的具体 tool call（那些在子 agent 自己的 transcript 中）

### 9.2 Supervisor 故障恢复

```
Supervisor 故障
  │
  ├── 已完成的子 agent 结果 → 保留在 persistent storage
  │
  ├── 正在执行的子 agent → 继续执行（PI Runner 独立运行）
  │     结果到达时：Supervisor 已恢复 → 正常回收
  │     结果到达时：Supervisor 还未恢复 → 暂存在 staging area
  │
  ├── Supervisor 重启 →
  │     从 persistent storage 读取 Execution Board 状态
  │     重新连接正在执行的子 agent
  │     处理 staging area 中的结果
```

### 9.3 Supervisor Idle 状态

当所有 agent idle + 无 pending task：
- Supervisor 自身 idle，不消耗 LLM token
- 等待新消息流从 Context Accumulator 到达
- 可以执行后台维护：记忆衰减、物化视图刷新