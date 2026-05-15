# Supervisor + Sub-Agents 架构改造 — 概述

## 状态

`DRAFT` — 2026-05-15 初稿，待评审

## 1. 问题陈述

当前 OpenClaw 的 agent 执行架构是**单层扁平结构**：

```
用户消息 → SequentialQueue → handleFeishuMessage → agent turn (PI runner) → LLM 自选 tool → 执行 → 回复
```

该架构在 IM 对话场景下暴露了以下根本问题：

### 1.1 缺乏全局视角的决策者

没有"站在全局视角做决策"的角色。当前架构中：
- 消息逐条进入 SequentialQueue 排队，逐条触发 agent turn
- 模型自己选 tool（全量 schema 灌给 LLM），没有外部路由
- 子 agent 是"委派"而非"调度"——`sessions_spawn` 是当前 agent 自己决定要不要生一个子 agent
- 没有人判断是否需要中断正在执行的任务、注入补充信息、或撤回已有回复

### 1.2 不符合 IM 对话流的真实行为

IM 对话中，人的行为模式是：
- **信息补充**：多条消息快速发送，整体理解而非逐条响应
- **错误修正**："帮我查项目进度" → "哦是项目A" → 自然修正
- **意图撤回**："算了不用查了" → 应该中断正在执行的查询
- **消息撤回**：飞书有撤回功能，撤回应引发任务中断和回复撤回

当前架构把每条消息当作独立 turn 处理，无法理解消息流的整体意图。

### 1.3 并发靠被动排队而非主动调度

三层串行锁（SequentialQueue → CommandQueue Lane → SessionWriteLock）是"被动排队"，不是"主动调度"。结果：
- 同一 session 严格串行，不同 session 才能并行——缺乏任务级并发规划
- 没有结果回收策略——agent 直接发回复给用户，两个 agent 可能发矛盾回复
- 没有执行状态面板——无法全局观察哪些 agent 在做什么

### 1.4 Tool 全量注入导致噪声和混淆

30+ core tools + 6+ Feishu tools + MCP tools + plugin tools 的全量 schema 每次都传给模型。FeishuDocSchema 单独就是 16+ action 变体的 Type.Union。模型在候选技能噪声大时容易误选 tool，且浪费 context window。

## 2. 架构愿景

改为 **Supervisor Agent + Sub-Agents** 分层架构：

```
用户消息流 → Context Accumulator → Supervisor Orchestrator
                                       ├── 意图理解 → 任务拆解
                                       ├── Agent 路由 → 子 agent 分配
                                       ├── Execution Board（状态面板）
                                       ├── 中断/注入/撤回决策
                                       ├── 结果回收 → 组装回复
                                       └── 冲突仲裁
                                       │
                                       ├── Agent-A（文档操作）
                                       ├── Agent-B（数据查询）
                                       ├── Agent-C（CI/CD 管理）
                                       └── Agent-D（通用对话）
```

核心转变：
- **从 turn-based 到 context-stream-based**：消息先观察积累，再整体理解
- **从被动排队到主动调度**：Supervisor 主动决定并发策略
- **从全量 schema 到 manifest-based 按需注入**：子 agent 只收到角色范围内的 tool
- **从直接回复到结果回收**：所有子 agent 产出经 Supervisor 过滤后才到用户

## 3. 设计原则摘要

基于 `agents_rules.md` 的验证和讨论，确立以下核心原则：

| # | 原则 | 来源 |
|---|------|------|
| P1 | Skill/Tool 外部注册 + 按需动态注入 | agents_rules §1 |
| P2 | 上下文工程：角色隔离 + 可信度分层 | agents_rules §2 |
| P3 | 长期记忆：事件流 + 物化视图 + 来源标注 | agents_rules §3 |
| P4 | 并行执行：依赖检测 + 临时观察区 + 可回放 DAG | agents_rules §4 |
| P5 | 混合架构模式：Plan-and-Execute + Router + Workflow + Supervisor | agents_rules §5 补充 |
| P6 | Supervisor 决策分场景：语义理解调 LLM，调度仲裁用规则引擎 | 讨论共识 |
| P7 | 子 agent manifest 限定 tool 范围，跨域需 Supervisor 授权 | 讨论共识 |
| P8 | 结果回收策略：正常/异常/冲突/过期四种回收路径 | 讨论共识 |

详细设计原则见各专题文档。

## 4. 文档索引

| 文档 | 内容 |
|------|------|
| [01-requirements.md](01-requirements.md) | 功能需求 + 非功能需求 |
| [02-architecture.md](02-architecture.md) | 整体架构图、数据流、核心组件 |
| [03-supervisor.md](03-supervisor.md) | Supervisor Agent 角色定义、决策逻辑、生命周期 |
| [04-sub-agents.md](04-sub-agents.md) | Sub-Agent manifest、分工机制、协调模型 |
| [05-concurrency.md](05-concurrency.md) | 并发控制、冲突解决、结果回收 |
| [06-context-and-memory.md](06-context-and-memory.md) | 上下文工程、记忆系统、可信度分层 |
| [07-message-lifecycle.md](07-message-lifecycle.md) | IM 消息流：观察窗口、中断、撤回 |
| [08-implementation-plan.md](08-implementation-plan.md) | TDD 分阶段实现计划 + milestones |
| [09-deployment.md](09-deployment.md) | 部署策略、迁移路径、回滚方案 |

## 5. 影响范围

本次架构改造涉及以下现有子系统：

| 子系统 | 现状 | 改造范围 |
|--------|------|----------|
| 入站层 | `extensions/feishu/src/sequential-queue.ts` + `monitor.message-handler.ts` | 替换 SequentialQueue 为 Context Accumulator；新增撤回事件处理 |
| 调度层 | 无独立调度层 | 新增 Supervisor Orchestrator |
| 执行层 | `src/agents/pi-embedded-runner/` | 保留 PI runner 作为子 agent 执行引擎；新增 Execution Board |
| Tool 层 | `src/agents/tool-catalog.ts` + `tool-policy-pipeline.ts` + `pi-tools.ts` | 改为 manifest-based 按需注入 + 跨域授权 |
| 出站层 | `src/auto-reply/` | 结果回收到 Supervisor → 组装后发给用户 |
| Session 层 | 单 session 单 transcript | Supervisor transcript + 各子 agent 独立 transcript |
| 记忆层 | `packages/memory-host-sdk/` | 新增事件流 + 物化视图 + 跨 agent 聚合 |
| Queue 层 | `src/auto-reply/reply/queue/` | 与 Context Accumulator 整合 |
| 飞书 Extension | `extensions/feishu/src/` | 新增撤回事件 → Supervisor 中断路径 |