# Sub-Agent 详细设计

## 1. Agent Manifest

Manifest 是子 agent 的**结构化身份声明**，是 Supervisor 路由、tool 过滤、冲突仲裁的基础数据。

### 1.1 Manifest Schema

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

### 1.2 CapabilitySpec

```typescript
interface CapabilitySpec {
  domain: string                      // e.g. "feishu_doc", "feishu_bitable", "ci_build"
  actions: string[]                   // e.g. ["read", "write", "append", "create"]
  scopeDescription: string            // natural language scope explanation
}
```

### 1.3 BoundarySpec

```typescript
interface BoundarySpec {
  domain: string                      // boundary domain (e.g. "ci", "database", "payment")
  reason: string                      // why this boundary exists (e.g. "CI operations require separate authorization")
  overrideAllowed: boolean            // can Supervisor override this boundary with explicit authorization?
}
```

### 1.4 RejectPattern

```typescript
interface RejectPattern {
  pattern: string                     // regex or keyword pattern (e.g. "CI|部署|构建")
  reason: string                      // explanation for the rejection
  redirectTo?: string                 // suggested alternative agent (e.g. "agent-ci")
}
```

## 2. 默认 Agent 配置

基于当前 OpenClaw 的功能范围和飞书 Extension 的 tool 划分，建议以下默认 agent 分工：

### 2.1 Agent-A：Document Operations（文档操作）

| 字段 | 值 |
|------|-----|
| id | `agent-doc` |
| label | Document Operations |
| description | Feishu document read, write, append, insert, create, wiki, drive operations |
| toolIds | `feishu_doc`, `feishu_doc_legacy`, `feishu_wiki`, `feishu_drive`, `feishu_perm`, `read`, `write`, `edit` |
| capabilities | domain: `feishu_doc`, actions: [read, write, append, insert, create, list_blocks, update_block, delete_block, create_table, write_table_cells, upload_image]; domain: `feishu_wiki`, actions: [spaces, nodes, get, search, create]; domain: `feishu_drive`, actions: [list, info, create_folder, move, delete] |
| boundaries | domain: `ci`, reason: "CI operations require agent-ci"; domain: `bitable`, reason: "Bitable operations require agent-data" |
| rejectPatterns | pattern: "CI|构建|部署|pipeline", reason: "CI operations are handled by agent-ci", redirectTo: "agent-ci" |
| priority | 80 |
| taskTypes | [create, update, read] |
| keywords | [文档, doc, wiki, 知识库, drive, 云文档, 写入, 创建文档] |

### 2.2 Agent-B：Data & Query（数据查询）

| 字段 | 值 |
|------|-----|
| id | `agent-data` |
| label | Data & Query |
| description | Feishu bitable operations, data search, web search, chat member lookup |
| toolIds | `feishu_bitable_*` (all bitable tools), `feishu_chat`, `web_search`, `web_fetch`, `x_search`, `memory_search`, `memory_get` |
| capabilities | domain: `feishu_bitable`, actions: [get_meta, list_fields, list_records, create_record]; domain: `feishu_chat`, actions: [members, info, member_info]; domain: `web`, actions: [search, fetch] |
| boundaries | domain: `feishu_doc`, reason: "Doc operations require agent-doc"; domain: `ci`, reason: "CI operations require agent-ci" |
| rejectPatterns | pattern: "文档|写文档|CI|构建", reason: "Outside data/query scope" |
| priority | 70 |
| taskTypes | [query, read] |
| keywords | [查询, 搜索, bitable, 多维表格, 数据, 成员, 搜索网页] |

### 2.3 Agent-C：CI/CD Management（CI/CD 管理）

| 字段 | 值 |
|------|-----|
| id | `agent-ci` |
| label | CI/CD Management |
| description | Build tasks, CI pipeline operations, cron scheduling, gateway control |
| toolIds | `exec`, `process`, `gateway`, `cron`, `sessions_list`, `sessions_spawn` |
| capabilities | domain: `ci`, actions: [build, deploy, schedule, monitor]; domain: `cron`, actions: [create, list, delete] |
| boundaries | domain: `feishu_doc`, reason: "Doc operations require agent-doc"; domain: `feishu_bitable`, reason: "Data operations require agent-data" |
| rejectPatterns | pattern: "文档|查询|搜索网页|写文档", reason: "Outside CI scope" |
| priority | 60 |
| taskTypes | [create, update, query] |
| keywords | [构建, CI, CD, 部署, build, deploy, pipeline, 任务, cron] |

