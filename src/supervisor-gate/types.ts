// Supervisor Gate type definitions
// Route B: additive layer above the existing Feishu message pipeline
// See docs/design/02-architecture.md §5, 04-sub-agents.md §2

// ─── Gate Decision ───

/** What the Supervisor Gate decides for an inbound event */
export type SupervisorGateDecision =
  | "direct_execute"       // slash commands — bypass everything, immediate dispatch
  | "interrupt_request"    // user says "wait/no/stop" — pause, ask for supplement, then resume
  | "withdraw"             // message recall/withdrawal — intercept, don't enter queue
  | "simple_pass"          // single-domain or unknown intent — pass through existing pipeline
  | "compound_decompose"   // multi-domain intent — decompose into sub-tasks

// ─── Gate Context ───

/** Context available to the Gate when evaluating an event */
export type GateContext = {
  eventType: string          // e.g. "im.message.receive_v1"
  accountId: string
  rawEventData: unknown      // the raw data from Lark SDK EventDispatcher
  /** Parsed message text — only set for im.message.receive_v1 events */
  messageText?: string
  /** Whether this is a slash command (/xxx) */
  isSlashCommand?: boolean
  /** Whether this is a recall/withdrawal event */
  isRecallEvent?: boolean
  /** Chat type: p2p, group, topic_group */
  chatType?: string
  /** Sender open_id */
  senderId?: string
  /** Chat id */
  chatId?: string
}

// ─── Classification Result ───

export type ClassifiedIntent = {
  decision: SupervisorGateDecision
  /** Human-readable reason for the decision (for logging) */
  reason: string
  /** For compound_decompose: the decomposed sub-task specs */
  subTasks?: SubTaskSpec[]
}

// ─── Sub-task Specification ───

/** A decomposed sub-task for compound intents */
export type SubTaskSpec = {
  /** Which agent manifest this sub-task should be routed to */
  targetAgentId: string
  /** The portion of the original message relevant to this sub-task */
  taskDescription: string
  /** Domain this sub-task operates in (e.g. "feishu_doc", "ci", "feishu_bitable") */
  domain: string
  /** Task type classification */
  taskType: "query" | "create" | "update" | "delete" | "chat"
}

// ─── Withdrawal Event ───

/** Parsed withdrawal/recall event data */
export type WithdrawalEvent = {
  messageId: string
  chatId: string
  senderId: string
  accountId: string
}

// ─── Gate Evaluation Result ───

/** The complete result of gate evaluation — what to do with the event */
export type GateEvaluationResult = {
  decision: SupervisorGateDecision
  reason: string
  /** For direct_execute/simple_pass: call the original handler directly */
  proceedWithOriginalHandler: boolean
  /** For withdraw: the parsed withdrawal event */
  withdrawal?: WithdrawalEvent
  /** For compound_decompose: the decomposed sub-tasks */
  subTasks?: SubTaskSpec[]
}

// ─── Configuration ───

/** Supervisor Gate configuration (can be set in openclaw.json) */
export type SupervisorGateConfig = {
  /** Enable/disable the gate entirely */
  enabled: boolean
  /** Compound intent keyword patterns — triggers compound_decompose */
  compoundPatterns: CompoundPattern[]
  /** Single-domain keyword map — triggers simple_pass with routing hint */
  domainKeywords: DomainKeywordMap
}

export type CompoundPattern = {
  /** Regex pattern to match compound intents */
  pattern: string
  /** How to decompose this compound intent */
  decomposition: DecompositionRule[]
}

export type DecompositionRule = {
  /** Extract sub-intent from the matched text */
  extractPattern: string
  /** Target agent for this sub-intent */
  targetAgentId: string
  domain: string
  taskType: "query" | "create" | "update" | "delete" | "chat"
}

export type DomainKeywordMap = {
  /** keyword → agent mapping */
  [keyword: string]: {
    agentId: string
    domain: string
  }
}

// ─── Gate Callbacks ───

/** Callbacks provided by the integration layer (monitor.account.ts)
 *  to let the Gate interact with the message pipeline without importing core modules. */
export type GateCallbacks = {
  /** Handle a direct_execute event outside the normal pipeline.
   *  Called for slash commands — bypasses queue entirely, handles command directly,
   *  then marks the message as "already replied" in dedup. */
  directExecuteHandler?: (data: unknown) => Promise<void>
  /** Mark a message as already processed/handled in the dedup system,
   *  so the normal pipeline skips it when it arrives later. */
  markMessageHandled?: (messageId: string) => Promise<void>
  /** Send a quick acknowledgment message to the chat (e.g. "好，是否有信息补充？").
   *  Used for interrupt_request — tells user the gate is waiting for supplement. */
  sendQuickReply?: (params: { chatId: string; text: string; accountId: string }) => Promise<void>
}

// ─── Message Buffer ───

/** A buffered message waiting for merge */
export type BufferedMessage = {
  /** Raw event data from Lark SDK */
  rawData: unknown
  /** Parsed GateContext */
  ctx: GateContext
  /** Message text (if available) */
  text?: string
  /** Message ID (for dedup marking) */
  messageId?: string
}