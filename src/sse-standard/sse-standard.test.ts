import { describe, it, expect } from "vitest"
import {
  SseEventType,
  type SseEvent,
  type SseStartEvent,
  type SseTokenEvent,
  type SseToolCallEvent,
  type SseToolResultEvent,
  type SseStatusEvent,
  type SseErrorEvent,
  type SseDoneEvent,
  createSseEvent,
  formatSseMessage,
  parseSseMessage,
} from "./sse-event-types"
import {
  createToolCallSseEvent,
  createToolResultSseEvent,
  validateToolCallSseFields,
  validateToolResultSseFields,
} from "./tool-call-sse-fields"

describe("SSE Event Types", () => {
  it("should create start event with run metadata", () => {
    const event = createSseEvent(SseEventType.Start, {
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      model: "claude-sonnet-4-6",
    })
    expect(event.type).toBe("start")
    expect(event.data.runId).toBe("run-1")
    expect(event.data.sessionId).toBe("sess-1")
    expect(event.data.agentId).toBe("agent-1")
  })

  it("should create token event with delta text", () => {
    const event = createSseEvent(SseEventType.Token, {
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      delta: "Hello",
    })
    expect(event.type).toBe("token")
    expect(event.data.delta).toBe("Hello")
  })

  it("should create status event with agent state", () => {
    const event = createSseEvent(SseEventType.Status, {
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      state: "running",
      label: "running",
    })
    expect(event.type).toBe("status")
    expect(event.data.state).toBe("running")
  })

  it("should create error event with error details", () => {
    const event = createSseEvent(SseEventType.Error, {
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      errorCode: "RATE_LIMIT",
      errorMessage: "Too many requests",
    })
    expect(event.type).toBe("error")
    expect(event.data.errorCode).toBe("RATE_LIMIT")
  })

  it("should create done event with completion info", () => {
    const event = createSseEvent(SseEventType.Done, {
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      reason: "completed",
    })
    expect(event.type).toBe("done")
    expect(event.data.reason).toBe("completed")
  })

  it("should format SSE message with event and data fields", () => {
    const event: SseEvent = {
      type: SseEventType.Token,
      data: {
        runId: "run-1",
        sessionId: "sess-1",
        agentId: "agent-1",
        delta: "Hello world",
      },
    }
    const formatted = formatSseMessage(event)
    // standard SSE format: event: <type>\ndata: <json>\n\n
    expect(formatted).toContain("event: token\n")
    expect(formatted).toContain("data: ")
    expect(formatted).toContain('"delta":"Hello world"')
    expect(formatted.endsWith("\n\n")).toBe(true)
  })

  it("should format SSE message for done event", () => {
    const event: SseEvent = {
      type: SseEventType.Done,
      data: {
        runId: "run-1",
        sessionId: "sess-1",
        agentId: "agent-1",
        reason: "completed",
      },
    }
    const formatted = formatSseMessage(event)
    expect(formatted).toContain("event: done\n")
  })

  it("should parse SSE message back to event object", () => {
    const raw = "event: token\ndata: {\"runId\":\"run-1\",\"sessionId\":\"sess-1\",\"agentId\":\"agent-1\",\"delta\":\"test\"}\n\n"
    const parsed = parseSseMessage(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.type).toBe("token")
    expect(parsed!.data.delta).toBe("test")
  })

  it("should parse done SSE message", () => {
    const raw = "event: done\ndata: {\"runId\":\"run-1\",\"reason\":\"completed\"}\n\n"
    const parsed = parseSseMessage(raw)
    expect(parsed!.type).toBe("done")
    expect(parsed!.data.reason).toBe("completed")
  })

  it("should return null for invalid SSE message", () => {
    const parsed = parseSseMessage("not valid sse")
    expect(parsed).toBeNull()
  })

  it("should return null for unrecognized event type", () => {
    const raw = "event: unknown_type\ndata: {\"runId\":\"run-1\"}\n\n"
    const parsed = parseSseMessage(raw)
    expect(parsed).toBeNull()
  })

  it("should include timestamp in all events", () => {
    const event = createSseEvent(SseEventType.Start, {
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      model: "claude-sonnet-4-6",
    })
    expect(event.data.timestamp).toBeGreaterThan(0)
  })
})

