// SupervisorGate — main gate logic that wraps Feishu event handlers
// This is the additive layer (Route B) that sits above the existing pipeline
import { classifyEvent } from "./classifier.js"
import { GateMessageBuffer } from "./buffer.js"
import type {
  BufferedMessage,
  GateCallbacks,
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

// ─── Relevant Event Types ───
// Only evaluate the Gate for message and recall events.
// Other events (bot added, reaction, card action, etc.) pass through immediately.

const GATE_RELEVANT_EVENT_TYPES = new Set([
  "im.message.receive_v1",
  "im.message.recall_v1",
])

// ─── Per-account message buffers ───
// Each account (Feishu bot instance) gets its own buffer manager.

const accountBuffers = new Map<string, GateMessageBuffer>()

// ─── Per-chat interrupt tracking ───
// When a user sends an interrupt_request ("等下", "不对", etc.), we track
// the pending interrupt state. Subsequent messages in that chat are collected
// as "supplement" info. When the supplement window closes (timer expires),
// the original message + supplement info are merged and dispatched together.

type InterruptState = {
  /** The original interrupt request text (e.g. "等一下") */
  interruptText: string
  /** Messages received after the interrupt (supplement info) */
  supplements: BufferedMessage[]
  /** Timer for the supplement collection window */
  timer: ReturnType<typeof setTimeout> | null
  /** Account ID */
  accountId: string
  /** Chat ID */
  chatId: string
}

const interruptStates = new Map<string, InterruptState>()
const SUPPLEMENT_WINDOW_MS = 10_000  // 10 seconds to collect supplement info

function getOrCreateBuffer(
  accountId: string,
  originalHandler: (data: unknown) => Promise<void>,
  callbacks: GateCallbacks,
): GateMessageBuffer {
  let buf = accountBuffers.get(accountId)
  if (!buf) {
    buf = new GateMessageBuffer(originalHandler, callbacks)
    accountBuffers.set(accountId, buf)
  }
  return buf
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

function extractMessageId(data: unknown): string | undefined {
  const payload = data as Record<string, unknown> | null
  if (!payload || typeof payload !== "object") return undefined
  const message = payload.message as Record<string, unknown> | undefined
  return message?.message_id as string | undefined
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
      result.proceedWithOriginalHandler = true
      gateLog(
        `GATE: direct_execute (slash command) for account=${ctx.accountId} chat=${ctx.chatId}`,
      )
      break

    case "withdraw":
      const withdrawal = parseWithdrawalEvent(ctx)
      if (withdrawal) {
        result.withdrawal = withdrawal
        gateLog(
          `GATE: withdraw intercepted for message=${withdrawal.messageId} chat=${withdrawal.chatId}`,
        )
      } else {
        result.decision = "simple_pass"
        result.proceedWithOriginalHandler = true
        result.reason = "withdrawal event could not be parsed — falling through"
        gateLog(`GATE: withdraw parse failed — falling through to simple_pass`)
      }
      break

    case "interrupt_request":
      // user wants to pause and supplement — handled in wrapHandlerWithGate
      result.proceedWithOriginalHandler = false
      gateLog(
        `GATE: interrupt_request for account=${ctx.accountId} chat=${ctx.chatId} text="${ctx.messageText?.substring(0, 30)}"`,
      )
      break

    case "compound_decompose":
      result.subTasks = classified.subTasks
      gateLog(
        `GATE: compound_decompose — ${classified.subTasks?.length ?? 0} sub-tasks for text="${ctx.messageText?.substring(0, 50)}"`,
      )
      break

    case "simple_pass":
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
 * For each event, the gate evaluates first and decides what to do:
 * - direct_execute: calls directExecuteHandler callback (bypasses queue entirely)
 * - simple_pass: enqueues into per-chat message buffer for merging
 * - withdraw: intercepts and swallows the event
 * - compound_decompose: logs and falls through to simple_pass (Phase 1)
 *
 * Only message/recall events go through the Gate; other events pass through unchanged.
 */
export function wrapHandlerWithGate(
  eventType: string,
  originalHandler: (data: unknown) => Promise<void>,
  accountId: string,
  callbacks?: GateCallbacks,
): (data: unknown) => Promise<void> {
  const resolvedCallbacks: GateCallbacks = callbacks ?? {}

  return async (data: unknown) => {
    // if gate is disabled, just call original handler directly
    if (!gateEnabled) {
      return originalHandler(data)
    }

    // skip Gate evaluation for non-relevant event types
    if (!GATE_RELEVANT_EVENT_TYPES.has(eventType)) {
      return originalHandler(data)
    }

    const ctx = buildGateContext(eventType, data, accountId)
    const result = evaluateGate(ctx)

    // ── direct_execute: slash command bypass ──
    if (result.decision === "direct_execute") {
      // flush any pending buffer for this chat first
      // so queued messages don't sit behind the command
      if (ctx.chatId) {
        const buf = accountBuffers.get(accountId)
        buf?.flushImmediate(ctx.chatId)
      }

      // use directExecuteHandler callback if available
      // otherwise fall through to originalHandler
      if (resolvedCallbacks.directExecuteHandler) {
        gateLog(
          `GATE: direct_execute → callback for account=${ctx.accountId} chat=${ctx.chatId}`,
        )
        return resolvedCallbacks.directExecuteHandler(data)
      }
      // fallback: call originalHandler (includes command-gating)
      return originalHandler(data)
    }

    // ── withdraw: intercept and swallow ──
    if (result.decision === "withdraw" && result.withdrawal) {
      gateLog(
        `GATE: withdrawal intercepted — messageId=${result.withdrawal.messageId} (not entering queue)`,
      )
      return  // event is swallowed
    }

    // ── interrupt_request: pause and collect supplement ──
    if (result.decision === "interrupt_request") {
      const chatId = ctx.chatId
      if (!chatId) {
        // no chatId — can't track interrupt state, fall through to simple_pass
        return originalHandler(data)
      }

      // flush any pending message buffer for this chat
      const buf = accountBuffers.get(accountId)
      buf?.flushImmediate(chatId)

      // clear any existing interrupt state for this chat
      const existing = interruptStates.get(chatId)
      if (existing?.timer) {
        clearTimeout(existing.timer)
      }

      // create new interrupt state
      const state: InterruptState = {
        interruptText: ctx.messageText ?? "",
        supplements: [],
        timer: null,
        accountId,
        chatId,
      }

      // send quick acknowledgment reply
      if (resolvedCallbacks.sendQuickReply) {
        void resolvedCallbacks.sendQuickReply({
          chatId,
          text: "好，请补充你的信息，我在等你。",
          accountId,
        })
      }
      gateLog(`GATE: interrupt_request → awaiting supplement for chat=${chatId}`)

      // set timer: after 10s, if no supplement arrived, dispatch the interrupt alone
      state.timer = setTimeout(() => {
        thisDispatchInterrupt(chatId, originalHandler, resolvedCallbacks)
      }, SUPPLEMENT_WINDOW_MS)

      interruptStates.set(chatId, state)

      // mark the interrupt message as handled so it doesn't enter pipeline later
      const messageId = extractMessageId(data)
      if (messageId && resolvedCallbacks.markMessageHandled) {
        void resolvedCallbacks.markMessageHandled(messageId)
      }
      return  // event is intercepted — not entering pipeline
    }

    // ── check if this chat is in interrupt supplement collection ──
    const interruptState = ctx.chatId ? interruptStates.get(ctx.chatId) : undefined
    if (interruptState) {
      // this message is a SUPPLEMENT to an earlier interrupt_request
      // collect it, reset the timer
      if (interruptState.timer) {
        clearTimeout(interruptState.timer)
      }

      interruptState.supplements.push({
        rawData: data,
        ctx,
        text: ctx.messageText,
        messageId: extractMessageId(data),
      })

      gateLog(
        `GATE: supplement collected for chat=${ctx.chatId} — "${ctx.messageText?.substring(0, 30)}" (${interruptState.supplements.length} supplements so far)`,
      )

      // reset timer for supplement window
      interruptState.timer = setTimeout(() => {
        thisDispatchInterrupt(ctx.chatId!, originalHandler, resolvedCallbacks)
      }, SUPPLEMENT_WINDOW_MS)

      // mark supplement message as handled
      const messageId = extractMessageId(data)
      if (messageId && resolvedCallbacks.markMessageHandled) {
        void resolvedCallbacks.markMessageHandled(messageId)
      }
      return  // supplement is collected — not entering normal pipeline
    }

    // ── simple_pass: enqueue into message buffer ──
    if (result.decision === "simple_pass" || result.decision === "compound_decompose") {
      // compound_decompose falls through to simple_pass in Phase 1
      const buf = getOrCreateBuffer(accountId, originalHandler, resolvedCallbacks)

      const bufferedMsg: BufferedMessage = {
        rawData: data,
        ctx,
        text: ctx.messageText,
        messageId: extractMessageId(data),
      }

      buf.enqueue(bufferedMsg)
      return  // buffer will dispatch via timer
    }

    // safety net: any unhandled decision falls through to original handler
    return originalHandler(data)
  }
}

// ─── Interrupt Dispatch ───

/** When the supplement window closes, merge interrupt text + supplements
 *  and dispatch through originalHandler as a single combined message. */
function thisDispatchInterrupt(
  chatId: string,
  originalHandler: (data: unknown) => Promise<void>,
  callbacks: GateCallbacks,
): void {
  const state = interruptStates.get(chatId)
  if (!state) return

  // clean up
  interruptStates.delete(chatId)
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }

  const supplements = state.supplements
  if (supplements.length === 0) {
    // no supplement arrived — dispatch interrupt alone as a normal message
    // but with a hint that the user wanted to pause
    gateLog(`GATE: interrupt_request resolved without supplement — dispatching as simple_pass for chat=${chatId}`)
    // We can't dispatch the original interrupt event because it was already
    // marked as handled in dedup. Instead, we create a synthetic event
    // that tells the agent what happened.
    const syntheticText = `用户之前说了"${state.interruptText}"想要打断，但没有补充更多信息。请回应用户的打断请求。`
    const lastData = supplements.length > 0 ? supplements[supplements.length - 1].rawData : null
    if (lastData) {
      const modifiedData = cloneWithCombinedText(lastData, syntheticText)
      originalHandler(modifiedData)
    }
    // If we don't have any event data, we can't dispatch — the interrupt
    // message was swallowed. This is OK: the quick reply already told the
    // user we're waiting.
    return
  }

  // Build combined text: interrupt context + supplement messages
  const supplementTexts = supplements
    .map((s) => s.text ?? "(non-text supplement)")
    .filter((t) => t.length > 0)

  const combinedText = supplementTexts.length === 1
    ? `用户之前说了"${state.interruptText}"想打断并补充信息。以下是用户补充的内容：${supplementTexts[0]}`
    : `用户之前说了"${state.interruptText}"想打断并补充信息。以下是用户补充的多条内容：\n${supplementTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n请综合理解打断请求和补充信息，给出回复。`

  // Use the last supplement's event data, modify content
  const lastSupplement = supplements[supplements.length - 1]
  const modifiedData = cloneWithCombinedText(lastSupplement.rawData, combinedText)

  gateLog(
    `GATE: interrupt_request resolved — ${supplements.length} supplements merged for chat=${chatId}`,
  )

  originalHandler(modifiedData)
}

function cloneWithCombinedText(rawData: unknown, combinedText: string): unknown {
  if (typeof rawData !== "object" || rawData === null) {
    return rawData
  }
  const cloned = structuredClone(rawData) as Record<string, unknown>
  const message = cloned.message as Record<string, unknown> | undefined
  if (message) {
    message.content = JSON.stringify({ text: combinedText })
  }
  return cloned
}