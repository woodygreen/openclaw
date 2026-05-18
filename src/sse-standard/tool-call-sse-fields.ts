// module 11: tool call SSE event fields
// tool_call event: run_id, session_id, agent_id, tool_call_id, tool_name, arguments, timestamp
// tool_result event: run_id, session_id, agent_id, tool_call_id, status, result, error_code, error_message, timestamp

import {
  SseEventType,
  type SseEvent,
  type SseToolCallEvent,
  type SseToolResultEvent,
} from "./sse-event-types"

export type ToolCallSseFields = {
  runId: string
  sessionId: string
  agentId: string
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  timestamp?: number
}

export type ToolResultSseFields = {
  runId: string
  sessionId: string
  agentId: string
  toolCallId: string
  status: "success" | "error"
  result: string | null
  errorCode?: string
  errorMessage?: string
  timestamp?: number
}

export function createToolCallSseEvent(fields: ToolCallSseFields): SseEvent {
  const data: SseToolCallEvent = {
    runId: fields.runId,
    sessionId: fields.sessionId,
    agentId: fields.agentId,
    toolCallId: fields.toolCallId,
    toolName: fields.toolName,
    arguments: fields.arguments,
    timestamp: fields.timestamp ?? Date.now(),
  }
  return { type: SseEventType.ToolCall, data }
}

export function createToolResultSseEvent(fields: ToolResultSseFields): SseEvent {
  const data: SseToolResultEvent = {
    runId: fields.runId,
    sessionId: fields.sessionId,
    agentId: fields.agentId,
    toolCallId: fields.toolCallId,
    status: fields.status,
    result: fields.result,
    timestamp: fields.timestamp ?? Date.now(),
  }
  if (fields.errorCode !== undefined) data.errorCode = fields.errorCode
  if (fields.errorMessage !== undefined) data.errorMessage = fields.errorMessage
  return { type: SseEventType.ToolResult, data }
}

const TOOL_CALL_REQUIRED_FIELDS = [
  "runId",
  "sessionId",
  "agentId",
  "toolCallId",
  "toolName",
  "arguments",
  "timestamp",
]

const TOOL_RESULT_REQUIRED_FIELDS = [
  "runId",
  "sessionId",
  "agentId",
  "toolCallId",
  "status",
  "timestamp",
]

export type FieldValidationResult = {
  valid: boolean
  missingFields: string[]
}

export function validateToolCallSseFields(
  data: Record<string, unknown>,
): FieldValidationResult {
  const missing = TOOL_CALL_REQUIRED_FIELDS.filter(
    (field) => data[field] === undefined || data[field] === null,
  )
  return {
    valid: missing.length === 0,
    missingFields: missing,
  }
}

export function validateToolResultSseFields(
  data: Record<string, unknown>,
): FieldValidationResult {
  const missing = TOOL_RESULT_REQUIRED_FIELDS.filter(
    (field) => data[field] === undefined || data[field] === null,
  )
  return {
    valid: missing.length === 0,
    missingFields: missing,
  }
}