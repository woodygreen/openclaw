import {
  AgentState,
  AgentStateChangeEvent,
  AgentStateChangeListener,
  AGENT_STATE_TRANSITIONS,
  IllegalStateTransitionError,
} from "./types"

type AgentStateMachineParams = {
  initialState?: AgentState
  onStateChange?: AgentStateChangeListener
}

export function createAgentStateMachine(params?: AgentStateMachineParams) {
  const initialState = params?.initialState ?? "idle"
  const listener = params?.onStateChange
  let currentState: AgentState = initialState
  const history: AgentState[] = [initialState]

  function transition(newState: AgentState): AgentStateChangeEvent {
    const allowedTargets = AGENT_STATE_TRANSITIONS[currentState]
    if (!allowedTargets.includes(newState)) {
      throw new IllegalStateTransitionError(currentState, newState)
    }

    const event: AgentStateChangeEvent = {
      previousState: currentState,
      newState,
      timestamp: Date.now(),
    }

    currentState = newState
    history.push(newState)
    listener?.(event)
    return event
  }

  function reset() {
    currentState = "idle"
    history.length = 0
    history.push("idle")
  }

  return {
    get currentState() {
      return currentState
    },
    get history() {
      return [...history]
    },
    transition,
    reset,
  }
}