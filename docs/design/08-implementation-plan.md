# TDD 分阶段实现计划

## 1. 实施策略

### 1.1 渐进式改造原则

- **每个阶段完成后系统可正常运行**——不要求一次性切换
- **保留 fallback 路径**——新机制失败时可退回原有路径
- **从底层向上层推进**——先改基础设施，再改调度，再改交互

### 1.2 TDD 交付标准

每个单元交付前必须：
1. **单元测试通过**：该单元的所有测试用例 pass
2. **关联测试通过**：受影响的已有模块的测试仍 pass（不破坏现有功能）
3. **集成检查通过**：该单元与上一阶段交付的模块可正常协作

### 1.3 测试分层

| 层 | 范围 | 工具 |
|----|------|------|
| **Unit** | 单个函数/类/模块 | vitest（项目现有测试框架） |
| **Integration** | 两个以上模块协作 | vitest + mock 依赖 |
| **Impact** | 改动对已有模块的影响 | 运行已有测试套件 |
| **E2E** | 完整消息流端到端 | 手动 + Feishu 测试群验证 |

## 2. 分阶段计划

### Phase 1：基础设施 — AgentManifest + ExecutionBoard（纯数据结构）

**目标**：定义核心数据结构，不涉及运行时逻辑变更。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U1-1 | `AgentManifest` type + 默认 4 个 agent 的 manifest 定义 | manifest schema 验证 + 默认 manifest 完整性测试 | 无 |
| U1-2 | `SupervisorTask` type + 任务拆解结果类型 | schema 验证 + 构造测试 | 无 |
| U1-3 | `ExecutionBoardState` type + `AgentExecState` | schema 验证 + 状态转换测试 | 无 |
| U1-4 | `AgentResult` type + `ToolCallTraceEntry` | schema 验证 + 构造测试 | 无 |
| U1-5 | `WithdrawalEvent` type + 消息流状态枚举 | schema 验证测试 | 无 |

**关联影响检查**：这些纯类型定义不修改现有代码，只新增文件。需要确认类型文件放置在 `src/supervisor/types/` 或 `src/agents/supervisor-types/` 目录下。

**预计工作量**：1-2 天

---

### Phase 2：核心逻辑 — ExecutionBoard + Manifest 注册

**目标**：实现 Execution Board 的运行时逻辑和 Manifest 注册/查找机制。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U2-1 | `ExecutionBoard` 类：状态管理、task 分配、pending queue | agent 状态转换测试、task 分配/取消测试、pending queue 排序测试 | U1-2, U1-3 |
| U2-2 | `AgentManifestRegistry`：注册、查找、精确匹配路由 | 注册/查找测试、manifest 匹配测试、优先级排序测试 | U1-1 |
| U2-3 | `ManifestBasedToolConstructionPlan`：从 manifest 生成 tool 构建计划 | tool 列表过滤测试、tool group 展开测试、与现有 tool catalog 集成测试 | U1-1, 现有 `tool-catalog.ts` |
| U2-4 | `TaskDependencyResolver`：依赖检测和并发决策 | 依赖检测测试、并发决策测试、串行化测试 | U1-2 |

**关联影响检查**：
- U2-3 需要与现有 `createOpenClawCodingTools` 和 `tool-policy-pipeline` 兼容——不替换它们，而是作为新路径并行存在
- 运行 `src/agents/*.test.ts` 确保不破坏现有 agent 测试

**预计工作量**：3-4 天

---

### Phase 3：Supervisor 核心 — IntentEngine + Router

