import { describe, it, expect } from "vitest"
import {
  ToolCallPhase,
  type ToolCallLifecycleEvent,
  type ToolCallLifecycleTrace,
  createToolCallLifecycleTracker,
} from "./lifecycle-tracker"
import {
  validateToolCallArguments,
  validateToolCallPermission,
  formatToolResult,
  type ToolCallRequest,
  type ToolCallResult,
} from "./lifecycle-validation"

describe("ToolCallLifecycleTracker", () => {
  it("should track full lifecycle from context_load to final_answer", () => {
    const tracker = createToolCallLifecycleTracker()
    tracker.record({
      runId: "run-1",
      sessionId: "sess-1",
      phase: ToolCallPhase.ContextLoad,
      timestamp: 1000,
      data: { toolsLoaded: 3, historyLoaded: true, memoryLoaded: true },
    })
    tracker.record({
      runId: "run-1",
      sessionId: "sess-1",
      phase: ToolCallPhase.ModelDecision,
      timestamp: 2000,
      data: { toolName: "web_search", arguments: { query: "test" } },
    })
    tracker.record({
      runId: "run-1",
      sessionId: "sess-1",
      phase: ToolCallPhase.PermissionCheck,
      timestamp: 3000,
      data: { allowed: true, policy: "default" },
    })
    tracker.record({
      runId: "run-1",
      sessionId: "sess-1",
      phase: ToolCallPhase.ArgumentValidation,
      timestamp: 4000,
      data: { valid: true, sanitizedArgs: { query: "test" } },
    })
    tracker.record({
      runId: "run-1",
      sessionId: "sess-1",
      phase: ToolCallPhase.Execution,
      timestamp: 5000,
      data: { durationMs: 150, success: true },
    })
    tracker.record({
      runId: "run-1",
      sessionId: "sess-1",
      phase: ToolCallPhase.ResultReturn,
      timestamp: 6000,
      data: { resultText: "search results for test", truncated: false },
    })
    tracker.record({
      runId: "run-1",
      sessionId: "sess-1",
      phase: ToolCallPhase.FinalAnswer,
      timestamp: 7000,
      data: { answer: "Based on search results, here is the answer" },
    })

    const trace = tracker.getTrace("run-1")
    expect(trace).not.toBeNull()
    expect(trace!.events).toHaveLength(7)
    expect(trace!.events[0].phase).toBe(ToolCallPhase.ContextLoad)
    expect(trace!.events[6].phase).toBe(ToolCallPhase.FinalAnswer)
  })

  it("should track lifecycle with permission denied", () => {
    const tracker = createToolCallLifecycleTracker()
    tracker.record({
      runId: "run-2",
      sessionId: "sess-2",
      phase: ToolCallPhase.ContextLoad,
      timestamp: 1000,
      data: { toolsLoaded: 5, historyLoaded: true, memoryLoaded: true },
    })
    tracker.record({
      runId: "run-2",
      sessionId: "sess-2",
      phase: ToolCallPhase.ModelDecision,
      timestamp: 2000,
      data: { toolName: "gateway", arguments: { action: "restart" } },
    })
    tracker.record({
      runId: "run-2",
      sessionId: "sess-2",
      phase: ToolCallPhase.PermissionCheck,
      timestamp: 3000,
      data: { allowed: false, reason: "owner-only tool", policy: "owner_only" },
    })

    const trace = tracker.getTrace("run-2")
    expect(trace!.events).toHaveLength(3)
    expect(trace!.events[2].phase).toBe(ToolCallPhase.PermissionCheck)
    // permission denied = lifecycle stops here, no execution/result phases
    const lastPhase = trace!.events[trace!.events.length - 1].phase
    expect(lastPhase).not.toBe(ToolCallPhase.Execution)
  })

  it("should track lifecycle with argument validation failure", () => {
    const tracker = createToolCallLifecycleTracker()
    tracker.record({
      runId: "run-3",
      sessionId: "sess-3",
      phase: ToolCallPhase.ContextLoad,
      timestamp: 1000,
      data: { toolsLoaded: 3, historyLoaded: true, memoryLoaded: true },
    })
    tracker.record({
      runId: "run-3",
      sessionId: "sess-3",
      phase: ToolCallPhase.ModelDecision,
      timestamp: 2000,
      data: { toolName: "web_search", arguments: {} }, // missing required query
    })
    tracker.record({
      runId: "run-3",
      sessionId: "sess-3",
      phase: ToolCallPhase.ArgumentValidation,
      timestamp: 3000,
      data: { valid: false, error: "missing required parameter: query" },
    })

    const trace = tracker.getTrace("run-3")
    expect(trace!.events).toHaveLength(3)
    const lastPhase = trace!.events[trace!.events.length - 1].phase
    expect(lastPhase).not.toBe(ToolCallPhase.Execution)
  })

  it("should track lifecycle with tool execution error", () => {
    const tracker = createToolCallLifecycleTracker()
    tracker.record({
      runId: "run-4",
      sessionId: "sess-4",
      phase: ToolCallPhase.ContextLoad,
      timestamp: 1000,
      data: { toolsLoaded: 3, historyLoaded: true, memoryLoaded: true },
    })
    tracker.record({
      runId: "run-4",
      sessionId: "sess-4",
      phase: ToolCallPhase.ModelDecision,
      timestamp: 2000,
      data: { toolName: "exec", arguments: { command: "rm -rf /" } },
    })
    tracker.record({
      runId: "run-4",
      sessionId: "sess-4",
      phase: ToolCallPhase.PermissionCheck,
      timestamp: 3000,
      data: { allowed: true, policy: "default" },
    })
    tracker.record({
      runId: "run-4",
      sessionId: "sess-4",
      phase: ToolCallPhase.ArgumentValidation,
      timestamp: 4000,
      data: { valid: true, sanitizedArgs: { command: "rm -rf /" } },
    })
    tracker.record({
      runId: "run-4",
      sessionId: "sess-4",
      phase: ToolCallPhase.Execution,
      timestamp: 5000,
      data: { durationMs: 10, success: false, error: "command blocked by fs policy" },
    })

    const trace = tracker.getTrace("run-4")
    expect(trace!.events).toHaveLength(5)
    // execution failed but we still get result back to model (error result)
  })

  it("should validate complete lifecycle has all required phases", () => {
    const tracker = createToolCallLifecycleTracker()
    tracker.record({
      runId: "run-5",
      sessionId: "sess-5",
      phase: ToolCallPhase.ContextLoad,
      timestamp: 1000,
      data: {},
    })
    tracker.record({
      runId: "run-5",
      sessionId: "sess-5",
      phase: ToolCallPhase.ModelDecision,
      timestamp: 2000,
      data: {},
    })
    tracker.record({
      runId: "run-5",
      sessionId: "sess-5",
      phase: ToolCallPhase.PermissionCheck,
      timestamp: 3000,
      data: { allowed: true },
    })
    tracker.record({
      runId: "run-5",
      sessionId: "sess-5",
      phase: ToolCallPhase.ArgumentValidation,
      timestamp: 4000,
      data: { valid: true },
    })
    tracker.record({
      runId: "run-5",
      sessionId: "sess-5",
      phase: ToolCallPhase.Execution,
      timestamp: 5000,
      data: { success: true },
    })
    tracker.record({
      runId: "run-5",
      sessionId: "sess-5",
      phase: ToolCallPhase.ResultReturn,
      timestamp: 6000,
      data: {},
    })
    tracker.record({
      runId: "run-5",
      sessionId: "sess-5",
      phase: ToolCallPhase.FinalAnswer,
      timestamp: 7000,
      data: {},
    })

    const trace = tracker.getTrace("run-5")
    expect(trace!.isTerminal()).toBe(true)
  })

  it("should detect incomplete lifecycle", () => {
    const tracker = createToolCallLifecycleTracker()
    tracker.record({
      runId: "run-6",
      sessionId: "sess-6",
      phase: ToolCallPhase.ContextLoad,
      timestamp: 1000,
      data: {},
    })
    tracker.record({
      runId: "run-6",
      sessionId: "sess-6",
      phase: ToolCallPhase.ModelDecision,
      timestamp: 2000,
      data: {},
    })

    const trace = tracker.getTrace("run-6")
    expect(trace!.isTerminal()).toBe(false)
  })

  it("should list all tracked runs", () => {
    const tracker = createToolCallLifecycleTracker()
    tracker.record({ runId: "r1", sessionId: "s1", phase: ToolCallPhase.ContextLoad, timestamp: 1, data: {} })
    tracker.record({ runId: "r2", sessionId: "s2", phase: ToolCallPhase.ContextLoad, timestamp: 2, data: {} })
    expect(tracker.listRuns()).toEqual(["r1", "r2"])
  })
})