describe("Tool Call SSE Event Fields", () => {
  it("should create tool_call event with all required fields", () => {
    const event = createToolCallSseEvent({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      toolCallId: "tc-1",
      toolName: "web_search",
      arguments: { query: "test query" },
    })
    expect(event.type).toBe("tool_call")
    expect(event.data.runId).toBe("run-1")
    expect(event.data.sessionId).toBe("sess-1")
    expect(event.data.agentId).toBe("agent-1")
    expect(event.data.toolCallId).toBe("tc-1")
    expect(event.data.toolName).toBe("web_search")
    expect(event.data.arguments).toEqual({ query: "test query" })
    expect(event.data.timestamp).toBeGreaterThan(0)
  })

  it("should create tool_result event with all required fields", () => {
    const event = createToolResultSseEvent({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      toolCallId: "tc-1",
      status: "success",
      result: "search results found",
    })
    expect(event.type).toBe("tool_result")
    expect(event.data.runId).toBe("run-1")
    expect(event.data.sessionId).toBe("sess-1")
    expect(event.data.agentId).toBe("agent-1")
    expect(event.data.toolCallId).toBe("tc-1")
    expect(event.data.status).toBe("success")
    expect(event.data.result).toBe("search results found")
    expect(event.data.timestamp).toBeGreaterThan(0)
  })

  it("should create tool_result event with error fields", () => {
    const event = createToolResultSseEvent({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      toolCallId: "tc-2",
      status: "error",
      result: null,
      errorCode: "PERMISSION_DENIED",
      errorMessage: "owner-only tool",
    })
    expect(event.data.status).toBe("error")
    expect(event.data.errorCode).toBe("PERMISSION_DENIED")
    expect(event.data.errorMessage).toBe("owner-only tool")
  })

  it("should validate tool_call event has all required fields", () => {
    const result = validateToolCallSseFields({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      toolCallId: "tc-1",
      toolName: "web_search",
      arguments: { query: "test" },
      timestamp: Date.now(),
    })
    expect(result.valid).toBe(true)
    expect(result.missingFields).toHaveLength(0)
  })

  it("should reject tool_call event missing required fields", () => {
    const result = validateToolCallSseFields({
      runId: "run-1",
      // missing sessionId, agentId, toolCallId, toolName, arguments, timestamp
    })
    expect(result.valid).toBe(false)
    expect(result.missingFields).toContain("sessionId")
    expect(result.missingFields).toContain("agentId")
    expect(result.missingFields).toContain("toolCallId")
    expect(result.missingFields).toContain("toolName")
  })

  it("should validate tool_result event has all required fields", () => {
    const result = validateToolResultSseFields({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      toolCallId: "tc-1",
      status: "success",
      result: "ok",
      errorCode: undefined,
      errorMessage: undefined,
      timestamp: Date.now(),
    })
    expect(result.valid).toBe(true)
  })

  it("should reject tool_result event missing required fields", () => {
    const result = validateToolResultSseFields({
      runId: "run-1",
      // missing sessionId, agentId, toolCallId, status, timestamp
    })
    expect(result.valid).toBe(false)
    expect(result.missingFields).toContain("sessionId")
    expect(result.missingFields).toContain("status")
  })

  it("should format tool_call SSE message correctly", () => {
    const event = createToolCallSseEvent({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      toolCallId: "tc-1",
      toolName: "web_search",
      arguments: { query: "test" },
    })
    const formatted = formatSseMessage(event)
    expect(formatted).toContain("event: tool_call\n")
    expect(formatted).toContain('"toolCallId":"tc-1"')
    expect(formatted).toContain('"toolName":"web_search"')
  })

  it("should format tool_result SSE message correctly", () => {
    const event = createToolResultSseEvent({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "agent-1",
      toolCallId: "tc-1",
      status: "success",
      result: "done",
    })
    const formatted = formatSseMessage(event)
    expect(formatted).toContain("event: tool_result\n")
    expect(formatted).toContain('"status":"success"')
  })
})