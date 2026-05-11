// agent lifecycle state types for openclaw self-evolution

export type AgentState =
  | "idle"
  | "running"
  | "waiting_model"
  | "streaming"
  | "tool_calling"
  | "waiting_tool_result"
  | "planning"
  | "reflecting"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"

// legal state transitions map
// each entry defines which states can transition FROM the key state
export const AGENT_STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ["running"],
  running: ["waiting_model", "planning", "reflecting", "tool_calling", "failed", "completed", "cancelled", "timeout"],
  waiting_model: ["streaming", "failed", "cancelled", "timeout"],
  streaming: ["completed", "tool_calling", "failed", "cancelled", "timeout"],
  tool_calling: ["waiting_tool_result", "failed", "cancelled", "timeout"],
  waiting_tool_result: ["running", "failed", "cancelled", "timeout"],
  planning: ["running", "failed", "cancelled", "timeout"],
  reflecting: ["running", "failed", "cancelled", "timeout"],
  retrying: ["running", "failed", "cancelled", "timeout"],
  completed: ["idle"],
  failed: ["retrying", "idle"],
  cancelled: ["idle"],
  timeout: ["retrying", "idle"],
}

// human-readable labels for each state (used in TUI and feishu status bar)
export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  idle: "idle",
  running: "running",
  waiting_model: "waiting",
  streaming: "streaming",
  tool_calling: "tool calling",
  waiting_tool_result: "waiting tool",
  planning: "planning",
  reflecting: "reflecting",
  retrying: "retrying",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
  timeout: "timeout",
}

// feishu card status bar color mapping
export const AGENT_STATE_COLORS: Record<AgentState, string> = {
  idle: "grey",
  running: "blue",
  waiting_model: "orange",
  streaming: "blue",
  tool_calling: "purple",
  waiting_tool_result: "orange",
  planning: "blue",
  reflecting: "green",
  retrying: "orange",
  completed: "green",
  failed: "red",
  cancelled: "grey",
  timeout: "red",
}

// state change event emitted by the state machine
export type AgentStateChangeEvent = {
  previousState: AgentState
  newState: AgentState
  timestamp: number
}

// listener for state change events
export type AgentStateChangeListener = (event: AgentStateChangeEvent) => void

// error thrown for illegal state transitions
export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: AgentState,
    public readonly to: AgentState,
  ) {
    super(`illegal state transition: ${from} -> ${to}`)
    this.name = "IllegalStateTransitionError"
  }
}