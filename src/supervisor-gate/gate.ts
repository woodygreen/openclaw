// SupervisorGate — main gate logic that wraps Feishu event handlers
// This is the additive layer (Route B) that sits above the existing pipeline
import { classifyEvent } from "./classifier.js"
import type {
  GateContext,
  GateEvaluationResult,
  SupervisorGateDecision,
  WithdrawalEvent,
} from "./types.js"
import { parseWithdrawalEvent } from "./withdrawal.js"

// ─── Gate Logger ───

let gateLog: (...args: unknown[]) => void = (...args) => {
  // default: silent. will be replaced with real logger when integrated
  console.log("[supervisor-gate]", ...args)
}

export function setGateLogger(logFn: (...args: unknown[]) => void): void {
  gateLog = logFn
}

// ─── Gate Configuration ───

let gateEnabled = true

export function setGateEnabled(enabled: boolean): void {
  gateEnabled = enabled
}

// ─── Build GateContext from raw event data ───

function buildGateContext(
  eventType: string,
  data: unknown,
  accountId: string,
): GateContext {
  const ctx: GateContext = {
    eventType,
    accountId,
    rawEventData: data,
  }

  // for im.message.receive_v1, extract message text and metadata
  // NOTE: Lark SDK EventDispatcher.parse() flattens the envelope —
  // handler data is { sender, message, event_id, ... } directly,
  // NOT { event: { sender, message } }
  if (eventType === "im.message.receive_v1") {
    const payload = data as Record<string, unknown> | null
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const message = payload.message as Record<string, unknown> | undefined
      if (message) {
        ctx.chatType = message.chat_type as string | undefined
        ctx.chatId = message.chat_id as string | undefined
        ctx.messageText = extractMessageText(message)
        ctx.isSlashCommand = ctx.messageText ? ctx.messageText.trim().startsWith("/") : false

        const sender = payload.sender as Record<string, unknown> | undefined
        if (sender) {
          const senderIdObj = sender.sender_id as Record<string, unknown> | undefined
          ctx.senderId = senderIdObj?.open_id as string | undefined
        }
      }
    }
  }

  // for recall events
  if (eventType === "im.message.recall_v1") {
    ctx.isRecallEvent = true
  }

  return ctx
}

function extractMessageText(message: Record<string, unknown>): string | undefined {
  const messageType = message.message_type as string | undefined
  if (messageType !== "text") return undefined
  const content = message.content as string | undefined
  if (!content) return undefined
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return parsed.text as string | undefined
  } catch {
    return content
  }
}

// ─── Evaluate Gate Decision ───

function evaluateGate(ctx: GateContext): GateEvaluationResult {
  const classified = classifyEvent(ctx)
  const result: GateEvaluationResult = {
    decision: classified.decision,
    reason: classified.reason,
    proceedWithOriginalHandler: false,
  }

  switch (classified.decision) {
    case "direct_execute":
      // slash commands pass through immediately, no gate processing
      result.proceedWithOriginalHandler = true
      gateLog(
        `GATE: direct_execute (slash command) for account=${ctx.accountId} chat=${ctx.chatId}`,
      )
      break

    case "withdraw":
      // recall/withdrawal events are intercepted
      const withdrawal = parseWithdrawalEvent(ctx)
      if (withdrawal) {
        result.withdrawal = withdrawal
        gateLog(
          `GATE: withdraw intercepted for message=${withdrawal.messageId} chat=${withdrawal.chatId}`,
        )
      } else {
        // if we can't parse the withdrawal, fall through to simple_pass
        result.decision = "simple_pass"
        result.proceedWithOriginalHandler = true
        result.reason = "withdrawal event could not be parsed — falling through"
        gateLog(`GATE: withdraw parse failed — falling through to simple_pass`)
      }
      break

    case "compound_decompose":
      // compound intents are decomposed into sub-tasks
      result.subTasks = classified.subTasks
      gateLog(
        `GATE: compound_decompose — ${classified.subTasks?.length ?? 0} sub-tasks for text="${ctx.messageText?.substring(0, 50)}"`,
      )
      // compound_decompose does NOT proceed with original handler
      // it will be dispatched separately by the integration layer
      break

    case "simple_pass":
      // single-domain or unknown — pass through existing pipeline unchanged
      result.proceedWithOriginalHandler = true
      gateLog(
        `GATE: simple_pass for account=${ctx.accountId} chat=${ctx.chatId}`,
      )
      break
  }

  return result
}

// ─── Gate Wrapper Function ───

/**
 * Wraps an original event handler with the Supervisor Gate.
 * For each event, the gate evaluates first and decides what to do.
 * This is the core integration point — called from monitor.account.ts.
 */
export function wrapHandlerWithGate(
  eventType: string,
  originalHandler: (data: unknown) => Promise<void>,
  accountId: string,
): (data: unknown) => Promise<void> {
  return async (data: unknown) => {
    // if gate is disabled, just call original handler directly
    if (!gateEnabled) {
      return originalHandler(data)
    }

    const ctx = buildGateContext(eventType, data, accountId)
    const result = evaluateGate(ctx)

    if (result.proceedWithOriginalHandler) {
      return originalHandler(data)
    }

    if (result.decision === "withdraw" && result.withdrawal) {
      // withdrawal events are handled by the WithdrawalInterceptor
      // they do NOT enter the message pipeline at all
      // TODO: integrate with active run registry to stop/cancel ongoing agent runs
      // TODO: integrate with Feishu API to recall bot replies if possible
      gateLog(
        `GATE: withdrawal intercepted — messageId=${result.withdrawal.messageId} (not entering queue)`,
      )
      return  // event is swallowed — no further processing
    }

    if (result.decision === "compound_decompose" && result.subTasks) {
      // compound intents need to be dispatched to multiple agents
      // In Phase 1, we log the decomposition but still fall through to simple_pass
      // because multi-agent dispatch requires deeper integration with the turn kernel
      // TODO: implement multi-agent dispatch in Phase 2
      gateLog(
        `GATE: compound_decompose detected but multi-agent dispatch not yet implemented — falling through to simple_pass`,
      )
      // fall through to simple_pass for now
      return originalHandler(data)
    }

    // safety net: any unhandled decision falls through to original handler
    return originalHandler(data)
  }
}