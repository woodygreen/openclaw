# 部署与迁移策略

## 1. 渐进式迁移原则

- **不一次性切换**：每个阶段部署后系统正常运行，新旧路径并存
- **配置驱动切换**：通过 openclaw.yaml 配置选择使用新架构还是旧架构
- **保留 fallback 路径**：新机制故障时可退回原有路径
- **先内部测试再生产部署**：每个 Phase 先在 dev/test 环境验证，再推进到 prod

## 2. 配置开关设计

### 2.1 openclaw.yaml 新增配置

```yaml
# Supervisor architecture configuration
supervisor:
  # Global switch: enable/disable supervisor mode
  # When disabled, system falls back to legacy single-agent mode
  enabled: false                    # default: false (start with legacy mode)

  # Intent engine configuration
  intent:
    ruleBasedEnabled: true          # enable rule-based intent classification
    llmAssistedEnabled: false       # enable LLM-assisted classification (Phase 3)
    llmModel: "claude-haiku-4-5"    # lightweight model for intent classification

  # Context accumulator configuration
  accumulator:
    windowTimeoutMs: 3000           # observation window base timeout
    maxWindowTimeoutMs: 8000        # observation window max timeout
    rapidSendThresholdMs: 1500      # rapid send window extension
    fallbackToSequentialQueue: true # fallback to legacy queue if accumulator fails

  # Execution board configuration
  board:
    maxConcurrentAgents: 4          # max concurrent running agents
    taskTimeoutMs: 300000           # per-task timeout (5 min)
    pendingQueueMaxSize: 20         # max pending tasks per agent

  # Result collector configuration
  collector:
    retryOnFailure: true            # retry failed tasks
    maxRetries: 2                   # max retry count per task
    fallbackAgentId: "agent-chat"   # fallback agent for routing failures

  # Memory configuration
  memory:
    eventStreamEnabled: false       # enable event stream (Phase 7)
    materializedViewEnabled: false  # enable materialized view (Phase 7)
    decayHalfLifeMs: 604800000      # 7 days default decay

  # Withdrawal configuration
  withdrawal:
    enabled: false                  # enable withdrawal handling (Phase 6)
    recallApiTimeoutMs: 5000        # Feishu recall API timeout

# Agent manifests (new format)
agents:
  list:
    - id: agent-doc
      label: Document Operations
      manifest:
        toolIds: [feishu_doc, feishu_doc_legacy, feishu_wiki, feishu_drive, feishu_perm, read, write, edit]
        capabilities: [...]
        boundaries: [...]
        rejectPatterns: [...]
        priority: 80
        taskTypes: [create, update, read]
        keywords: [文档, doc, wiki, 知识库, drive, 云文档]

    - id: agent-data
      label: Data & Query
      manifest:
        toolIds: [feishu_bitable_get_meta, feishu_bitable_list_fields, ...]
        priority: 70
        taskTypes: [query, read]

    - id: agent-ci
      label: CI/CD Management
      manifest:
        toolIds: [exec, process, gateway, cron, sessions_list]
        priority: 60

    - id: agent-chat
      label: General Chat
      manifest:
        toolIds: [message, image, memory_search, memory_get, session_status]
        priority: 10

# Legacy mode (when supervisor.enabled = false)
# Falls back to current single-agent architecture
# All existing config options continue to work
```

### 2.2 切换策略

| 阶段 | 配置状态 | 说明 |
|------|----------|------|
| Phase 1-2 完成后 | `supervisor.enabled: false` | 新类型/逻辑已定义，但不激活 |
| Phase 3 完成后 | `supervisor.intent.ruleBasedEnabled: true` | 规则意图分类可独立验证 |
| Phase 4 完成后 | `supervisor.accumulator.windowTimeoutMs: 3000` | Accumulator 可替代 SequentialQueue（但 fallback 开启） |
| Phase 5 完成后 | `supervisor.enabled: true` + `fallbackToSequentialQueue: true` | 全链路激活，但保留 fallback |
| Phase 6 完成后 | `supervisor.withdrawal.enabled: true` | 撤回处理激活 |
| Phase 7-9 完成后 | `supervisor.memory.eventStreamEnabled: true` | 记忆系统激活 |
| Phase 10 完成后 | `fallbackToSequentialQueue: false` | 移除 fallback，完全切换 |

