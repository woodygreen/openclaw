# 需求文档

## 功能需求

### FR-01：Supervisor 全局调度

Supervisor Agent 作为全局观察者和调度者，负责：

| ID | 需求 | 验收标准 |
|----|------|----------|
| FR-01-01 | 意图理解与整体判断 | Supervisor 收到消息流后，形成整体意图判断而非逐条响应。用户发"查项目进度"→"项目A"→"算了不用了"，Supervisor 应判定最终意图为"放弃查询" |
| FR-01-02 | 任务拆解与分配 | 将用户意图拆解为可执行的子任务，分配给合适的子 agent。拆解结果包含：任务描述、目标 agent、边界约束、优先级 |
| FR-01-03 | 中断决策 | 当用户补充信息改变意图时，Supervisor 决定是否中断正在执行的子 agent |
| FR-01-04 | 注入决策 | 当用户补充信息不改变意图但提供额外上下文时，Supervisor 决定是否注入到正在执行的子 agent |
| FR-01-05 | 撤回决策 | 当用户撤回消息（飞书撤回功能）时，Supervisor 决定是否终止子 agent 并撤回已发出的回复 |
| FR-01-06 | 结果回收与组装 | 子 agent 执行完成后，产出回流到 Supervisor，由 Supervisor 组装最终回复发给用户 |
| FR-01-07 | 冲突仲裁 | 当两个子 agent 产出冲突时，Supervisor 决定取哪个、合并、或要求重跑 |
| FR-01-08 | 中断成本分析 | 当新消息与正在执行的 task 相关但需要扩展时，Supervisor 评估中断成本（工作损失、恢复可行性、用户影响），决策中断/延迟/注入，而非简单中断。关键规则：(a) 已 commit 不可逆副作用 → 不中断；(b) 进度 >80% 且已超时 → 不中断；(c) 进度 <30% 且可恢复 → 中断并 checkpoint；(d) 不可恢复 → 不中断，通知用户等待 |
| FR-01-09 | Staged Side Effects | 副作用操作（飞书文档写入、bitable 创建等）不立即执行，先写入 staging area。Supervisor 控制 commit 时机：任务完成 → commit；任务中断 → discard staging area（无回滚成本） |
| FR-01-10 | 用户承诺管理 | Supervisor 通知用户"完成后跟进"时，必须记录承诺并在任务完成后主动 fulfill（通知+执行追加需求）。说到做到，不能发了通知后忘记 |

### FR-02：Sub-Agent 分工与协调

| ID | 需求 | 验收标准 |
|----|------|----------|
| FR-02-01 | 角色 Manifest | 每个子 agent 有结构化 manifest 声明：capability（能做什么）、boundary（不能做什么）、priority（同类任务优先级）、reject_patterns（明确拒绝的任务类型） |
| FR-02-02 | Supervisor 路由 | Supervisor 根据 manifest 将任务路由到最合适的子 agent。路由支持精确匹配、语义匹配、广播竞标三种策略 |
| FR-02-03 | 保底冲突解决 | 当两个 agent claim 同一任务时：优先级仲裁 → Supervisor 裁决 → 结果合并，三级递进 |
| FR-02-04 | 独立 context | 子 agent 有独立的 transcript/session，不共享上下文，避免跨 agent 上下文污染 |
| FR-02-05 | 跨域授权 | 子 agent 执行中发现需要超出 manifest 范围的 tool 时，需向 Supervisor 请求授权，不能直接调用 |

### FR-03：IM 消息流处理

| ID | 需求 | 验收标准 |
|----|------|----------|
| FR-03-01 | 消息观察窗口 | 消息到来后不立即触发 agent turn，而是先进入观察窗口进行自然积累 |
| FR-03-02 | 消息聚合 | 观察窗口内的多条消息聚合为一个完整的 user context，整体理解后再分发 |
| FR-03-03 | 信息补充 | 用户发送补充信息时，系统应将其注入到当前执行上下文而非排队等下一 turn |
| FR-03-04 | 错误修正 | 用户发送修正信息时，系统应调整当前执行方向而非忽略修正 |
| FR-03-05 | 撤回处理 | 飞书撤回事件触发时：(a) 中断关联的正在执行的子 agent；(b) 撤回已发出的回复（调用飞书撤回 API）；(c) 更新 Supervisor 上下文状态 |
| FR-03-06 | 快速消息去抖 | 同一用户同一 chat 的快速连续文本消息应去抖合并（现有 inboundDebouncer 机制保留） |