### 2.4 Agent-D：General Chat（通用对话）

| 字段 | 值 |
|------|-----|
| id | `agent-chat` |
| label | General Chat |
| description | General conversation, Q&A, explanation, simple tasks without specific domain |
| toolIds | `message`, `image`, `memory_search`, `memory_get`, `session_status` |
| capabilities | domain: `general`, actions: [chat, explain, answer, summarize] |
| boundaries | (无边界——通用 agent 是 fallback) |
| rejectPatterns | (无拒绝——fallback agent 接收所有无法路由的任务) |
| priority | 10 (最低优先级，只在其他 agent 都不匹配时使用) |
| taskTypes | [chat] |
| keywords | [问答, 解释, 帮助, 通用] |

### 2.5 Custom Agents

用户可以通过 OpenClaw 配置新增自定义 agent：

```yaml
# openclaw.yaml
agents:
  list:
    - id: agent-custom-report
      label: Report Generator
      manifest:
        capabilities: [...]
        boundaries: [...]
        toolIds: [...]
        priority: 50
```

自定义 agent 的 manifest 注册到 Supervisor 后自动参与路由。

## 3. Tool 过滤与注入

### 3.1 Manifest-based Tool Construction

当前架构：`createOpenClawCodingTools()` 构建全量 tools → `applyToolPolicyPipeline()` 白名单过滤。

新架构：**manifest-based 按需构建**。

```typescript
// New: manifest-driven tool construction
function createManifestBoundTools(manifest: AgentManifest, options: ToolOptions): AnyAgentTool[] {
  // 1. Only construct tools listed in manifest.toolIds
  const allowedToolIds = new Set([...manifest.toolIds, ...manifest.toolGroups ?? []]);

  // 2. Construct each tool individually (not full batch)
  const tools: AnyAgentTool[] = [];
  for (const toolId of allowedToolIds) {
    const tool = constructToolById(toolId, options);
    if (tool) tools.push(tool);
  }

  // 3. Always include essential tools (session_status, heartbeat)
  tools.push(constructToolById("session_status", options));
  tools.push(constructToolById("heartbeat_respond", options));

  return tools;
}
```

**与现有 ToolPolicyPipeline 的关系**：Manifest-based 构建替代了 ToolPolicyPipeline 的大部分功能。pipeline 的 agent-level 和 group-level 策略由 manifest 直接覆盖。但 pipeline 的 provider-level 过滤（`tools.byProvider.allow`）仍然需要——不同 LLM provider 支持不同的 tool 类型。

### 3.2 摘要/完整分层注入

Supervisor 做意图判断时，只看各 agent 的 `summaryManifest`（< 100 chars）。确认委派后，才构建完整 tool schema：

```
Supervisor routing phase:
  Input: agent summaries only
  → "agent-doc: Feishu doc/wiki/drive operations"
  → "agent-data: Bitable, search, web lookup"
  → "agent-ci: Build, deploy, cron, gateway"
  → "agent-chat: General Q&A"

Supervisor confirms routing → agent-doc selected:
  → Build full tool schemas for agent-doc
  → FeishuDocSchema (full 16+ variants), FeishuWikiSchema, etc.
  → Inject into agent-doc's PI Runner prompt
```

### 3.3 FeishuDocSchema 的特殊处理

当前 FeishuDocSchema 是一个 Type.Union 包含 16+ action 变体，作为一个巨型 schema 传给模型。

改造方案：**拆分为摘要版和完整版**。

```typescript
// Summary version: only declares available actions without detailed parameter schemas
const FeishuDocSchemaSummary = Type.Object({
  action: Type.Union([
    Type.Literal("read"),
    Type.Literal("write"),
    Type.Literal("append"),
    // ... all 16+ actions listed, but without detailed per-action parameters
  ]),
  doc_token: Type.String({ description: "Document token" }),
});

// Full version: loaded only when the model confirms it will call feishu_doc
const FeishuDocSchemaFull = Type.Union([
  // ... existing 16+ variant definitions with full parameter schemas
]);
```

