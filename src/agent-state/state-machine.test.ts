import { describe, it, expect, vi } from "vitest"
import { createAgentStateMachine } from "./state-machine"
import {
  AgentState,
  AGENT_STATE_TRANSITIONS,
  IllegalStateTransitionError,
} from "./types"

describe("AgentStateMachine", () => {
  it("should start in idle state", () => {
    const sm = createAgentStateMachine()
    expect(sm.currentState).toBe("idle")
  })

  it("should allow legal transition idle -> running", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    expect(sm.currentState).toBe("running")
  })

  it("should throw on illegal transition idle -> streaming", () => {
    const sm = createAgentStateMachine()
    expect(() => sm.transition("streaming")).toThrow(IllegalStateTransitionError)
  })

  it("should throw on illegal transition completed -> running", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("waiting_model")
    sm.transition("streaming")
    sm.transition("completed")
    expect(() => sm.transition("running")).toThrow(IllegalStateTransitionError)
  })

  it("should allow retrying after failed", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("failed")
    sm.transition("retrying")
    expect(sm.currentState).toBe("retrying")
  })

  it("should allow retrying after timeout", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("timeout")
    sm.transition("retrying")
    expect(sm.currentState).toBe("retrying")
  })

  it("should allow idle after failed", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("failed")
    sm.transition("idle")
    expect(sm.currentState).toBe("idle")
  })

  it("should emit state change events", () => {
    const listener = vi.fn()
    const sm = createAgentStateMachine({ onStateChange: listener })
    sm.transition("running")
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({
      previousState: "idle",
      newState: "running",
      timestamp: expect.any(Number),
    })
  })

  it("should not emit events on illegal transition attempt", () => {
    const listener = vi.fn()
    const sm = createAgentStateMachine({ onStateChange: listener })
    expect(() => sm.transition("streaming")).toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  // test all legal transitions exhaustively
  it("should allow all defined legal transitions", () => {
    for (const [from, allowedTargets] of Object.entries(AGENT_STATE_TRANSITIONS)) {
      for (const to of allowedTargets) {
        const sm = createAgentStateMachine({ initialState: from as AgentState })
        sm.transition(to as AgentState)
        expect(sm.currentState).toBe(to)
      }
    }
  })

  // test all illegal transitions exhaustively
  it("should reject all undefined transitions", () => {
    const allStates = Object.keys(AGENT_STATE_TRANSITIONS) as AgentState[]
    for (const [from, allowedTargets] of Object.entries(AGENT_STATE_TRANSITIONS)) {
      const illegalTargets = allStates.filter(
        (s) => s !== from && !allowedTargets.includes(s),
      )
      for (const to of illegalTargets) {
        const sm = createAgentStateMachine({ initialState: from as AgentState })
        expect(() => sm.transition(to)).toThrow(IllegalStateTransitionError)
      }
    }
  })

  it("should support planning state from running", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("planning")
    expect(sm.currentState).toBe("planning")
  })

  it("should support reflecting state from running", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("reflecting")
    expect(sm.currentState).toBe("reflecting")
  })

  it("should support full tool call lifecycle", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("tool_calling")
    sm.transition("waiting_tool_result")
    sm.transition("running")
    expect(sm.currentState).toBe("running")
  })

  it("should support cancel from any active state", () => {
    const activeStates: AgentState[] = [
      "running",
      "waiting_model",
      "streaming",
      "tool_calling",
      "waiting_tool_result",
      "planning",
      "reflecting",
      "retrying",
    ]
    for (const state of activeStates) {
      const sm = createAgentStateMachine({ initialState: state })
      sm.transition("cancelled")
      expect(sm.currentState).toBe("cancelled")
      sm.transition("idle")
      expect(sm.currentState).toBe("idle")
    }
  })

  it("should provide state history", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("waiting_model")
    sm.transition("streaming")
    sm.transition("completed")
    expect(sm.history).toEqual(["idle", "running", "waiting_model", "streaming", "completed"])
  })

  it("should reset to idle state", () => {
    const sm = createAgentStateMachine()
    sm.transition("running")
    sm.transition("failed")
    sm.reset()
    expect(sm.currentState).toBe("idle")
  })

  it("should return transition metadata", () => {
    const sm = createAgentStateMachine()
    const result = sm.transition("running")
    expect(result).toEqual({
      previousState: "idle",
      newState: "running",
      timestamp: expect.any(Number),
    })
  })
})