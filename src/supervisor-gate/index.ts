// Supervisor Gate — public API barrel export
export {
  wrapHandlerWithGate,
  setGateEnabled,
  setGateLogger,
} from "./gate.js"

export {
  classifyEvent,
} from "./classifier.js"

export {
  MessageIdCache,
  setCacheLogger,
  buildSessionKey,
  gateLog,
} from "./cache.js"

export {
  parseWithdrawalEvent,
  markMessageRecalled,
  isMessageRecalled,
  clearRecalledMessages,
  getWithdrawalStats,
} from "./withdrawal.js"

export type {
  SupervisorGateDecision,
  GateContext,
  ClassifiedIntent,
  SubTaskSpec,
  WithdrawalEvent,
  GateEvaluationResult,
  SupervisorGateConfig,
  CompoundPattern,
  DecompositionRule,
  DomainKeywordMap,
  GateCallbacks,
  BufferedMessage,
  MessageClassification,
  MessageEntry,
  PerChatCache,
  ChatProcessingStatus,
} from "./types.js"