在子 agent 的 prompt 中注入摘要版，模型确认调用 `feishu_doc` 后，在 tool call 前动态替换为完整版。

**实现细节**：这需要引入新的 **SchemaUpgradeHook** 机制，与现有的 `applyDeferredFollowupToolDescriptions` 不同。后者的作用是延迟加载 tool 的文本描述（description 字段），不涉及 schema 结构变更。而 SchemaUpgradeHook 需要在 LLM 返回 tool_use block 时，将摘要版 schema 动态替换为完整版 schema，并重新校验参数——这改变了 tool 的 JSON Schema 结构（参数定义从简化版变为完整版），是 schema 级别的升级，而非描述文本的延迟加载。

```typescript
// SchemaUpgradeHook — new mechanism for summary→full schema upgrade
interface SchemaUpgradeHook {
  toolId: string                          // the tool that has summary/full versions
  summarySchema: JSONSchema               // lightweight schema injected at session creation
  fullSchema: JSONSchema                  // detailed schema loaded on tool_use confirmation

  // Hook trigger: when PI Runner receives a tool_use block for this tool
  onToolUseDetected(toolCall: ToolUseBlock): Promise<SchemaUpgradeResult>
}

type SchemaUpgradeResult =
  | { upgraded: true, validatedParams: any }    // summary→full upgrade succeeded, params re-validated
  | { upgraded: false, validationError: string } // full schema validation failed

// Integration point: modify PI Runner's tool call processing
async function processToolCallWithSchemaUpgrade(
  toolCall: ToolUseBlock,
  hooks: Map<string, SchemaUpgradeHook>,
): Promise<ProcessedToolCall> {
  const hook = hooks.get(toolCall.toolName);
  if (!hook) {
    // No upgrade hook → process normally with current schema
    return { toolCall, schemaUpgraded: false };
  }

  // 1. Upgrade: replace summary schema with full schema
  const upgradeResult = await hook.onToolUseDetected(toolCall);

  if (!upgradeResult.upgraded) {
    // Full schema validation failed → return error to model
    return {
      toolCall,
      schemaUpgraded: false,
      error: upgradeResult.validationError,
    };
  }

  // 2. Re-validate tool_call params against full schema
  // 3. If params valid → proceed with full schema execution
  // 4. If params invalid → return validation error, model can retry with full schema context
  return {
    toolCall: { ...toolCall, input: upgradeResult.validatedParams },
    schemaUpgraded: true,
  };
}
```

**与 applyDeferredFollowupToolDescriptions 的关键区别**：

| 维度 | applyDeferredFollowupToolDescriptions | SchemaUpgradeHook |
|------|--------------------------------------|-------------------|
| 作用范围 | 只延迟加载 tool 的 description 文本 | 替换整个 JSON Schema 结构 |
| 触发时机 | PI Runner 的 followup phase | tool_use block 检测时 |
| 对模型的影响 | 模型看到更多描述信息，但 schema 结构不变 | 模型的参数定义从简化版变为完整版 |
| 参数校验 | 不需要重新校验（schema 结构没变） | 必须重新校验（schema 结构变了） |

SchemaUpgradeHook 是一个**新机制**，需要在 PI Runner 的 tool call 处理流程中新增 hook 点。建议实现路径：
- Phase 1-5：不实现 SchemaUpgradeHook，直接注入完整版 schema（接受更多 token 消耗）
- Phase 6：实现 SchemaUpgradeHook，先对 `feishu_doc` 工具做摘要/完整拆分试点
- Phase 7+：逐步扩展到其他复杂 schema 工具

## 4. Sub-Agent 生命周期

### 4.1 生命周期阶段

```
Agent Lifecycle:
  registered → (manifest loaded, ready for routing)

  spawned → (Supervisor assigns a task)
    → PI Runner session created
    → manifest-bound tools injected
    → structured task injected as user message

  running → (PI Runner executing: LLM call + tool-use loop)
    → tool calls dispatched within manifest scope
    → results stream back to Supervisor via event bridge
    → may receive Supervisor inject (steer message)
    → may receive Supervisor interrupt (abort signal)

  yielding → (agent calls sessions_yield, waiting for input)
    → may receive Supervisor inject or new task
    → Supervisor may decide to resume or abort

  completed → (task done, result collected by Supervisor)
    → PI Runner session closed or preserved for reuse
    → result enters Supervisor Result Collector

  failed → (execution error)
    → error result enters Supervisor Result Collector
    → Supervisor decides: retry / switch agent / inform user

  aborted → (Supervisor sent interrupt)
    → no result collected
    → agent returns to idle state
```

