import { describe, it, expect, vi } from "vitest"
import {
  agentStateToTuiStatus,
  agentStateToTuiLabel,
  createTuiStatusBarListener,
} from "./tui-status-bar-adapter"
import { agentStateToStatusBar } from "./feishu-status-bar-adapter"
import { createAgentStateMachine } from "./state-machine"
import type { AgentState, AgentStateChangeEvent } from "./types"

describe("TUI Status Bar Adapter", () => {
  it("should map idle to TUI idle", () => {
    expect(agentStateToTuiStatus("idle")).toBe("idle")
  })

  it("should map streaming to TUI streaming", () => {
    expect(agentStateToTuiStatus("streaming")).toBe("streaming")
  })

  it("should map waiting_model to TUI waiting", () => {
    expect(agentStateToTuiStatus("waiting_model")).toBe("waiting")
  })

  it("should map running to TUI running", () => {
    expect(agentStateToTuiStatus("running")).toBe("running")
  })

  it("should map tool_calling to TUI running", () => {
    expect(agentStateToTuiStatus("tool_calling")).toBe("running")
  })

  it("should map planning to TUI running", () => {
    expect(agentStateToTuiStatus("planning")).toBe("running")
  })

  it("should map reflecting to TUI running", () => {
    expect(agentStateToTuiStatus("reflecting")).toBe("running")
  })

  it("should map failed to TUI error", () => {
    expect(agentStateToTuiStatus("failed")).toBe("error")
  })

  it("should map cancelled to TUI aborted", () => {
    expect(agentStateToTuiStatus("cancelled")).toBe("aborted")
  })

  it("should map timeout to TUI error", () => {
    expect(agentStateToTuiStatus("timeout")).toBe("error")
  })

  it("should return readable labels for TUI footer", () => {
    expect(agentStateToTuiLabel("tool_calling")).toBe("tool calling")
    expect(agentStateToTuiLabel("planning")).toBe("planning")
    expect(agentStateToTuiLabel("reflecting")).toBe("reflecting")
  })

  it("should create listener that calls setActivityStatus on state change", () => {
    const setActivityStatus = vi.fn()
    const listener = createTuiStatusBarListener(setActivityStatus)
    const sm = createAgentStateMachine({ onStateChange: listener })
    sm.transition("running")
    expect(setActivityStatus).toHaveBeenCalledWith("running")
  })

  it("should map full lifecycle through TUI", () => {
    const setActivityStatus = vi.fn()
    const listener = createTuiStatusBarListener(setActivityStatus)
    const sm = createAgentStateMachine({ onStateChange: listener })
    sm.transition("running")
    expect(setActivityStatus).toHaveBeenLastCalledWith("running")
    sm.transition("waiting_model")
    expect(setActivityStatus).toHaveBeenLastCalledWith("waiting")
    sm.transition("streaming")
    expect(setActivityStatus).toHaveBeenLastCalledWith("streaming")
    sm.transition("completed")
    expect(setActivityStatus).toHaveBeenLastCalledWith("idle")
  })
})

describe("Feishu Status Bar Adapter", () => {
  it("should map idle to grey status bar", () => {
    const result = agentStateToStatusBar("idle")
    expect(result).toEqual({ label: "idle", color: "grey" })
  })

  it("should map streaming to blue status bar", () => {
    const result = agentStateToStatusBar("streaming")
    expect(result).toEqual({ label: "streaming", color: "blue" })
  })

  it("should map failed to red status bar", () => {
    const result = agentStateToStatusBar("failed")
    expect(result).toEqual({ label: "failed", color: "red" })
  })

  it("should map planning to blue status bar", () => {
    const result = agentStateToStatusBar("planning")
    expect(result).toEqual({ label: "planning", color: "blue" })
  })

  it("should map reflecting to green status bar", () => {
    const result = agentStateToStatusBar("reflecting")
    expect(result).toEqual({ label: "reflecting", color: "green" })
  })

  it("should map tool_calling to purple status bar", () => {
    const result = agentStateToStatusBar("tool_calling")
    expect(result).toEqual({ label: "tool calling", color: "purple" })
  })

  it("should map retrying to orange status bar", () => {
    const result = agentStateToStatusBar("retrying")
    expect(result).toEqual({ label: "retrying", color: "orange" })
  })
})