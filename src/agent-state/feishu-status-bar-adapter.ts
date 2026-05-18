// adapter that bridges agent state machine to feishu status bar updates
import type { AgentState, AgentStateChangeEvent } from "./types"
import { AGENT_STATE_LABELS, AGENT_STATE_COLORS } from "./types"
import type { FeishuStreamingSession } from "../extensions/feishu/src/streaming-card"

// map agent state to feishu status bar content
export function agentStateToStatusBar(state: AgentState): { label: string; color: string } {
  return {
    label: AGENT_STATE_LABELS[state],
    color: AGENT_STATE_COLORS[state],
  }
}

// create a listener that updates feishu streaming card status bar on state changes
export function createFeishuStatusBarListener(
  streamingSession: FeishuStreamingSession,
): (event: AgentStateChangeEvent) => void {
  return (event: AgentStateChangeEvent) => {
    const { label, color } = agentStateToStatusBar(event.newState)
    streamingSession.updateStatusBar(label, color).catch(() => {
      // status bar update is non-critical, silently swallow errors
    })
  }
}