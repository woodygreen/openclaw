// adapter that bridges agent state machine to TUI activity status
import type { AgentState, AgentStateChangeEvent } from "./types"
import { AGENT_STATE_LABELS } from "./types"

// map agent state to TUI activityStatus string
// TUI uses: idle, streaming, waiting, running, sending, error, aborted
// we map our richer state model to these TUI-recognized values
const AGENT_STATE_TO_TUI_STATUS: Record<AgentState, string> = {
  idle: "idle",
  running: "running",
  waiting_model: "waiting",
  streaming: "streaming",
  tool_calling: "running",
  waiting_tool_result: "waiting",
  planning: "running",
  reflecting: "running",
  retrying: "running",
  completed: "idle",
  failed: "error",
  cancelled: "aborted",
  timeout: "error",
}

// detailed label for TUI status bar (shows full state name)
export function agentStateToTuiStatus(state: AgentState): string {
  return AGENT_STATE_TO_TUI_STATUS[state]
}

// detailed label for TUI footer (shows full state label)
export function agentStateToTuiLabel(state: AgentState): string {
  return AGENT_STATE_LABELS[state]
}

// create a listener that updates TUI on state changes
export function createTuiStatusBarListener(
  setActivityStatus: (text: string) => void,
): (event: AgentStateChangeEvent) => void {
  return (event: AgentStateChangeEvent) => {
    const tuiStatus = agentStateToTuiStatus(event.newState)
    setActivityStatus(tuiStatus)
  }
}