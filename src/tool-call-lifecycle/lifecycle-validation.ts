// tool call lifecycle validation: argument and permission checks
export type ToolCallRequest = {
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  sessionId: string
  agentId: string
  runId: string
  timestamp: number
}

export type ToolCallResult = {
  toolCallId: string
  status: "success" | "error"
  result: string | null
  errorCode?: string
  errorMessage?: string
  agentId: string
  sessionId: string
  runId: string
  timestamp: number
}

export type ArgumentValidationConfig = {
  requiredParams?: string[]
}

export type PermissionValidationConfig = {
  allowedTools?: string[]
  ownerId?: string
  ownerOnlyTools?: string[]
  senderId?: string
}

export type ArgumentValidationResult = {
  valid: boolean
  error?: string
  sanitizedArgs?: Record<string, unknown>
}

export type PermissionValidationResult = {
  allowed: boolean
  reason?: string
  policy?: string
}

export function validateToolCallArguments(
  request: ToolCallRequest,
  config: ArgumentValidationConfig,
): ArgumentValidationResult {
  const required = config.requiredParams ?? []
  const missing = required.filter(
    (param) =>
      request.arguments[param] === undefined ||
      request.arguments[param] === null ||
      request.arguments[param] === "",
  )
  if (missing.length > 0) {
    return {
      valid: false,
      error: `missing required parameters: ${missing.join(", ")}`,
    }
  }
  return {
    valid: true,
    sanitizedArgs: { ...request.arguments },
  }
}

export function validateToolCallPermission(
  request: ToolCallRequest,
  config: PermissionValidationConfig,
): PermissionValidationResult {
  // default-deny: missing allowlist means no tools are permitted
  if (config.allowedTools === undefined) {
    return {
      allowed: false,
      reason: "no allowed tool list configured — default deny",
      policy: "default_deny",
    }
  }
  // check if tool is in allowlist
  if (!config.allowedTools.includes(request.toolName)) {
    return {
      allowed: false,
      reason: `tool ${request.toolName} is not in the allowed list`,
      policy: "allowlist",
    }
  }
  // check owner-only tools
  if (config.ownerOnlyTools && config.ownerOnlyTools.includes(request.toolName)) {
    if (config.senderId !== config.ownerId) {
      return {
        allowed: false,
        reason: `tool ${request.toolName} requires owner access`,
        policy: "owner_only",
      }
    }
  }
  return { allowed: true, policy: "allowlist" }
}

export function formatToolResult(result: ToolCallResult): string {
  const parts: string[] = []
  parts.push(`toolCallId: ${result.toolCallId}`)
  parts.push(`status: ${result.status}`)
  if (result.result) {
    parts.push(`result: ${result.result}`)
  }
  if (result.errorCode) {
    parts.push(`errorCode: ${result.errorCode}`)
  }
  if (result.errorMessage) {
    parts.push(`errorMessage: ${result.errorMessage}`)
  }
  return parts.join("\n")
}