### 4.2 Session 管理

每个子 agent 执行一个 task 时有独立的 session：

```typescript
// Sub-agent session key derivation — uses existing agent: prefix for compatibility
// The "supervisor" marker is embedded in the rest portion, not as a top-level prefix
// This avoids breaking parseAgentSessionKey() which requires parts[0] === "agent"
function resolveSubAgentSessionKey(parentSessionKey: string, taskId: string, agentId: string): string {
  const parentParsed = parseAgentSessionKey(parentSessionKey);
  const parentAgentId = parentParsed?.agentId ?? "default";
  return `agent:${parentAgentId}:supervisor:${agentId}:task:${taskId}`;
}
```

子 agent 的 session 不共享 transcript——每个 task 有独立的 transcript 文件。这避免跨 task 上下文污染，也便于 Supervisor 管理每个 task 的生命周期。

**与现有 session 机制的关系**：现有 `parseAgentSessionKey()` 只支持 `agent:` 前缀（检查 `parts[0] !== "agent"` 时返回 null）。因此子 agent session key 也使用 `agent:` 前缀，`supervisor:` 标识嵌入在 rest 部分（`agent:{parentAgentId}:supervisor:{agentId}:task:{taskId}`），保证解析器兼容。

**Session key 前缀选择说明**：为什么不使用独立的 `supervisor:` 前缀？因为 `parseAgentSessionKey()` 是 session routing、subagent depth 计算、ACP session 识别等下游逻辑的基础。如果新增 `supervisor:` 前缀，需要修改解析器支持多前缀，影响范围大。用 `agent:` 前缀 + rest 嵌入 supervisor 标记的方式不需要修改解析器，只需在 `isSubagentSessionKey()` 和 `getSubagentDepth()` 中增加 `supervisor:` 段的识别。

### 4.2a 执行触发接口 — Supervisor → PI Runner

Supervisor 触发子 agent 执行不是通过 LLM tool call（`sessions_spawn`），而是直接调用内部 API。这是关键设计：Supervisor 不调 LLM 来 spawn 子 agent，而是规则化调度。

```typescript
// Supervisor-internal spawn function
// This wraps the existing spawnSubagentDirect() with manifest-bound tool construction
async function supervisorSpawnSubagent(task: SupervisorTask, manifest: AgentManifest): Promise<string> {
  // 1. Resolve session key
  const sessionKey = resolveSubAgentSessionKey(
    supervisorState.currentSessionKey,
    task.id,
    manifest.id,
  );

  // 2. Construct manifest-bound tools
  const toolConstructionPlan = createManifestBoundToolConstructionPlan(manifest);
  const tools = await constructToolsFromPlan(toolConstructionPlan, {
    agentId: manifest.id,
    sessionKey,
    sandbox: resolveSandboxForAgent(manifest.id),
    workspaceDir: resolveWorkspaceForAgent(manifest.id),
  });

  // 3. Build structured task as user message (not natural language)
  const taskMessage = buildStructuredTaskMessage(task);

  // 4. Build system prompt from manifest template
  const systemPrompt = buildSubAgentSystemPrompt(manifest, task);

  // 5. Spawn PI Runner session directly (bypass sessions_spawn tool)
  const sessionId = await spawnSubagentDirect({
    sessionKey,
    task: taskMessage,
    tools,
    systemPrompt,
    contextMode: "isolated",    // fresh session, no parent transcript inheritance
    mode: "run",                // one-shot execution (not persistent thread)
    abortSignal: supervisorState.abortController.signal,  // for interrupt capability
  });

  // 6. Subscribe to session events for result collection
  subscribeToSubAgentSessionEvents(sessionId, {
    onToolCallStart: (event) => executionBoard.recordTraceStep(task.id, event),
    onToolCallEnd: (event) => executionBoard.recordTraceStepComplete(task.id, event),
    onCompleted: (result) => resultCollector.collectResult(task.id, result),
    onFailed: (error) => resultCollector.collectError(task.id, error),
    onAborted: () => executionBoard.markTaskAborted(task.id),
  });

  // 7. Update Execution Board
  executionBoard.markAgentRunning(manifest.id, task);

  return sessionId;
}

// Structured task message builder
function buildStructuredTaskMessage(task: SupervisorTask): string {
  return JSON.stringify({
    taskType: task.type,
    goal: task.description,
    constraints: task.constraints.map(c => `${c.type}: ${c.value} (${c.description})`),
    deadline: task.deadlineMs ? `Complete within ${task.deadlineMs / 1000}s` : "No deadline",
    parentMessageIds: task.parentMessageIds,  // array of originating message IDs for traceability
  });
}
```