**目标**：实现 Supervisor 的意图理解和 agent 路由逻辑。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U3-1 | `IntentEngine`：规则优先层（slash command 检测 + 关键词匹配 + 模板分类） | slash command 识别测试、关键词匹配测试、意图分类输出格式测试 | 无（纯逻辑） |
| U3-2 | `IntentEngine`：LLM 辅助层（轻量级 LLM call + 意图分类 prompt） | prompt 构建测试（不含 LLM call）、意图分类结构化输出测试 | U3-1, 现有 LLM 调用基础设施 |
| U3-3 | `AgentRouter`：精确匹配 + 语义匹配（使用 ManifestRegistry） | 精确路由测试、语义路由测试、fallback 路由测试、路由失败处理测试 | U2-2 |
| U3-4 | `SupervisorOrchestrator`：整合 IntentEngine + Router + ExecutionBoard | 端到端调度测试（mock 消息流 → mock 意图 → mock 路由 → mock 分配） | U3-1, U3-2, U3-3, U2-1 |

**关联影响检查**：
- U3-4 需要与现有 `dispatch-from-config.ts` 和 `agent-scope.ts` 并行兼容
- 运行 `src/auto-reply/*.test.ts` 和 `src/agents/agent-scope.test.ts`

**预计工作量**：4-5 天

---

### Phase 4：消息流改造 — ContextAccumulator + WithdrawalInterceptor

**目标**：改造入站层，从 SequentialQueue 到 Context Accumulator。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U4-1 | `ObservationWindow`：窗口创建、消息添加、超时管理 | 窗口生命周期测试、超时触发测试、消息聚合输出测试 | 无 |
| U4-2 | `ContextAccumulator`：整合 window + debouncer + dedup + claims | 消息流完整测试（快速消息 → 去抖 → 窗口 → 聚合）、dudup 测试、claims 测试 | U4-1, 现有 debouncer/dedup |
| U4-3 | `WithdrawalInterceptor`：撤回事件拦截 → Supervisor 通知 | 撤回事件解析测试、task 查找测试、interrupt 信号发送测试 | U1-4, U2-1 |
| U4-4 | Feishu `monitor.message-handler.ts` 改造：替换 SequentialQueue 为 ContextAccumulator | Feishu 入站集成测试、debounce 行为保留验证、dedup 行为保留验证 | U4-2, 现有 Feishu extension |

**关联影响检查**：
- U4-4 是**最关键的破坏性改动**——替换 Feishu extension 的核心入站机制
- 必须运行现有 Feishu extension 的所有测试
- 必须在 Feishu 测试群做手动 E2E 验证：消息发送、去抖、撤回

**Fallback**：U4-4 应保留 SequentialQueue 作为 fallback 路径。如果 ContextAccumulator 出问题，可以通过配置切换回 SequentialQueue。

**预计工作量**：5-6 天

---

### Phase 5：执行与回收 — Sub-Agent spawn + ResultCollector

**目标**：子 agent 执行和结果回收机制。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U5-1 | `SupervisorTaskSpawn`：从 SupervisorTask 创建子 agent session（使用现有 PI Runner） | session key 生成测试、manifest-bound tool 注入测试、structured task 注入测试 | U2-3, U3-4, 现有 PI Runner |
| U5-2 | `ResultCollector`：正常/异常/冲突/过期四种回收路径 | 正常回收测试、异常回收测试（retry/switch/inform）、冲突回收测试（优先级裁决）、过期回收测试（丢弃） | U2-1, U1-3 |
| U5-3 | `ReplyComposer`：单结果透传 + 多结果组装 + LLM 辅助合并 | 简单组装测试、结构化合并测试、fallback 测试 | U5-2 |
| U5-4 | `SupervisorReplyDispatcher`：整合 ResultCollector + ReplyComposer → channel delivery | 端到端回收测试（mock agent result → compose → mock channel delivery） | U5-2, U5-3 |

**关联影响检查**：
- U5-1 与现有 `sessions-spawn-tool.ts` 的关系——新路径不替换 spawn tool，而是 Supervisor 内部直接调用 spawn 逻辑
- U5-4 与现有 `reply-dispatcher.ts` 的关系——不替换，而是作为 Supervisor 层的新回复路径
- 运行 `src/agents/pi-embedded-runner/*.test.ts` 和 `src/auto-reply/*.test.ts`

**预计工作量**：4-5 天

---

### Phase 6：中断与注入 — Interrupt + Inject + Withdrawal

