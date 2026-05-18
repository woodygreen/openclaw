// standard SSE event types for agent streaming
// module 9+10: two-layer SSE format with event field + JSON data field
// event types: start, token, tool_call, tool_result, status, error, done

export enum SseEventType {
  Start = "start",
  Token = "token",
  ToolCall = "tool_call",
  ToolResult = "tool_result",
  Status = "status",
  Error = "error",
  Done = "done",
}

export type SseStartEvent = {
  runId: string
  sessionId: string
  agentId: string
  model?: string
  timestamp: number
}

export type SseTokenEvent = {
  runId: string
  sessionId: string
  agentId: string
  delta: string
  timestamp: number
}

export type SseStatusEvent = {
  runId: string
  sessionId: string
  agentId: string
  state: string
  label: string
  timestamp: number
}

export type SseErrorEvent = {
  runId: string
  sessionId: string
  agentId: string
  errorCode: string
  errorMessage: string
  timestamp: number
}

export type SseDoneEvent = {
  runId: string
  sessionId: string
  agentId: string
  reason: "completed" | "cancelled" | "timeout" | "error"
  timestamp: number
}

export type SseToolCallEvent = {
  runId: string
  sessionId: string
  agentId: string
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  timestamp: number
}

export type SseToolResultEvent = {
  runId: string
  sessionId: string
  agentId: string
  toolCallId: string
  status: "success" | "error"
  result: string | null
  errorCode?: string
  errorMessage?: string
  timestamp: number
}

export type SseEventData =
  | SseStartEvent
  | SseTokenEvent
  | SseToolCallEvent
  | SseToolResultEvent
  | SseStatusEvent
  | SseErrorEvent
  | SseDoneEvent

export type SseEvent = {
  type: SseEventType
  data: SseEventData
}

export function createSseEvent(
  type: SseEventType,
  data: SseEventData,
): SseEvent {
  return {
    type,
    data: {
      ...data,
      timestamp: data.timestamp ?? Date.now(),
    },
  }
}

// format as standard SSE: event: <type>\ndata: <json>\n\n
export function formatSseMessage(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
}

// parse standard SSE message back to event object
export function parseSseMessage(raw: string): SseEvent | null {
  const lines = raw.split("\n")
  let eventType: string | null = null
  let dataLine: string | null = null

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim()
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6).trim()
    }
  }

  if (!eventType || !dataLine) return null

  const VALID_EVENT_TYPES = new Set<string>(Object.values(SseEventType))
  if (!VALID_EVENT_TYPES.has(eventType)) return null

  try {
    const data = JSON.parse(dataLine)
    return { type: eventType as SseEventType, data }
  } catch {
    return null
  }
}