## 3. 部署流程

### 3.1 单 Phase 部署

```
Phase 开发完成 + 测试通过
  │
  ├── 1. 代码合并到 dev 分支
  │
  ├── 2. dev 环境部署
  │     → docker:dev 重启
  │     → 配置更新（openclaw.yaml 新字段）
  │     → 基本功能验证（health check + 发消息测试）
  │
  ├── 3. test 环境部署
  │     → docker:test 重启
  │     → 飞书测试群验证
  │     → 关键路径 E2E 测试
  │
  ├── 4. 验证通过 → 合并到 main
  │
  └── 5. 验证失败 → 回滚到上一个 Phase 的状态
       → 分析失败原因
       → 修复后重新验证
```

### 3.2 Feishu Extension 特殊部署

飞书 Extension 的改造（Phase 4 的 U4-4）需要特别小心：

- Feishu bot 服务的重启会影响所有使用该 bot 的用户
- 需要在非工作时间或低流量时段部署
- 部署前必须确认 fallback 路径可用

```
U4-4 部署流程:
  │
  ├── 1. 确认 fallbackToSequentialQueue: true
  │
  ├── 2. 部署新版 monitor.message-handler.ts
  │     → Feishu bot WebSocket/Webhook 服务重启
  │
  ├── 3. 立即在测试群发消息验证
  │     → 消息正常接收 → 继续监控 30min
  │     → 消息接收异常 → 切换回 SequentialQueue（改配置重启）
  │
  ├── 4. 30min 监控正常 → 切换到 ContextAccumulator
  │
  └── 5. 撤回事件处理测试
       → 在测试群发消息 → 撤回 → 验证 bot 行为
```

## 4. 回滚方案

### 4.1 配置回滚

```yaml
# Emergency rollback: set supervisor.enabled = false
# All other supervisor config becomes irrelevant
# System falls back to legacy single-agent mode

supervisor:
  enabled: false
```

配置回滚只需重启服务，不需要代码回滚。

### 4.2 代码回滚

如果配置回滚不能解决问题（代码改动破坏了 legacy 路径）：

```bash
# Git rollback to the last verified Phase commit
git revert <phase-commit-hash>

# Or reset to specific Phase state
git checkout <verified-phase-tag>
```

**预防措施**：每个 Phase 完成后打 tag：

```bash
git tag supervisor-phase-1
git tag supervisor-phase-2
...
git tag supervisor-phase-10
```

### 4.3 数据回滚

Supervisor 新增的数据结构（事件流、物化视图、执行 trace）：

- 事件流：append-only，不需要回滚（只是不再写入新事件）
- 物化视图：在 Supervisor 禁用时停止更新，但已写入的数据保留
- 执行 trace：7 天自动清理，不需要手动回滚

Legacy 模式下这些数据不影响运行——Supervisor 关闭后这些路径不再被调用。

## 5. 数据迁移

### 5.1 不需要数据迁移的组件

| 组件 | 原因 |
|------|------|
| AgentManifest | 纯配置数据，首次部署时在 openclaw.yaml 中定义 |
| ExecutionBoard | 运行时状态，重启后从空状态开始 |
| ContextAccumulator | 运行时状态，重启后从空状态开始 |
| WithdrawalInterceptor | 运行时逻辑，无持久化数据 |

### 5.2 需要数据适配的组件

