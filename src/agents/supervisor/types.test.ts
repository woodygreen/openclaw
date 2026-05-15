import { describe, expect, it } from "vitest"
import type {
  AgentManifest,
  CapabilitySpec,
  BoundarySpec,
  RejectPattern,
  SupervisorTask,
  TaskConstraint,
  SubTaskSpec,
  AgentExecState,
  ExecutionBoard,
  SupervisorAgentResult,
  SupervisorArtifact,
  SupervisorToolCallTraceEntry,
  SupervisorFinalReply,
  WithdrawalEvent,
  IntentType,
  TaskType,
  IntentHint,
  IntentClassification,
  RuleClassificationResult,
  PendingDecision,
  RaceConditionAction,
  InterruptCostAssessment,
  StagedSideEffect,
  CrossDomainAuthRequest,
  CrossDomainAuthResponse,
  UserPromise,
  SupervisorRawMessage,
  SupervisorAccumulatedUserContext,
  ObservationWindow,
  ObservationWindowState,
  TaskDependency,
  FollowupClassification,
  SchemaUpgradeHook,
  SchemaUpgradeResult,
  SupervisorResultEventBus,
  CredibilityAnnotatedResult,
  CredibilityAnnotation,
  CredibilityLevel,
  SupervisorMemoryEvent,
  MemoryEventType,
  SupervisorInsight,
  SupervisorPreferenceUpdate,
  InterruptReason,
  SupervisorMediaAttachment,
  SupervisorMention,
  TaskHistorySummary,
  ActiveContextState,
  SupervisorPreferenceEntry,
  SupervisorUserProfile,
  SupervisorMaterializedView,
  SupervisorAnnotatedMemoryEntry,
  SupervisorTranscriptEntry,
} from "./types.js"
import {
  AGENT_DOC_MANIFEST,
  AGENT_DATA_MANIFEST,
  AGENT_CI_MANIFEST,
  AGENT_CHAT_MANIFEST,
  DEFAULT_AGENT_MANIFESTS,
  getDefaultManifestById,
  getDefaultManifestsByTaskType,
} from "./default-manifests.js"

// ─── Type Structure Validation Tests ───
// Phase 1 TDD: verify all type definitions compile and structurally conform
// to the design documents (02-architecture.md, 04-sub-agents.md, etc.)

describe("AgentManifest", () => {
  it("has all required fields per 04-sub-agents.md §1.1", () => {
    const manifest: AgentManifest = {
      id: "agent-doc",
      label: "Document Operations",
      description: "Feishu doc operations",
      capabilities: [],
      boundaries: [],
      rejectPatterns: [],
      toolIds: ["feishu_doc"],
      priority: 80,
      taskTypes: ["create"],
      keywords: ["文档"],
      summaryManifest: "Feishu doc operations",
    }
    expect(manifest.id).toBe("agent-doc")
    expect(manifest.priority).toBe(80)
    expect(manifest.summaryManifest).toBeTruthy()
  })

  it("supports optional toolGroups and maxContextTokens", () => {
    const manifest: AgentManifest = {
      id: "agent-doc",
      label: "Document Operations",
      description: "Feishu doc operations",
      capabilities: [],
      boundaries: [],
      rejectPatterns: [],
      toolIds: ["feishu_doc"],
      toolGroups: ["group:fs"],
      priority: 80,
      taskTypes: ["create"],
      keywords: ["文档"],
      maxContextTokens: 4096,
      systemPromptTemplate: "doc-agent-template",
      summaryManifest: "Feishu doc operations",
    }
    expect(manifest.toolGroups).toEqual(["group:fs"])
    expect(manifest.maxContextTokens).toBe(4096)
  })
})

describe("CapabilitySpec", () => {
  it("has domain, actions, scopeDescription per 02 §5.1a", () => {
    const cap: CapabilitySpec = {
      domain: "feishu_doc",
      actions: ["read", "write", "append", "create"],
      scopeDescription: "Feishu document operations",
    }
    expect(cap.domain).toBe("feishu_doc")
    expect(cap.actions).toContain("read")
  })
})

describe("BoundarySpec", () => {
  it("has domain, reason, overrideAllowed per 02 §5.1a", () => {
    const boundary: BoundarySpec = {
      domain: "ci",
      reason: "CI operations require agent-ci",
      overrideAllowed: false,
    }
    expect(boundary.overrideAllowed).toBe(false)
  })
})