### FR-04：并发控制与结果回收

| ID | 需求 | 验收标准 |
|----|------|----------|
| FR-04-01 | Execution Board | Supervisor 维护全局执行状态面板，展示每个子 agent 的状态（idle/running/waiting）和当前任务 |
| FR-04-02 | 主动并发调度 | Supervisor 主动决定哪些子 agent 可以并发执行，而非被动排队。不同 agent 之间天然并发，同一 agent 内默认串行 |
| FR-04-03 | 结果回收策略 | 所有子 agent 产出经 Supervisor 过滤后才到用户。回收路径：正常回收、异常回收（重试/换 agent/告知用户）、冲突回收（裁决/合并/重跑）、过期回收（意图变更→丢弃） |
| FR-04-04 | 并行 Tool Calling 依赖检测 | 子 agent 内并行 tool call 时，检测先写后读依赖，有依赖则强制串行 |
| FR-04-05 | 可回放执行 DAG | 每次工具调用带 trace_id、step_id、输入输出和耗时，组成可回放执行 DAG |
| FR-04-06 | 幂等性保障 | 涉及副作用操作（如飞书消息发送、bitable 写入）的 tool call 需加幂等键，防止重复写入 |

### FR-05：上下文工程

| ID | 需求 | 验收标准 |
|----|------|----------|
| FR-05-01 | 可信度分层声明 | Supervisor 的 system prompt 明确声明：Supervisor 自身任务拆解 > 子 agent 执行结果 > 用户原始输入 > 模型猜测 |
| FR-05-02 | 子 agent 任务相关性裁剪 | 子 agent 只收到 Supervisor 指定的 task + 限定范围的 tool schema + 必要的上下文片段，不是整个对话历史 |
| FR-05-03 | 结构化任务描述 | Supervisor 给子 agent 的 task 是结构化的（task_type、目标、约束、截止条件），而非自然语言泛指 |
| FR-05-04 | 上下文格式控制 | 工具结果用 JSON、任务状态字段化、长历史做摘要，减少纯自然语言上下文占比 |

### FR-06：记忆系统

| ID | 需求 | 验收标准 |
|----|------|----------|
| FR-06-01 | 事件流模式 | 子 agent 的关键产出以事件形式回流到 Supervisor，而非直接写入共享 transcript |
| FR-06-02 | 物化视图 | Supervisor 维护跨 agent 的物化视图（用户画像、偏好、长期任务状态），由事件异步聚合 |
| FR-06-03 | 来源标注 | 每条记忆记录标注 source_agent_id + confidence_weight，不同来源的可信度不同 |
| FR-06-04 | 时效衰减 | 短期热点信息高权重但随时间衰减，长期稳定偏好低频刷新但不轻易删除 |
| FR-06-05 | 冲突消解 | 结合时间戳、来源可信度和置信度：高可信度事实覆盖旧事实，低可信内容仅作为候选 |

### FR-07：Tool 路由与注入

| ID | 需求 | 验收标准 |
|----|------|----------|
| FR-07-01 | Manifest-based tool 过滤 | 子 agent 的可用 tool 列表受 manifest 限制，不在 manifest 范围内的 tool 不注入 |
| FR-07-02 | 限定范围内模型自选 | 在 manifest 限定范围内，子 agent 的 LLM 自行决定调哪个 tool、什么顺序 |
| FR-07-03 | 摘要/完整分层注入 | Supervisor 做意图判断时只看各 agent 的摘要 manifest；确认委派后，才把对应 agent 的完整 tool schema 注入 |
| FR-07-04 | 跨域授权机制 | 子 agent 请求超出 manifest 范围的 tool → 向 Supervisor 发授权请求 → Supervisor 决定是否委派给其他 agent 或临时授权 |
| FR-07-05 | Tool Schema 压缩 | 对复杂 schema（如 FeishuDocSchema 的 16+ action 变体）提供摘要版和完整版，先注入摘要，确认调用后再加载详细说明 |

## 非功能需求

### NFR-01：性能

| ID | 需求 | 目标 |
|----|------|------|
| NFR-01-01 | Supervisor 调度延迟 | 规则引擎调度的决策延迟 < 50ms；LLM 辅助调度的决策延迟 < 2s |
| NFR-01-02 | 观察窗口延迟 | 消息观察窗口默认 2-5s，可配置。用户快速发多条消息时不应有明显等待感 |
| NFR-01-03 | 子 agent 并发利用率 | 不同子 agent 的任务应充分利用并发能力，避免不必要的串行等待 |

