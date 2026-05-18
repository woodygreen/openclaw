// Supervisor Agent type definitions
// See docs/design/02-architecture.md §5, 04-sub-agents.md §1, 03-supervisor.md, 07-message-lifecycle.md

// ─── Intent & Task Classification ───

/** Semantic intent category — what the user wants at a semantic level */
export type IntentType =
  | "simple"
  | "compound"
  | "withdrawal"
  | "supplement"
  | "correction"
  | "ambiguous"

/** Operational task type — what operation needs to be performed */
export type TaskType =
  | "query"
  | "create"
  | "update"
  | "delete"
  | "chat"
  | "compound"

// ─── Agent Manifest ───

export type CapabilitySpec = {
  domain: string
  actions: string[]
  scopeDescription: string
}

export type BoundarySpec = {
  domain: string
  reason: string
  overrideAllowed: boolean
}

export type RejectPattern = {
  pattern: string
  reason: string
  redirectTo?: string
}

export type AgentManifest = {
  id: string
  label: string
  description: string

  capabilities: CapabilitySpec[]
  boundaries: BoundarySpec[]
  rejectPatterns: RejectPattern[]

  toolIds: string[]
  toolGroups?: string[]

  priority: number
  taskTypes: TaskType[]
  keywords: string[]

  maxContextTokens?: number
  systemPromptTemplate?: string

  summaryManifest: string
}

// ─── Task Definitions ───

export type TaskConstraint = {
  type: "time_limit" | "scope_limit" | "resource_limit" | "side_effect_policy"
  value: string | number
  description: string
}

export type SubTaskSpec = {
  goal: string
  targetAgentId?: string
  taskType: TaskType
  priorityHint?: number
  constraints?: TaskConstraint[]
}

export type SupervisorTask = {
  id: string
  type: TaskType
  description: string
  targetAgentId: string
  constraints: TaskConstraint[]
  priority: number
  parentMessageIds: string[]
  dependsOn?: string[]
  deadlineMs?: number
  crossDomainRequests?: string[]
  isFollowup?: boolean
}

// ─── Execution Board ───

export type AgentExecStatus = "idle" | "running" | "waiting" | "failed"

export type AgentExecState = {
  agentId: string
  status: AgentExecStatus
  currentTask?: SupervisorTask
  lastCompletedTask?: string
  successRate: number
  lastResult?: SupervisorAgentResult
}

export type ExecutionTrace = {
  traceId: string
  taskId: string
  agentId: string
  eventType: "task_start" | "task_complete" | "task_fail" | "task_abort" | "interrupt" | "inject"
  timestamp: number
  data?: Record<string, unknown>
}

// in-memory execution state — Map fields are not JSON-serializable;
// use toExecutionBoardJSON / fromExecutionBoardJSON adapters if persistence is needed
export type ExecutionBoard = {
  agents: Map<string, AgentExecState>
  pendingQueue: SupervisorTask[]
  activeTasks: Map<string, SupervisorTask>

  stagingResults: Map<string, SupervisorAgentResult>
  finalizedResults: Map<string, SupervisorFinalReply>

  traceLog: ExecutionTrace[]

  totalTasksCompleted: number
  totalTasksFailed: number
  averageLatencyMs: number
}

// ─── Result & Artifacts ───

export type ArtifactType = "file" | "url" | "image" | "table" | "document"

export type SupervisorArtifact = {
  type: ArtifactType
  content: string
  label?: string
  metadata?: Record<string, string>
}

export type TraceEntryStatus = "completed" | "failed" | "skipped"

export type SupervisorToolCallTraceEntry = {
  stepId: string
  parentStepId?: string
  toolName: string
  toolCallId: string
  input: unknown
  output: unknown
  startTime: number
  endTime: number
  durationMs: number
  status: TraceEntryStatus
  parallelGroup?: string
}

export type AgentResultStatus = "completed" | "failed" | "aborted"

export type SupervisorAgentResult = {
  taskId: string
  agentId: string
  status: AgentResultStatus
  output: string
  artifacts?: SupervisorArtifact[]
  toolCallTrace: SupervisorToolCallTraceEntry[]
  confidence: number
  crossDomainRequests?: string[]
  timestamp: number
  traceId: string
}

export type SupervisorFinalReply = {
  text: string
  artifacts: SupervisorArtifact[]
  traceId: string
  sourceAgentIds: string[]
}

// ─── Withdrawal ───

export type WithdrawalEvent = {
  // WithdrawalEvent.type may expand to support other channel recall types
  // (e.g. WhatsApp/Telegram delete messages) beyond Feishu message_recall
  type: "message_recall"
  messageId: string
  chatId: string
  accountId: string
  timestamp: number
  relatedTaskIds?: string[]
}

// ─── Intent Classification ───

export type IntentHint = {
  type: IntentType
  keywords: string[]
  confidence: number
}

