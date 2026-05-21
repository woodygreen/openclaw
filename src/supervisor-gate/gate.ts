// SupervisorGate — main gate logic that wraps Feishu event handlers
// This is the additive layer (Route B) that sits above the existing pipeline.
// Uses MessageIdCache for unified message tracking, interrupt handling, and
// mid-turn new message re-dispatch.
import { classifyEvent } from "./classifier.js"
import { MessageIdCache } from "./cache.js"
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

const GATE_RELEVANT_EVENT_TYPES = new Set([
  "im.message.receive_v1",
  "im.message.recall_v1",
])

// ─── Per-account message caches ───

const accountCaches = new Map<string, MessageIdCache>()

function getOrCreateCache(
  accountId: string,
  originalHandler: (data: unknown) => Promise<void>,
  callbacks: GateCallbacks,
): MessageIdCache {
  let cache = accountCaches.get(accountId)
  if (!cache) {
    cache = new MessageIdCache(originalHandler, callbacks)
    accountCaches.set(accountId, cache)
  }
  return cache
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
 * Uses MessageIdCache for unified message tracking:
 * - direct_execute: flush cache, call directExecuteHandler
 * - simple_pass / compound_decompose: add to cache, debounce dispatch
 * - interrupt_request: mark as interrupted, collect supplements, merge dispatch
 * - new message during active run: abort session, re-dispatch all messages
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
    if (!gateEnabled) {
      return originalHandler(data)
    }

    if (!GATE_RELEVANT_EVENT_TYPES.has(eventType)) {
      return originalHandler(data)
    }

    const ctx = buildGateContext(eventType, data, accountId)
    const result = evaluateGate(ctx)
    const cache = getOrCreateCache(accountId, originalHandler, resolvedCallbacks)

    // resolve chat key for this event
    const chatKey = ctx.chatId ?? (ctx.senderId ? `p2p:${accountId}:${ctx.senderId}` : undefined)

    // ── direct_execute: slash command bypass ──
    if (result.decision === "direct_execute") {
      if (chatKey) {
        cache.flushImmediate(chatKey)
      }

      if (resolvedCallbacks.directExecuteHandler) {
        gateLog(
          `GATE: direct_execute → callback for account=${ctx.accountId} chat=${ctx.chatId}`,
        )
        return resolvedCallbacks.directExecuteHandler(data)
      }
      return originalHandler(data)
    }

    // ── withdraw: intercept and swallow ──
    if (result.decision === "withdraw" && result.withdrawal) {
      gateLog(
        `GATE: withdrawal intercepted — messageId=${result.withdrawal.messageId} (not entering cache)`,
      )
      return  // event is swallowed
    }

    // ── interrupt_request: pause and collect supplement ──
    if (result.decision === "interrupt_request") {
      if (!chatKey) {
        // no chatKey — can't track interrupt state, fall through to simple_pass
        return originalHandler(data)
      }

      // flush any pending buffer for this chat
      cache.flushImmediate(chatKey)

      // mark as interrupted in cache
      const interruptMessageId = extractMessageId(data)
      cache.handleInterrupt(chatKey, ctx.messageText ?? "", interruptMessageId)

      // abort running session
      const chatType = ctx.chatType ?? (ctx.chatId ? "group" : "p2p")
      let sessionSuffix: string
      if (chatKey.startsWith("p2p:")) {
        const parts = chatKey.split(":")
        sessionSuffix = parts[2] ?? ctx.senderId ?? chatKey
      } else {
        sessionSuffix = chatKey
      }
      const sessionKey = `agent:main:feishu:${chatType}:${sessionSuffix}`
      if (resolvedCallbacks.steerSession) {
        gateLog(`GATE: interrupt_request → steering session ${sessionKey}`)
        void resolvedCallbacks.steerSession({ sessionKey, accountId })
      }

      // send quick acknowledgment reply
      if (resolvedCallbacks.sendQuickReply) {
        const replyTarget = ctx.chatId ?? ctx.senderId ?? chatKey
        void resolvedCallbacks.sendQuickReply({
          chatId: replyTarget,
          text: "好，请补充你的信息，我在等你。",
          accountId,
        })
      }

      // mark interrupt message as handled in dedup
      if (interruptMessageId && resolvedCallbacks.markMessageHandled) {
        void resolvedCallbacks.markMessageHandled(interruptMessageId)
      }

      gateLog(`GATE: interrupt_request → awaiting supplement for key=${chatKey}`)
      return  // event is intercepted — not entering pipeline
    }

    // ── check if this chat is in interrupt supplement collection ──
    if (chatKey) {
      const chatCache = cache.getCache(chatKey)
      if (chatCache && chatCache.processingStatus === "interrupted") {
        // this message is a SUPPLEMENT to an earlier interrupt_request
        // add to cache — cache.addMessage will auto-mark as supplement
        const bufferedMsg: BufferedMessage = {
          rawData: data,
          ctx,
          text: ctx.messageText,
          messageId: extractMessageId(data),
        }
        cache.addMessage(bufferedMsg)
        gateLog(
          `GATE: supplement added to cache for key=${chatKey} — "${ctx.messageText?.substring(0, 30)}"`,
        )
        return  // supplement collected — not entering normal pipeline
      }
    }

    // ── mid-turn new message: check if agent has active run ──
    if (chatKey && resolvedCallbacks.hasActiveRun) {
      const chatType = ctx.chatType ?? (ctx.chatId ? "group" : "p2p")
      let sessionSuffix: string
      if (chatKey.startsWith("p2p:")) {
        const parts = chatKey.split(":")
        sessionSuffix = parts[2] ?? ctx.senderId ?? chatKey
      } else {
        sessionSuffix = chatKey
      }
      const sessionKey = `agent:main:feishu:${chatType}:${sessionSuffix}`

      const hasActive = await resolvedCallbacks.hasActiveRun({ sessionKey, accountId })
      if (hasActive) {
        gateLog(
          `GATE: mid-turn new message detected — aborting session ${sessionKey} and re-dispatching all messages`,
        )

        // add new message to cache first
        const bufferedMsg: BufferedMessage = {
          rawData: data,
          ctx,
          text: ctx.messageText,
          messageId: extractMessageId(data),
        }
        cache.addMessage(bufferedMsg)

        // send quick reply to tell user we're re-processing
        if (resolvedCallbacks.sendQuickReply) {
          const replyTarget = ctx.chatId ?? ctx.senderId ?? chatKey
          void resolvedCallbacks.sendQuickReply({
            chatId: replyTarget,
            text: "收到你的新消息，我重新整理一下回复。",
            accountId,
          })
        }

        // abort session and re-dispatch all messages (including previously dispatched)
        cache.redispatchAll(chatKey, ctx)
        return  // message handled — not entering normal pipeline
      }
    }

    // ── simple_pass / compound_decompose: add to cache, debounce dispatch ──
    if (result.decision === "simple_pass" || result.decision === "compound_decompose") {
      if (!chatKey) {
        // no chatKey — can't cache, pass through immediately
        return originalHandler(data)
      }

      const bufferedMsg: BufferedMessage = {
        rawData: data,
        ctx,
        text: ctx.messageText,
        messageId: extractMessageId(data),
      }

      cache.addMessage(bufferedMsg)
      return  // cache will dispatch via timer
    }

    // safety net: any unhandled decision falls through to original handler
    return originalHandler(data)
  }
}