describe("RejectPattern", () => {
  it("has pattern, reason, optional redirectTo per 02 §5.1a", () => {
    const rp: RejectPattern = {
      pattern: "CI|构建|部署|pipeline",
      reason: "CI operations are handled by agent-ci",
      redirectTo: "agent-ci",
    }
    expect(rp.redirectTo).toBe("agent-ci")
  })

  it("works without redirectTo", () => {
    const rp: RejectPattern = {
      pattern: "文档|写文档",
      reason: "Outside scope",
    }
    expect(rp.redirectTo).toBeUndefined()
  })
})

describe("SupervisorTask", () => {
  it("has all required fields per 02 §5.2", () => {
    const task: SupervisorTask = {
      id: "task-001",
      type: "query",
      description: "查询项目进度",
      targetAgentId: "agent-data",
      constraints: [],
      priority: 70,
      parentMessageIds: ["msg-001"],
    }
    expect(task.type).toBe("query")
    expect(task.parentMessageIds).toEqual(["msg-001"])
  })

  it("supports optional fields: dependsOn, deadlineMs, crossDomainRequests, isFollowup", () => {
    const task: SupervisorTask = {
      id: "task-002",
      type: "create",
      description: "写文档引用CI数据",
      targetAgentId: "agent-doc",
      constraints: [],
      priority: 80,
      parentMessageIds: ["msg-002"],
      dependsOn: ["task-001"],
      deadlineMs: 300000,
      crossDomainRequests: ["feishu_bitable"],
      isFollowup: true,
    }
    expect(task.dependsOn).toEqual(["task-001"])
    expect(task.isFollowup).toBe(true)
  })
})

describe("TaskConstraint", () => {
  it("supports all constraint types per 02 §5.2a", () => {
    const constraints: TaskConstraint[] = [
      { type: "time_limit", value: 300000, description: "5 min deadline" },
      { type: "scope_limit", value: "feishu_doc only", description: "No bitable access" },
      { type: "resource_limit", value: 2, description: "Max 2 concurrent tool calls" },
      { type: "side_effect_policy", value: "staged_commit", description: "Use staged side effects" },
    ]
    expect(constraints).toHaveLength(4)
    expect(constraints[0].type).toBe("time_limit")
  })
})

describe("SubTaskSpec", () => {
  it("has goal, taskType, optional targetAgentId per 02 §5.7a", () => {
    const spec: SubTaskSpec = {
      goal: "查询项目进度",
      taskType: "query",
      targetAgentId: "agent-data",
      priorityHint: 70,
    }
    expect(spec.goal).toBeTruthy()
    expect(spec.taskType).toBe("query")
  })
})

describe("IntentType and TaskType", () => {
  it("IntentType covers all semantic categories per 02 §5.7", () => {
    const types: IntentType[] = ["simple", "compound", "withdrawal", "supplement", "correction", "ambiguous"]
    expect(types).toHaveLength(6)
  })

  it("TaskType covers all operational categories per 02 §5.7", () => {
    const types: TaskType[] = ["query", "create", "update", "delete", "chat", "compound"]
    expect(types).toHaveLength(6)
  })
})

describe("ExecutionBoard", () => {
  it("has agents, pendingQueue, stagingResults, finalizedResults per 02 §5.3", () => {
    const board: ExecutionBoard = {
      agents: new Map(),
      pendingQueue: [],
      activeTasks: new Map(),
      stagingResults: new Map(),
      finalizedResults: new Map(),
      traceLog: [],
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      averageLatencyMs: 0,
    }
    expect(board.agents.size).toBe(0)
    expect(board.stagingResults).toBeInstanceOf(Map)
  })
})

describe("AgentExecState", () => {
  it("has required fields per 02 §5.3", () => {
    const state: AgentExecState = {
      agentId: "agent-doc",
      status: "idle",
      successRate: 0.95,
    }
    expect(state.status).toBe("idle")
  })

  it("supports optional currentTask and lastCompletedTask", () => {
    const task: SupervisorTask = {
      id: "task-001",
      type: "create",
      description: "写文档",
      targetAgentId: "agent-doc",
      constraints: [],
      priority: 80,
      parentMessageIds: ["msg-001"],
    }
    const state: AgentExecState = {
      agentId: "agent-doc",
      status: "running",
      currentTask: task,
      lastCompletedTask: "task-000",
      successRate: 0.95,
    }
    expect(state.currentTask!.id).toBe("task-001")
  })
})