describe("ToolCallLifecycle Validation", () => {
  it("should validate tool call arguments with required fields", () => {
    const request: ToolCallRequest = {
      toolCallId: "tc-1",
      toolName: "web_search",
      arguments: { query: "test query" },
      sessionId: "sess-1",
      agentId: "agent-1",
      runId: "run-1",
      timestamp: Date.now(),
    }
    const result = validateToolCallArguments(request, {
      requiredParams: ["query"],
    })
    expect(result.valid).toBe(true)
  })

  it("should reject tool call missing required arguments", () => {
    const request: ToolCallRequest = {
      toolCallId: "tc-2",
      toolName: "web_search",
      arguments: {}, // missing query
      sessionId: "sess-1",
      agentId: "agent-1",
      runId: "run-1",
      timestamp: Date.now(),
    }
    const result = validateToolCallArguments(request, {
      requiredParams: ["query"],
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("query")
  })

  it("should validate tool call permission for allowed tool", () => {
    const request: ToolCallRequest = {
      toolCallId: "tc-3",
      toolName: "web_search",
      arguments: { query: "test" },
      sessionId: "sess-1",
      agentId: "agent-1",
      runId: "run-1",
      timestamp: Date.now(),
    }
    const result = validateToolCallPermission(request, {
      allowedTools: ["web_search", "web_fetch", "read"],
      ownerId: "owner-1",
    })
    expect(result.allowed).toBe(true)
  })

  it("should reject tool call permission for denied tool", () => {
    const request: ToolCallRequest = {
      toolCallId: "tc-4",
      toolName: "gateway",
      arguments: { action: "restart" },
      sessionId: "sess-1",
      agentId: "agent-1",
      runId: "run-1",
      timestamp: Date.now(),
    }
    const result = validateToolCallPermission(request, {
      allowedTools: ["web_search", "read"],
      ownerId: "owner-1",
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("gateway")
  })

  it("should default-deny when allowedTools is undefined", () => {
    const request: ToolCallRequest = {
      toolCallId: "tc-5",
      toolName: "web_search",
      arguments: { query: "test" },
      sessionId: "sess-1",
      agentId: "agent-1",
      runId: "run-1",
      timestamp: Date.now(),
    }
    const result = validateToolCallPermission(request, {})
    expect(result.allowed).toBe(false)
    expect(result.policy).toBe("default_deny")
    expect(result.reason).toContain("default deny")
  })

  it("should format tool result with standard fields", () => {
    const result: ToolCallResult = {
      toolCallId: "tc-1",
      status: "success",
      result: "search results for test",
      agentId: "agent-1",
      sessionId: "sess-1",
      runId: "run-1",
      timestamp: Date.now(),
    }
    const formatted = formatToolResult(result)
    expect(formatted).toContain("toolCallId")
    expect(formatted).toContain("tc-1")
    expect(formatted).toContain("success")
    expect(formatted).toContain("search results for test")
  })

  it("should format tool result error with error fields", () => {
    const result: ToolCallResult = {
      toolCallId: "tc-2",
      status: "error",
      result: null,
      errorCode: "PERMISSION_DENIED",
      errorMessage: "tool requires owner access",
      agentId: "agent-1",
      sessionId: "sess-1",
      runId: "run-1",
      timestamp: Date.now(),
    }
    const formatted = formatToolResult(result)
    expect(formatted).toContain("PERMISSION_DENIED")
    expect(formatted).toContain("tool requires owner access")
  })
})