| 组件 | 适配 | 说明 |
|------|------|------|
| Session Keys | 子 agent session key 嵌入 `supervisor:` 标记（使用 `agent:` 前缀保证兼容性） | 格式为 `agent:{parentAgentId}:supervisor:{agentId}:task:{taskId}`，不引入新顶层前缀，见 04-sub-agents.md §4.2 |
| Memory Event Stream | 新增事件存储目录 | `~/.openclaw/supervisor/events/`，不与现有 `~/.openclaw/feishu/dedup/` 冲突 |
| Materialized View | 新增视图存储文件 | `~/.openclaw/supervisor/views/user-profile.json` |
| Execution Trace | 新增 trace 存储目录 | `~/.openclaw/supervisor/traces/` |

### 5.3 现有数据兼容

- Session files：保持原有格式，子 agent session key 使用 `agent:` 前缀 + rest 嵌入 `supervisor:` 标记（兼容 parseAgentSessionKey），内部格式不变
- Transcript files：Supervisor transcript 和子 agent transcript 都使用现有 JSON 格式
- Feishu dedup files：保持原有目录结构和 TTL

## 6. 监控与可观测性

### 6.1 新增监控指标

| 指标 | 采集方式 | 说明 |
|------|----------|------|
| `supervisor_intent_classification_latency_ms` | ExecutionBoard trace | 意图分类延迟 |
| `supervisor_routing_latency_ms` | ExecutionBoard trace | Agent 路由延迟 |
| `supervisor_agent_spawn_latency_ms` | ExecutionBoard trace | 子 agent 启动延迟 |
| `supervisor_result_collection_latency_ms` | ExecutionBoard trace | 结果回收延迟 |
| `supervisor_window_duration_ms` | ContextAccumulator metrics | 观察窗口时长 |
| `supervisor_window_message_count` | ContextAccumulator metrics | 窗口内消息数 |
| `supervisor_agent_concurrent_count` | ExecutionBoard state | 并发 agent 数量 |
| `supervisor_task_success_rate` | ExecutionBoard metrics | 任务成功率 |
| `supervisor_withdrawal_handled_count` | WithdrawalInterceptor metrics | 撤回处理次数 |
| `supervisor_conflict_resolution_count` | ConflictArbitrator metrics | 冲突解决次数 |

### 6.2 日志策略

Supervisor 相关日志使用统一前缀 `[supervisor]`：

```
[supervisor] intent classified: type=query, confidence=0.9, method=rule-based
[supervisor] routed task-1 to agent-data (exact match)
[supervisor] window closed: chatId=xxx, messages=2, durationMs=4500
[supervisor] result collected: task-1, agent-data, status=completed
[supervisor] withdrawal handled: messageId=xxx, tasksInterrupted=1, repliesRecalled=0
[supervisor] conflict resolved: task-2 vs task-3, method=priority, winner=agent-doc
```

### 6.3 Health Check 扩展

现有 `/health` endpoint 扩展为包含 Supervisor 状态：

```json
{
  "status": "healthy",
  "components": {
    "database": { "status": "healthy" },
    "cache": { "status": "healthy" },
    "integrations": { "status": "healthy" },
    "queue": { "status": "healthy" },
    "supervisor": {
      "status": "active",
      "agents": {
        "agent-doc": "idle",
        "agent-data": "running",
        "agent-ci": "idle",
        "agent-chat": "idle"
      },
      "pendingTasks": 0,
      "activeTasks": 1
    }
  }
}
```

当 `supervisor.enabled: false` 时，health check 不包含 supervisor 组件。

## 7. 生产部署 Checklist

每个 Phase 推进到生产前必须确认：

- [ ] 该 Phase 所有单元测试 pass
- [ ] 受影响模块的已有测试 pass
- [ ] Feishu 测试群 E2E 验证通过
- [ ] 配置开关正确设置（新功能启用/旧 fallback 保留）
- [ ] Health check 包含新组件状态
- [ ] 监控指标正常采集
- [ ] 日志输出符合预期格式
- [ ] 回滚方案已验证（能退回上一个 Phase）
- [ ] 数据目录已创建（`~/.openclaw/supervisor/`）
- [ ] Git tag 已打（`supervisor-phase-N`）