**关键区别**：`supervisorSpawnSubagent` 直接调用 `spawnSubagentDirect()`（现有 `src/agents/subagent-spawn.ts` 的内部函数），不经过 LLM tool call。这避免了额外的 LLM token 消耗和延迟。

### 4.2b 结果回流通道 — PI Runner → Supervisor

子 agent 的执行结果不直接发给用户，而是通过 **SupervisorResultEventBus** 流回 Supervisor。

```typescript
// SupervisorResultEventBus — sits between PI Runner events and ReplyDispatcher
// When supervisor mode is ON: events → ResultCollector
// When supervisor mode is OFF: events → ReplyDispatcher (legacy path)

interface SupervisorResultEventBus {
  mode: "supervisor" | "legacy"

  // In supervisor mode: route events to ResultCollector
  handleAgentEvent(event: PiSessionEvent): void

  // In legacy mode: route events to ReplyDispatcher (unchanged behavior)
  handleLegacyEvent(event: PiSessionEvent): void
}

function createSupervisorResultEventBus(config: {
  supervisorEnabled: boolean,
  resultCollector: ResultCollector,
  replyDispatcher: ReplyDispatcher,
}): SupervisorResultEventBus {

  return {
    mode: config.supervisorEnabled ? "supervisor" : "legacy",

    handleAgentEvent(event: PiSessionEvent): void {
      if (this.mode === "supervisor") {
        // Route to Supervisor's ResultCollector
        switch (event.type) {
          case "tool_call_start":
          case "tool_call_end":
            resultCollector.recordToolTrace(event);
            break;
          case "session_completed":
            resultCollector.collectResult(event.sessionId, event.result);
            break;
          case "session_failed":
            resultCollector.collectError(event.sessionId, event.error);
            break;
          case "session_aborted":
            resultCollector.collectAbort(event.sessionId);
            break;
          case "assistant_text":
            // In supervisor mode: don't stream to user directly
            // Accumulate in staging area, compose final reply after all tasks done
            resultCollector.bufferIntermediateOutput(event);
            break;
        }
      } else {
        // Legacy path: route to ReplyDispatcher (existing behavior)
        this.handleLegacyEvent(event);
      }
    },

    handleLegacyEvent(event: PiSessionEvent): void {
      // Existing pi-embedded-subscribe.ts behavior
      replyDispatcher.dispatchReplyFromConfig(event);
    },
  };
}
```

**集成点**：修改 `pi-embedded-subscribe.ts` 的 event handler。现有流程是 event → ReplyDispatcher → 用户。新增 Supervisor mode 后，event → SupervisorResultEventBus → (supervisor ON) ResultCollector → ReplyComposer → 用户；(supervisor OFF) ReplyDispatcher → 用户（不变）。

**关键约束**：Supervisor mode 关闭时，SupervisorResultEventBus 路径完全不激活，不影响现有行为。这是渐进式迁移的基础。

### 4.3 跨域授权请求

子 agent 执行中发现需要超出 manifest 范围的 tool：

```typescript
// Sub-agent cross-domain authorization request
interface CrossDomainAuthRequest {
  taskId: string
  agentId: string
  requestedToolId: string
  reason: string
  urgency: "low" | "medium" | "high"
}

// Supervisor response
type CrossDomainAuthResponse =
  | { approved: true, toolResult?: any }          // grant temporary access or provide result directly
  | { approved: true, delegateTo: string }         // delegate to another agent
  | { approved: false, reason: string }            // deny, agent must work within bounds
  | { approved: false, alternative: string }       // deny but suggest alternative approach
```