describe("SupervisorAgentResult", () => {
  it("has all required fields per 02 §5.4", () => {
    const result: SupervisorAgentResult = {
      taskId: "task-001",
      agentId: "agent-doc",
      status: "completed",
      output: "文档已创建",
      toolCallTrace: [],
      confidence: 0.9,
      timestamp: Date.now(),
      traceId: "trace-001",
    }
    expect(result.status).toBe("completed")
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})

describe("SupervisorArtifact", () => {
  it("supports all artifact types per 02 §5.4a", () => {
    const artifacts: SupervisorArtifact[] = [
      { type: "file", content: "/tmp/output.txt" },
      { type: "url", content: "https://example.com", label: "Link" },
      { type: "image", content: "base64data", metadata: { mimeType: "png" } },
      { type: "table", content: "[[1,2],[3,4]]" },
      { type: "document", content: "doc_token_abc" },
    ]
    expect(artifacts).toHaveLength(5)
  })
})

describe("SupervisorToolCallTraceEntry", () => {
  it("has all required fields per 02 §5.4a", () => {
    const entry: SupervisorToolCallTraceEntry = {
      stepId: "step-001",
      parentStepId: "step-000",
      toolName: "feishu_doc",
      toolCallId: "call-001",
      input: { action: "write", doc_token: "abc" },
      output: { success: true },
      startTime: Date.now(),
      endTime: Date.now() + 1000,
      durationMs: 1000,
      status: "completed",
      parallelGroup: "pg-001",
    }
    expect(entry.status).toBe("completed")
    expect(entry.parentStepId).toBe("step-000")
  })
})

describe("SupervisorFinalReply", () => {
  it("has text, artifacts, traceId, sourceAgentIds per 02 §5.4a", () => {
    const reply: SupervisorFinalReply = {
      text: "项目进度如下...",
      artifacts: [],
      traceId: "trace-001",
      sourceAgentIds: ["agent-data", "agent-doc"],
    }
    expect(reply.sourceAgentIds).toHaveLength(2)
  })
})

describe("WithdrawalEvent", () => {
  it("has all fields per 02 §5.5", () => {
    const event: WithdrawalEvent = {
      type: "message_recall",
      messageId: "msg-001",
      chatId: "chat-001",
      accountId: "acc-001",
      timestamp: Date.now(),
      relatedTaskIds: ["task-001"],
    }
    expect(event.type).toBe("message_recall")
  })
})

describe("IntentClassification", () => {
  it("supports all intent types per 03 §3.3", () => {
    const classification: IntentClassification = {
      type: "compound",
      subTasks: [
        { goal: "写文档", taskType: "create" },
        { goal: "查CI数据", taskType: "query" },
      ],
      confidence: 0.85,
    }
    expect(classification.type).toBe("compound")
    expect(classification.subTasks).toHaveLength(2)
  })

  it("supports supplementTo and originalTaskToWithdraw", () => {
    const supplement: IntentClassification = {
      type: "supplement",
      supplementTo: "task-001",
      confidence: 0.9,
    }
    const withdrawal: IntentClassification = {
      type: "withdrawal",
      originalTaskToWithdraw: "task-001",
      confidence: 1.0,
    }
    expect(supplement.supplementTo).toBe("task-001")
    expect(withdrawal.originalTaskToWithdraw).toBe("task-001")
  })
})

describe("RuleClassificationResult", () => {
  it("has matched, confidence, optional intentType and subTasks per 03 §3.1", () => {
    const matched: RuleClassificationResult = {
      matched: true,
      intentType: "simple",
      subTasks: [{ goal: "查数据", taskType: "query", targetAgentId: "agent-data" }],
      confidence: 0.9,
      matchMethod: "keyword",
    }
    expect(matched.matched).toBe(true)
    expect(matched.matchMethod).toBe("keyword")
  })

  it("supports unmatched state", () => {
    const unmatched: RuleClassificationResult = {
      matched: false,
      confidence: 0,
    }
    expect(unmatched.intentType).toBeUndefined()
  })
})

describe("PendingDecision and RaceConditionAction", () => {
  it("PendingDecision tracks in-progress LLM call per 03 §3.2b", () => {
    const pending: PendingDecision = {
      decisionId: "dec-001",
      llmCallId: "llm-001",
      userContext: {
        chatId: "chat-001",
        accountId: "acc-001",
        messages: [],
        aggregatedText: "帮我查数据",
        intentHint: { type: "simple", keywords: ["查"], confidence: 0.5 },
        mediaAttachments: [],
        mentions: [],
        senderId: "user-001",
        windowDurationMs: 3000,
      },
      ruleResult: { matched: true, intentType: "simple", confidence: 0.8 },
      pendingSupplements: [],
      startTime: Date.now(),
    }
    expect(pending.decisionId).toBe("dec-001")
    expect(pending.pendingSupplements).toHaveLength(0)
  })

  it("RaceConditionAction supports all three actions per 03 §3.2b", () => {
    const cancel: RaceConditionAction = { type: "cancel_and_withdraw", withdrawalTarget: {} as PendingDecision }
    const append: RaceConditionAction = { type: "append_after_decision" }
    const newWindow: RaceConditionAction = { type: "new_window_for_new_message" }
    expect(cancel.type).toBe("cancel_and_withdraw")
    expect(append.type).toBe("append_after_decision")
    expect(newWindow.type).toBe("new_window_for_new_message")
  })
})

describe("InterruptCostAssessment", () => {
  it("has three dimensions per 03 §6.4", () => {
    const assessment: InterruptCostAssessment = {
      workLoss: {
        elapsedMs: 3060000,
        progressPercent: 85,
        reversible: false,
        rollbackNeeded: true,
        rollbackComplexity: "complex",
      },
      resumeViability: {
        canResume: false,
        resumeCost: "impossible",
        checkpointAvailable: false,
        sideEffectsCommitted: true,
      },
      userImpact: {
        waitTimeIfContinueMs: 300000,
        waitTimeIfInterruptMs: 600000,
        userUrgencyLevel: "low",
        userExpectationBreach: false,
      },
    }
    expect(assessment.workLoss.progressPercent).toBe(85)
    expect(assessment.resumeViability.sideEffectsCommitted).toBe(true)
  })
})

describe("StagedSideEffect", () => {
  it("has all fields per 03 §6.4 staged mechanism", () => {
    const effect: StagedSideEffect = {
      operationId: "op-001",
      agentId: "agent-doc",
      taskId: "task-001",
      operationType: "feishu_doc_write",
      targetResource: "doc_token_abc",
      operationData: { content: "新内容" },
      status: "staged",
      createdAt: Date.now(),
      idempotencyKey: "idem-001",
    }
    expect(effect.status).toBe("staged")
    expect(effect.idempotencyKey).toBeTruthy()
  })
})

describe("CrossDomainAuthRequest and Response", () => {
  it("request has urgency levels per 04 §4.3", () => {
    const req: CrossDomainAuthRequest = {
      taskId: "task-001",
      agentId: "agent-doc",
      requestedToolId: "feishu_bitable",
      reason: "Need bitable data for document",
      urgency: "medium",
    }
    expect(req.urgency).toBe("medium")
  })

  it("response supports all four outcomes per 04 §4.3", () => {
    const responses: CrossDomainAuthResponse[] = [
      { type: "approved_direct", toolResult: { data: "result" } },
      { type: "approved_delegate", delegateTo: "agent-data" },
      { type: "denied", reason: "Outside scope" },
      { type: "denied_with_alternative", alternative: "Use cached data" },
    ]
    expect(responses).toHaveLength(4)
  })
})

describe("UserPromise", () => {
  it("supports all promise types per 03 §6.4", () => {
    const promises: UserPromise[] = [
      { taskId: "task-001", promiseType: "will_notify_on_complete", promisedAt: Date.now(), fulfilled: false },
      { taskId: "task-001", promiseType: "will_handle_followup", promisedAt: Date.now(), fulfilled: false },
      { taskId: "task-001", promiseType: "estimated_time", promisedAt: Date.now(), estimatedCompleteAt: Date.now() + 300000, fulfilled: false },
    ]
    expect(promises).toHaveLength(3)
  })
})

describe("SupervisorRawMessage", () => {
  it("has isRecalled flag per 07 §3.2", () => {
    const msg: SupervisorRawMessage = {
      messageId: "msg-001",
      chatId: "chat-001",
      accountId: "acc-001",
      senderId: "user-001",
      text: "帮我查数据",
      mediaAttachments: [],
      mentions: [],
      timestamp: Date.now(),
      isRecalled: false,
    }
    expect(msg.isRecalled).toBe(false)
  })
})

describe("SupervisorAccumulatedUserContext", () => {
  it("has all fields per 07 §2.6", () => {
    const ctx: SupervisorAccumulatedUserContext = {
      chatId: "chat-001",
      accountId: "acc-001",
      messages: [],
      aggregatedText: "帮我查项目进度",
      intentHint: { type: "simple", keywords: ["查", "进度"], confidence: 0.8 },
      mediaAttachments: [],
      mentions: [],
      senderId: "user-001",
      windowDurationMs: 3000,
    }
    expect(ctx.aggregatedText).toBeTruthy()
  })
})

describe("ObservationWindow", () => {
  it("has state per 07 §2.3", () => {
    const window: ObservationWindow = {
      chatId: "chat-001",
      accountId: "acc-001",
      messages: [],
      windowStartTime: Date.now(),
      windowDeadline: Date.now() + 3000,
      lastMessageTime: Date.now(),
      state: "collecting",
    }
    expect(window.state).toBe("collecting")
  })
})

describe("CredibilityAnnotatedResult", () => {
  it("wraps AgentResult with CredibilityAnnotation per 06 §2.2", () => {
    const result: SupervisorAgentResult = {
      taskId: "task-001",
      agentId: "agent-doc",
      status: "completed",
      output: "Done",
      toolCallTrace: [],
      confidence: 0.9,
      timestamp: Date.now(),
      traceId: "trace-001",
    }
    const annotated: CredibilityAnnotatedResult = {
      result,
      credibility: {
        level: "agent_result",
        sourceAgentId: "agent-doc",
        domainExpertise: 0.9,
        freshness: 1.0,
      },
    }
    expect(annotated.result.confidence).toBe(0.9)
    expect(annotated.credibility.level).toBe("agent_result")
  })
})

describe("SupervisorMemoryEvent", () => {
  it("supports all event types per 06 §4.2", () => {
    const eventTypes: MemoryEventType[] = [
      "task_completed",
      "task_failed",
      "task_aborted",
      "insight_generated",
      "user_preference_observed",
    ]
    expect(eventTypes).toHaveLength(5)
  })
})

// ─── Previously Missing Type Tests ───

describe("SchemaUpgradeHook", () => {
  it("has toolId, summarySchema, fullSchema, onToolUseDetected per 04 §3.3", () => {
    const hook: SchemaUpgradeHook = {
      toolId: "feishu_doc",
      summarySchema: { type: "object", properties: { action: { type: "string" } } },
      fullSchema: { type: "object", properties: { action: { type: "string" }, doc_token: { type: "string" } } },
      onToolUseDetected: async () => ({ type: "upgraded", validatedParams: { action: "read" } }),
    }
    expect(hook.toolId).toBe("feishu_doc")
  })
})

describe("SchemaUpgradeResult", () => {
  it("supports upgraded and upgrade_failed per 04 §3.3", () => {
    const success: SchemaUpgradeResult = { type: "upgraded", validatedParams: { action: "read" } }
    const failure: SchemaUpgradeResult = { type: "upgrade_failed", validationError: "missing doc_token" }
    expect(success.type).toBe("upgraded")
    expect(failure.type).toBe("upgrade_failed")
  })
})

describe("SupervisorResultEventBus", () => {
  it("has mode, handleAgentEvent, handleLegacyEvent per 04 §4.2b", () => {
    const bus: SupervisorResultEventBus = {
      mode: "supervisor",
      handleAgentEvent: () => {},
      handleLegacyEvent: () => {},
    }
    expect(bus.mode).toBe("supervisor")
  })

  it("supports legacy mode", () => {
    const bus: SupervisorResultEventBus = {
      mode: "legacy",
      handleAgentEvent: () => {},
      handleLegacyEvent: () => {},
    }
    expect(bus.mode).toBe("legacy")
  })
})

describe("FollowupClassification", () => {
  it("supports inject, new_intent, and needs_llm_classification per 07 §4.2", () => {
    const inject: FollowupClassification = { type: "inject", targetTaskId: "task-001" }
    const newIntent: FollowupClassification = { type: "new_intent" }
    const needsLlm: FollowupClassification = { type: "needs_llm_classification" }
    expect(inject.type).toBe("inject")
    expect(newIntent.type).toBe("new_intent")
    expect(needsLlm.type).toBe("needs_llm_classification")
  })
})

// ─── Materialized View Tests (06 §4.3) ───

describe("TaskHistorySummary", () => {
  it("has all fields per 06 §4.3", () => {
    const summary: TaskHistorySummary = {
      taskId: "task-001",
      taskType: "query",
      agentId: "agent-data",
      status: "completed",
      summary: "查询了项目进度",
      timestamp: Date.now(),
    }
    expect(summary.status).toBe("completed")
  })
})

describe("ActiveContextState", () => {
  it("has all fields per 06 §4.3", () => {
    const ctx: ActiveContextState = {
      chatId: "chat-001",
      pendingTaskIds: ["task-002"],
      runningAgentIds: ["agent-data"],
      lastUserMessageTimestamp: Date.now(),
    }
    expect(ctx.currentIntent).toBeUndefined()
    expect(ctx.runningAgentIds).toHaveLength(1)
  })
})

describe("SupervisorPreferenceEntry", () => {
  it("has all fields per 06 §4.3", () => {
    const entry: SupervisorPreferenceEntry = {
      domain: "language",
      value: "中文",
      sourceAgentId: "agent-chat",
      confidence: 0.8,
      timestamp: Date.now(),
      decayWeight: 1.0,
    }
    expect(entry.domain).toBe("language")
  })
})

describe("SupervisorUserProfile", () => {
  it("has all fields per 06 §4.3", () => {
    const profile: SupervisorUserProfile = {
      userId: "user-001",
      preferences: [],
      expertiseAreas: ["ci"],
      commonTaskTypes: ["query"],
      preferredAgents: ["agent-data"],
      lastUpdated: Date.now(),
    }
    expect(profile.preferences).toHaveLength(0)
  })
})

describe("SupervisorMaterializedView", () => {
  it("has userProfile, taskHistory, activeContext per 06 §4.3", () => {
    const view: SupervisorMaterializedView = {
      userProfile: { userId: "user-001", preferences: [], expertiseAreas: [], commonTaskTypes: [], preferredAgents: [], lastUpdated: Date.now() },
      taskHistory: [],
      activeContext: { chatId: "chat-001", pendingTaskIds: [], runningAgentIds: [], lastUserMessageTimestamp: Date.now() },
    }
    expect(view.taskHistory).toHaveLength(0)
  })
})

describe("SupervisorAnnotatedMemoryEntry", () => {
  it("has all fields per 06 §4.4", () => {
    const entry: SupervisorAnnotatedMemoryEntry = {
      content: "project A uses agent-ci",
      sourceAgentId: "agent-chat",
      sourceDomain: "general",
      sourceCredibility: 0.3,
      observationTime: Date.now(),
      observationCount: 1,
      decayWeight: 1.0,
    }
    expect(entry.sourceCredibility).toBeLessThanOrEqual(1)
    expect(entry.conflictStatus).toBeUndefined()
  })

  it("supports conflictStatus field per 06 §4.6 conflict resolution", () => {
    const suppressed: SupervisorAnnotatedMemoryEntry = {
      content: "project B uses agent-doc",
      sourceAgentId: "agent-chat",
      sourceDomain: "general",
      sourceCredibility: 0.2,
      observationTime: Date.now(),
      observationCount: 1,
      decayWeight: 0.5,
      conflictStatus: "suppressed",
      conflictingEntries: ["entry-002"],
    }
    const conflicting: SupervisorAnnotatedMemoryEntry = {
      content: "project A status is green",
      sourceAgentId: "agent-data",
      sourceDomain: "feishu_bitable",
      sourceCredibility: 0.6,
      observationTime: Date.now(),
      observationCount: 2,
      decayWeight: 0.8,
      conflictStatus: "conflicting",
      conflictingEntries: ["entry-003"],
    }
    expect(suppressed.conflictStatus).toBe("suppressed")
    expect(conflicting.conflictStatus).toBe("conflicting")
  })
})

describe("SupervisorTranscriptEntry", () => {
  it("has all fields per 06 §5.3", () => {
    const entry: SupervisorTranscriptEntry = {
      type: "routing",
      timestamp: Date.now(),
      content: "Routed to agent-data",
      relatedTaskIds: ["task-001"],
      relatedTraceIds: ["trace-001"],
    }
    expect(entry.type).toBe("routing")
  })
})

// ─── Default Manifest Tests ───

describe("Default Manifests", () => {
  it("has 4 default agents per 04 §2", () => {
    expect(DEFAULT_AGENT_MANIFESTS).toHaveLength(4)
  })

  it("agent-doc has correct identity and priority", () => {
    expect(AGENT_DOC_MANIFEST.id).toBe("agent-doc")
    expect(AGENT_DOC_MANIFEST.priority).toBe(80)
    expect(AGENT_DOC_MANIFEST.taskTypes).toEqual(["create", "update", "query"])
    expect(AGENT_DOC_MANIFEST.capabilities).toHaveLength(3)
    expect(AGENT_DOC_MANIFEST.boundaries).toHaveLength(2)
    expect(AGENT_DOC_MANIFEST.rejectPatterns).toHaveLength(1)
  })

  it("agent-data has correct identity and priority", () => {
    expect(AGENT_DATA_MANIFEST.id).toBe("agent-data")
    expect(AGENT_DATA_MANIFEST.priority).toBe(70)
    expect(AGENT_DATA_MANIFEST.taskTypes).toEqual(["query"])
  })

  it("agent-ci has correct identity and priority", () => {
    expect(AGENT_CI_MANIFEST.id).toBe("agent-ci")
    expect(AGENT_CI_MANIFEST.priority).toBe(60)
  })

  it("agent-chat is fallback with lowest priority", () => {
    expect(AGENT_CHAT_MANIFEST.id).toBe("agent-chat")
    expect(AGENT_CHAT_MANIFEST.priority).toBe(10)
    expect(AGENT_CHAT_MANIFEST.boundaries).toHaveLength(0)
    expect(AGENT_CHAT_MANIFEST.rejectPatterns).toHaveLength(0)
    expect(AGENT_CHAT_MANIFEST.taskTypes).toEqual(["chat"])
  })

  it("getDefaultManifestById finds correct manifest", () => {
    expect(getDefaultManifestById("agent-doc")).toBe(AGENT_DOC_MANIFEST)
    expect(getDefaultManifestById("agent-nonexistent")).toBeUndefined()
  })

  it("getDefaultManifestsByTaskType returns matching manifests sorted by priority descending", () => {
    const queryAgents = getDefaultManifestsByTaskType("query")
    expect(queryAgents.length).toBeGreaterThanOrEqual(3)
    // verify descending priority order: agent-doc(80) > agent-data(70) > agent-ci(60)
    for (let i = 1; i < queryAgents.length; i++) {
      expect(queryAgents[i - 1].priority).toBeGreaterThanOrEqual(queryAgents[i].priority)
    }
    expect(queryAgents[0].id).toBe("agent-doc")
  })

  it("each manifest has non-empty summaryManifest (< 100 chars)", () => {
    for (const m of DEFAULT_AGENT_MANIFESTS) {
      expect(m.summaryManifest.length).toBeLessThan(100)
      expect(m.summaryManifest.length).toBeGreaterThan(0)
    }
  })

  it("each manifest has valid description (< 200 chars)", () => {
    for (const m of DEFAULT_AGENT_MANIFESTS) {
      expect(m.description.length).toBeLessThanOrEqual(200)
    }
  })

  it("manifest IDs are unique", () => {
    const ids = DEFAULT_AGENT_MANIFESTS.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("priority ordering: doc > data > ci > chat", () => {
    expect(AGENT_DOC_MANIFEST.priority).toBeGreaterThan(AGENT_DATA_MANIFEST.priority)
    expect(AGENT_DATA_MANIFEST.priority).toBeGreaterThan(AGENT_CI_MANIFEST.priority)
    expect(AGENT_CI_MANIFEST.priority).toBeGreaterThan(AGENT_CHAT_MANIFEST.priority)
  })
})