### NFR-02：稳定性

| ID | 需求 | 目标 |
|----|------|------|
| NFR-02-01 | 子 agent 故障隔离 | 单个子 agent 故障不影响 Supervisor 和其他子 agent 的运行 |
| NFR-02-02 | Supervisor 故障恢复 | Supervisor 故障时，已完成的子 agent 结果保留，重启后可恢复执行状态 |
| NFR-02-03 | 并发结果一致性 | 并发执行的子 agent 结果通过临时观察区 + 统一合并保障一致性 |
| NFR-02-04 | 幂等性 | 副作用操作幂等，重复执行不产生额外副作用 |

### NFR-03：可观测性

| ID | 需求 | 目标 |
|----|------|------|
| NFR-03-01 | 执行 DAG 可回放 | 每次任务执行有完整的 trace_id/step_id DAG，支持事后审计 |
| NFR-03-02 | Execution Board 实时可见 | Supervisor 维护的执行状态面板实时可查询 |
| NFR-03-03 | 子 agent 状态追踪 | 每个子 agent 的 lifecycle（spawned → running → completed/failed/aborted）可追踪 |

### NFR-04：兼容性

| ID | 需求 | 目标 |
|----|------|------|
| NFR-04-01 | 渐进式迁移 | 改造可分阶段进行，每个阶段完成后系统可正常运行，无需一次性切换 |
| NFR-04-02 | 飞书 Extension 兼容 | 改造不破坏现有飞书 extension 的功能，撤回处理为新增而非替换 |
| NFR-04-03 | 单 agent 模式保留 | 不需要 Supervisor 的场景（如简单问答）仍可走原有的单 agent 路径 |
| NFR-04-04 | MCP/Plugin Tool 兼容 | manifest-based 过滤不破坏现有 MCP 和 Plugin tool 的注册机制 |

### NFR-05：可扩展性

| ID | 需求 | 目标 |
|----|------|------|
| NFR-05-01 | 新 Agent 快速注册 | 新增子 agent 只需定义 manifest 并注册到 Supervisor，无需修改调度逻辑 |
| NFR-05-02 | 新 Channel 快速接入 | 新增 channel（如 WhatsApp、Telegram）只需实现消息适配器接入 Context Accumulator |
| NFR-05-03 | 新 Tool 快速注册 | 新增 tool 只需在对应子 agent 的 manifest 中声明 capability，无需修改全量 catalog |

## 需求优先级

### P0 — 必须实现（核心架构改造）

- FR-01-01/02/06（Supervisor 意图理解、任务拆解、结果回收）
- FR-01-08/10（中断成本分析、用户承诺管理）
- FR-02-01/02（角色 Manifest、路由）
- FR-02-04（独立 context——子 agent 隔离前提，应提升到 P0）
- FR-03-01/02/05（观察窗口、消息聚合、撤回处理）
- FR-04-01/02/03（Execution Board、主动调度、结果回收策略）
- FR-05-01/02（可信度分层、任务相关性裁剪）
- FR-07-01/02（Manifest-based tool 过滤、限定范围内自选）
- NFR-02-01（故障隔离）
- NFR-04-01（渐进式迁移）

### P1 — 应该实现（增强能力）

- FR-01-03/04/05（中断、注入、撤回决策）
- FR-01-09（Staged Side Effects——完成后生效机制，渐进式实现）
- FR-02-03/05（保底冲突解决、跨域授权）
- FR-04-04/05/06（并行 tool 依赖检测、可回放 DAG、幂等键）
- FR-05-03/04（结构化任务描述、格式控制）
- FR-06-01/02/03（事件流、物化视图、来源标注）
- FR-07-03/05（摘要/完整分层、Schema 压缩）
- NFR-01-01/02（调度延迟、观察窗口延迟）
- NFR-03-01/02/03（可回放、状态可见、lifecycle 追踪）

### P2 — 可以延后（锦上添花）

- FR-02-02 广播竞标路由策略（部分）
- FR-04-06（幂等键——已移至 P1）
- FR-06-04/05（时效衰减、冲突消解）
- FR-07-04（跨域授权完整机制）
- NFR-01-03（并发利用率优化）
- NFR-05-02/03（新 Channel/Tool 快速注册）