**实现方式**：子 agent 通过 `sessions_send` 或新增的 `supervisor_request` tool 向 Supervisor 发授权请求。Supervisor 根据请求类型决策：

- 请求的数据已有其他 agent 在查 → 提供引用/等待结果
- 请求的 tool 与当前 task 紧密相关 → 临时授权
- 请求的 tool 超出当前 task 范围 → 委派给其他 agent

## 5. 协调模型

### 5.1 分工保底机制

三层递进解决冲突：

| 层级 | 触发条件 | 机制 |
|------|----------|------|
| **优先级仲裁** | 两个 agent claim 同一任务 | 比较 manifest.priority，高优先级者胜 |
| **Supervisor 裁决** | 优先级相同或产出结果矛盾 | Supervisor LLM 辅助判断 |
| **结果合并** | 两个 agent 的产出都有价值 | Supervisor LLM 辅助合并为统一回复 |

### 5.2 任务合并

同一 agent 的多个 pending task 可以合并为复合 task：

```typescript
// Task merging rules
function canMergeTasks(taskA: SupervisorTask, taskB: SupervisorTask): boolean {
  // Same target agent
  if (taskA.targetAgentId !== taskB.targetAgentId) return false;

  // Same or related task types
  if (!areRelatedTaskTypes(taskA.type, taskB.type)) return false;

  // No conflicting constraints
  if (hasConflictingConstraints(taskA.constraints, taskB.constraints)) return false;

  return true;
}

// Merged task
function mergeTasks(tasks: SupervisorTask[]): SupervisorTask {
  return {
    ...tasks[0],
    description: tasks.map(t => t.description).join("\n---\n"),
    parentMessageIds: tasks.flatMap(t => t.parentMessageIds),
    type: "compound",
  };
}
```

### 5.3 子 Agent 结果回流

子 agent 完成后，结果通过 PI Runner 的 event bridge 流回 Supervisor。结果类型使用 [02-architecture.md §5.4](02-architecture.md) 中定义的 `AgentResult`（含 `taskId, agentId, status, output, artifacts?, toolCallTrace, confidence, crossDomainRequests?, timestamp, traceId`）。

Supervisor 的 Result Collector 接收 `AgentResult`，根据 Execution Board 状态决定回收路径（见 [05-concurrency.md §5](05-concurrency.md) 四种回收策略）。

## 6. 与现有代码的集成点

| 组件 | 现有代码 | 改造方式 |
|------|---------|---------|
| Manifest 注册 | `src/agents/agent-scope.ts` (agent config resolution) | 扩展 `AgentScopeConfig` 加入 manifest 字段 |
| Tool 构建 | `src/agents/pi-tools.ts` (`createOpenClawCodingTools`) | 新增 `createManifestBoundTools()` |
| Tool 过滤 | `src/agents/tool-policy-pipeline.ts` | Manifest-based 构建替代大部分 pipeline 功能；provider-level 过滤保留 |
| 子 agent spawn | `src/agents/tools/sessions-spawn-tool.ts` | 从 agent 自管理改为 Supervisor 管理；spawn 参数从自由描述改为结构化 SupervisorTask |
| 子 agent 控制 | `src/agents/tools/subagents-tool.ts` | 从 agent 工具改为 Supervisor 内部操作（list/kill/steer 不再暴露给子 agent） |
| PI Runner | `src/agents/pi-embedded-runner/` | 复用作为子 agent 执行引擎；session key 新增 supervisor 前缀 |
| 跨域请求 | `src/agents/tools/sessions-send-tool.ts` | 扩展为 supervisor_request channel |
| Schema 升级 Hook | `src/agents/pi-tools.deferred-followup.ts`（参考对比） + 新增 `src/supervisor/schema-upgrade-hook.ts` | 新机制实现 tool schema 摘要→完整升级（见 §3.3 SchemaUpgradeHook，与 deferred followup 是不同机制：后者只延迟加载 description 文本，前者替换整个 JSON Schema 结构） |