export type IntentClassification = {
  type: IntentType
  subTasks?: SubTaskSpec[]
  supplementTo?: string
  originalTaskToWithdraw?: string
  confidence: number
}

// ─── Rule Classification ───

export type RuleMatchMethod = "slash_command" | "keyword" | "template"

export type RuleClassificationResult = {
  matched: boolean
  intentType?: IntentType
  subTasks?: SubTaskSpec[]
  confidence: number
  matchMethod?: RuleMatchMethod
}

// ─── Decision Race Condition ───

export type PendingDecision = {
  decisionId: string
  llmCallId: string
  userContext: SupervisorAccumulatedUserContext
  ruleResult: RuleClassificationResult
  pendingSupplements: SupervisorRawMessage[]
  startTime: number
}

export type RaceConditionAction =
  | { type: "cancel_and_withdraw"; withdrawalTarget: PendingDecision }
  | { type: "append_after_decision" }
  | { type: "new_window_for_new_message" }

// ─── Interrupt Cost Analysis ───

export type RollbackComplexity = "none" | "simple" | "moderate" | "complex" | "impossible"
export type ResumeCost = "none" | "low" | "medium" | "high" | "impossible"
export type UserUrgencyLevel = "low" | "medium" | "high"

export type InterruptWorkLoss = {
  elapsedMs: number
  progressPercent: number
  reversible: boolean
  rollbackNeeded: boolean
  rollbackComplexity: RollbackComplexity
}

export type InterruptResumeViability = {
  canResume: boolean
  resumeCost: ResumeCost
  checkpointAvailable: boolean
  sideEffectsCommitted: boolean
}

export type InterruptUserImpact = {
  waitTimeIfContinueMs: number
  waitTimeIfInterruptMs: number
  userUrgencyLevel: UserUrgencyLevel
  userExpectationBreach: boolean
}

export type InterruptCostAssessment = {
  workLoss: InterruptWorkLoss
  resumeViability: InterruptResumeViability
  userImpact: InterruptUserImpact
}

// ─── Staged Side Effects ───

export type StagedEffectStatus = "staged" | "committed" | "discarded"

export type StagedSideEffect = {
  operationId: string
  agentId: string
  taskId: string
  // operationType will become a union literal in Phase 6 when staged effects are implemented
  // placeholder values: "feishu_doc_write" | "feishu_bitable_create" | "message_send" | ...
  operationType: string
  targetResource: string
  operationData: unknown
  status: StagedEffectStatus
  createdAt: number
  idempotencyKey: string
}

// ─── Cross-Domain Authorization ───

export type CrossDomainUrgency = "low" | "medium" | "high"

export type CrossDomainAuthRequest = {
  taskId: string
  agentId: string
  requestedToolId: string
  reason: string
  urgency: CrossDomainUrgency
}

export type CrossDomainAuthResponse =
  | { type: "approved_direct"; toolResult?: unknown }
  | { type: "approved_delegate"; delegateTo: string }
  | { type: "denied"; reason: string }
  | { type: "denied_with_alternative"; alternative: string }

// ─── User Promise ───

export type UserPromiseType = "will_notify_on_complete" | "will_handle_followup" | "estimated_time"

export type UserPromise = {
  taskId: string
  promiseType: UserPromiseType
  promisedAt: number
  estimatedCompleteAt?: number
  fulfilled: boolean
}

// ─── Context Accumulator (from 07-message-lifecycle.md) ───

export type ObservationWindowState = "collecting" | "ready" | "dispatched"

export type SupervisorMediaAttachment = {
  type: "image" | "file" | "audio" | "video" | "post"
  messageKey: string
  fileName?: string
  fileSize?: number
}

export type SupervisorMention = {
  userId: string
  name: string
  isBotMention: boolean
}

export type SupervisorRawMessage = {
  messageId: string
  chatId: string
  accountId: string
  senderId: string
  text: string
  mediaAttachments: SupervisorMediaAttachment[]
  mentions: SupervisorMention[]
  timestamp: number
  isRecalled: boolean
}

export type SupervisorAccumulatedUserContext = {
  chatId: string
  accountId: string
  messages: SupervisorRawMessage[]
  aggregatedText: string
  intentHint: IntentHint
  mediaAttachments: SupervisorMediaAttachment[]
  mentions: SupervisorMention[]
  threadKey?: string
  senderId: string
  windowDurationMs: number
}

export type ObservationWindow = {
  chatId: string
  accountId: string
  messages: SupervisorRawMessage[]
  windowStartTime: number
  windowDeadline: number
  lastMessageTime: number
  intentHint?: IntentHint
  state: ObservationWindowState
}

// ─── Task Dependency ───

export type TaskDependencyType = "data" | "parameter" | "ordering" | "none"

export type TaskDependency = {
  taskId: string
  dependsOn: string[]
  dependencyType: TaskDependencyType
}

// ─── Followup Classification ───