**目标**：实现 Supervisor 对子 agent 的中断、注入、撤回决策和执行。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U6-1 | `InterruptManager`：中断信号发送 + ExecutionBoard 状态更新 + 中间回复撤回 | 中断测试、状态更新测试、reply 撤回测试 | U2-1, U5-4 |
| U6-2 | `InjectManager`：Supervisor 主动注入到正在执行的子 agent（使用 steer 机制） | 注入消息格式测试、steer 调用测试、注入 vs 中断判断测试 | U5-1, 现有 steer |
| U6-3 | `WithdrawalManager`：飞书撤回事件完整处理链 | 撤回→中断→reply 删除→Board 更新完整链路测试 | U4-3, U6-1 |
| U6-4 | `FollowupClassifier`：新消息分类（补充/修正/意图变更/撤回/新意图） | 分类准确性测试、边界 case 测试、LLM 辅助分类 prompt 测试 | U3-1 |

**关联影响检查**：
- U6-2 与现有 `subagents` tool 的 steer/kill 功能——Supervisor 使用内部调用而非 tool 调用
- U6-3 需要在 Feishu 测试群验证撤回流程

**预计工作量**：4-5 天

---

### Phase 7：记忆系统 — MemoryEvent + MaterializedView

**目标**：实现事件流记忆和跨 agent 聚合。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U7-1 | `MemoryEventBus`：事件发布/订阅，子 agent → Supervisor | 事件发布测试、事件过滤测试（shouldPersist）、事件溯源测试 | U1-3 |
| U7-2 | `MaterializedViewEngine`：事件 → 物化视图异步聚合 | 聚合测试、preference merge 测试、task history 聚合测试 | U7-1 |
| U7-3 | `CredibilityScorer`：来源可信度计算 + 衰减权重计算 | domainExpertise score 测试、decayWeight 测试、冲突检测测试 | U2-2 |
| U7-4 | `SupervisorMemoryStore`：持久化物化视图 + 事件审计日志 | 存储读写测试、compaction 测试、重启恢复测试 | U7-2, U7-3 |

**关联影响检查**：
- 与现有 `memory-host-sdk` 的关系——不替换，而是作为 Supervisor 层的新记忆路径
- 运行 `packages/memory-host-sdk/*.test.ts`

**预计工作量**：3-4 天

---

### Phase 8：上下文工程 — TaskContextFragment + 可信度分层

**目标**：实现子 agent 上下文裁剪和可信度分层声明。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U8-1 | `TaskContextSelector`：从对话历史中选择 task 相关片段 | 片段选择测试、裁剪测试、跨域数据引用测试 | 无 |
| U8-2 | `CredibilityAnnotatedResult`：结果可信度标注 | 标注计算测试、domainExpertise 测试、freshness 测试 | U7-3 |
| U8-3 | `SupervisorSystemPromptBuilder`：可信度分层声明 + routing rules + agent summaries | prompt 构建测试、可信度声明格式测试、摘要 manifest 注入测试 | U2-2 |
| U8-4 | `SubAgentSystemPromptBuilder`：角色声明 + task 注入 + tool schema 注入 + context fragments | prompt 构建测试、manifest-bound tool schema 注入测试、task context 注入测试 | U8-1, U8-3 |

**预计工作量**：3-4 天

---

### Phase 9：Tool Schema 分层 — 摘要/完整注入

**目标**：实现复杂 tool schema 的摘要版/完整版分层注入。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U9-1 | `ToolSchemaCompressor`：从完整 schema 生成摘要版 schema | FeishuDocSchema 摘要生成测试、FeishuBitableSchema 摘要生成测试 | 现有 Feishu tool schemas |
| U9-2 | `SchemaUpgradeHook`：在 model 确认调用后动态替换为完整版 schema（见 04-sub-agents.md §3.3） | hook 触发测试、schema 替换测试、参数校验测试 | U9-1, 现有 PI Runner tool handling |
| U9-3 | `SupervisorRoutingPrompt`：注入摘要版 manifest + 摘要版 tool schema | routing prompt 构建测试、token 预算测试 | U9-1, U8-3 |