export type FollowupClassification =
  | { type: "inject"; targetTaskId: string }
  | { type: "new_intent" }
  | { type: "needs_llm_classification" }

// ─── Schema Upgrade Hook ───

export type SchemaUpgradeResult =
  | { type: "upgraded"; validatedParams: unknown }
  | { type: "upgrade_failed"; validationError: string }

export type SchemaUpgradeHook = {
  toolId: string
  summarySchema: Record<string, unknown>
  fullSchema: Record<string, unknown>
  // TODO: replace toolCall param with ToolUseBlock from Claude API once PI Runner integration is ready (Phase 3)
  onToolUseDetected: (toolCall: { toolName: string; input: unknown }) => Promise<SchemaUpgradeResult>
}

// ─── Supervisor Result Event Bus ───

export type SupervisorEventBusMode = "supervisor" | "legacy"

export type SupervisorResultEventBus = {
  mode: SupervisorEventBusMode
  // TODO: replace `unknown` with PiSessionEvent once PI Runner types are imported (Phase 3)
  handleAgentEvent: (event: unknown) => void
  // TODO: replace `unknown` with PiSessionEvent once PI Runner types are imported (Phase 3)
  handleLegacyEvent: (event: unknown) => void
}

// ─── Credibility Annotation (from 06-context-and-memory.md) ───

export type CredibilityLevel = "system_rule" | "agent_result" | "user_input" | "model_guess"

export type CredibilityAnnotation = {
  level: CredibilityLevel
  sourceAgentId: string
  domainExpertise: number
  freshness: number
}

export type CredibilityAnnotatedResult = {
  result: SupervisorAgentResult
  credibility: CredibilityAnnotation
}

// ─── Memory Event Stream (from 06-context-and-memory.md) ───

export type MemoryEventType =
  | "task_completed"
  | "task_failed"
  | "task_aborted"
  | "insight_generated"
  | "user_preference_observed"

export type SupervisorMemoryEvent = {
  eventId: string
  eventType: MemoryEventType
  sourceAgentId: string
  taskId: string
  timestamp: number
  data: {
    output?: string
    error?: string
    insights?: SupervisorInsight[]
    preferenceUpdates?: SupervisorPreferenceUpdate[]
  }
  metadata: {
    confidence: number
    domain: string
    traceId: string
  }
}

export type SupervisorInsight = {
  content: string
  domain: string
  confidence: number
}

export type SupervisorPreferenceUpdate = {
  domain: string
  value: string
  confidence: number
}

// ─── Interrupt Reason ───

export type InterruptReason =
  | "user_message_recalled"
  | "user_intent_reversal"
  | "execution_timeout"
  | "supervisor_decision"

// ─── Materialized Views (from 06-context-and-memory.md §4.3) ───

// TaskOutcomeStatus and AgentResultStatus share the same value domain ("completed" | "failed" | "aborted")
// but serve different contexts: TaskOutcomeStatus is for task history summaries in MaterializedView,
// AgentResultStatus is for runtime agent results. They are intentionally kept separate for independent evolution.
export type TaskOutcomeStatus = "completed" | "failed" | "aborted"

export type TaskHistorySummary = {
  taskId: string
  taskType: TaskType
  agentId: string
  status: TaskOutcomeStatus
  summary: string
  timestamp: number
}

export type ActiveContextState = {
  chatId: string
  currentIntent?: IntentClassification
  pendingTaskIds: string[]
  runningAgentIds: string[]
  lastUserMessageTimestamp: number
}

export type SupervisorPreferenceEntry = {
  domain: string
  value: string
  sourceAgentId: string
  confidence: number
  timestamp: number
  decayWeight: number
}

export type SupervisorUserProfile = {
  userId: string
  preferences: SupervisorPreferenceEntry[]
  expertiseAreas: string[]
  commonTaskTypes: string[]
  preferredAgents: string[]
  lastUpdated: number
}

export type SupervisorMaterializedView = {
  userProfile: SupervisorUserProfile
  taskHistory: TaskHistorySummary[]
  activeContext: ActiveContextState
}

// ─── Annotated Memory Entry (from 06-context-and-memory.md §4.4) ───

export type MemoryConflictStatus = "suppressed" | "conflicting" | "candidate"

export type SupervisorAnnotatedMemoryEntry = {
  content: string
  sourceAgentId: string
  sourceDomain: string
  sourceCredibility: number
  observationTime: number
  observationCount: number
  decayWeight: number
  conflictStatus?: MemoryConflictStatus
  conflictingEntries?: string[]
}

// ─── Supervisor Transcript Entry (from 06-context-and-memory.md §5.3) ───

export type SupervisorTranscriptType = "intent" | "routing" | "interrupt" | "inject" | "result_collection"

export type SupervisorTranscriptEntry = {
  type: SupervisorTranscriptType
  timestamp: number
  content: string
  relatedTaskIds: string[]
  relatedTraceIds: string[]
}