**预计工作量**：3-4 天

---

### Phase 10：集成与端到端验证

**目标**：全链路集成 + E2E 验证 + 性能基准。

| 单元 | 交付物 | 测试 | 依赖 |
|------|--------|------|------|
| U10-1 | 完整 Supervisor 集成：ContextAccumulator → IntentEngine → Router → ExecutionBoard → Spawn → ResultCollector → ReplyComposer | 全链路 mock 测试 | 所有 Phase |
| U10-2 | Feishu 端到端验证：真实飞书测试群的消息流、撤回、多 agent 并发场景 | 手动 E2E + 关键路径自动化测试 | U10-1, U4-4 |
| U10-3 | 性能基准：调度延迟、观察窗口延迟、并发利用率 | 延迟基准测试、吞吐基准测试 | U10-1 |
| U10-4 | Fallback 验证：确认单 agent fallback 路径正常工作、SequentialQueue fallback 正常工作 | fallback 路径测试 | U10-1 |

**预计工作量**：3-4 天

## 3. 总体时间线

| Phase | 内容 | 预计天数 | 累计 |
|-------|------|----------|------|
| 1 | 基础设施（类型定义） | 1-2 | 2 |
| 2 | 核心逻辑（Board + Registry） | 3-4 | 6 |
| 3 | Supervisor 核心（Intent + Router） | 4-5 | 11 |
| 4 | 消息流改造（Accumulator + Withdrawal） | 5-6 | 17 |
| 5 | 执行与回收（Spawn + Collector） | 4-5 | 22 |
| 6 | 中断与注入（Interrupt + Inject） | 4-5 | 27 |
| 7 | 记忆系统（Event + View） | 3-4 | 31 |
| 8 | 上下文工程（Fragment + Credibility） | 3-4 | 35 |
| 9 | Tool Schema 分层 | 3-4 | 39 |
| 10 | 集成与端到端 | 3-4 | 43 |

**总计约 40-45 天**（单人全职开发）。如果有多人协作，Phase 1-3、Phase 7-9 可并行。

## 4. 每阶段交付后的验收流程

```
单元开发完成
  │
  ├── 1. 运行该单元的 vitest 测试
  │     → 全部 pass → 继续
  │     → 有 fail → 修复后重跑
  │
  ├── 2. 运行受影响模块的已有测试
  │     → src/agents/*.test.ts
  │     → src/auto-reply/*.test.ts
  │     → packages/memory-host-sdk/*.test.ts
  │     → extensions/feishu/ 相关测试
  │     → 全部 pass → 继续
  │     → 有 fail → 分析是否为本改动引起 → 修复
  │
  ├── 3. 代码自查
  │     → 类型安全（无 implicit any）
  │     → 无安全隐患（无 injection/XSS）
  │     → 符合 CLAUDE.md 编码规范
  │
  └── 4. 交付确认
       → 标记 todo completed
       → git commit（按 CLAUDE.md 格式）
       → 进入下一个单元
```

## 5. 关键风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| Phase 4 替换 SequentialQueue 可能破坏飞书消息接收 | 高 | 保留 SequentialQueue 作为 fallback；配置切换 |
| PI Runner 与 Supervisor spawn 整合可能引入 session 状态冲突 | 高 | Supervisor session key 使用独立前缀；保留原有 session 机制不受影响 |
| LLM 辅助调度的延迟可能过高 | 中 | 规则优先层覆盖 80% 场景；LLM 辅助层只在规则未命中时触发；使用轻量级模型 |
| 撤回 API 调用失败（飞书限制） | 中 | 失败时记录日志+告知用户；不阻塞其他流程 |
| 子 agent 跨域授权请求的实现复杂度 | 中 | P2 优先级，先实现基础版本（授权/拒绝），LLM 裁决延后 |
| 可回放 DAG 的存储开销 | 低 | 使用 compressed JSON；定期清理超过 7 天的 trace 数据 |