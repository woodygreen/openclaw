// MessageIdCache — per-chat message caching with interrupt/supplement tracking
// Replaces both GateMessageBuffer and InterruptState with a unified cache.
// All messages enter the cache first; dispatch only happens when the debounce
// timer expires and no interrupt/supplement collection is active.

import type {
  BufferedMessage,
  GateCallbacks,
  GateContext,
  MessageClassification,
  MessageEntry,
  PerChatCache,
} from "./types.js"

// ─── Configuration ───

const DEFAULT_DEBOUNCE_MS = 3000       // 3s — wait for rapid-fire messages
const SUPPLEMENT_WINDOW_MS = 10_000    // 10s — collect supplement info after interrupt
const FOLLOW_UP_DELAY_MS = 120_000     // 2min — ask user if they have more to add
const FOLLOW_UP_EXTRA_WAIT_MS = 30_000 // 30s — wait after follow-up before dispatching alone
const MAX_DISPATCHED_MESSAGES = 50     // cap on dispatched messages kept in cache for redispatch
const LLM_CLASSIFY_COOLDOWN_MS = 2000  // 2s cooldown between LLM classification calls per chat

// ─── Gate Logger ───
// Shared logger — gate.ts calls setCacheLogger to synchronize

let _gateLog: (...args: unknown[]) => void = (...args) => {
  console.log("[supervisor-gate]", ...args)
}

/** Shared gate logger — always delegates to the current log function */
export function gateLog(...args: unknown[]): void {
  _gateLog(...args)
}

export function setCacheLogger(logFn: (...args: unknown[]) => void): void {
  _gateLog = logFn
}

// ─── Shared session key builder ───

export function buildSessionKey(ctx: GateContext, chatKey: string): string {
  // map feishu chat_type to OpenClaw session key convention:
  // feishu "p2p" → OpenClaw "direct" with senderId suffix
  // feishu "group"/"topic_group" → OpenClaw "group" with chatId suffix
  const chatType = ctx.chatType ?? (ctx.chatId ? "group" : "p2p")
  let sessionSuffix: string
  let sessionKind: string
  if (chatType === "p2p") {
    sessionKind = "direct"
    sessionSuffix = ctx.senderId ?? chatKey
  } else {
    sessionKind = "group"
    sessionSuffix = chatKey
  }
  return `agent:main:feishu:${sessionKind}:${sessionSuffix}`
}

// ─── Cache Manager ───

export class MessageIdCache {
  private caches = new Map<string, PerChatCache>()
  private callbacks: GateCallbacks
  private originalHandler: (data: unknown) => Promise<void>
  private debounceMs: number = DEFAULT_DEBOUNCE_MS

  // bound dispatch functions (so setTimeout callbacks work correctly)
  private boundDispatchPending: (chatKey: string) => void
  private boundDispatchInterrupt: (chatKey: string) => void
  private boundSendFollowUp: (chatKey: string) => void

  // LLM classification cooldown tracking
  private llmCooldowns = new Map<string, number>()

  constructor(
    originalHandler: (data: unknown) => Promise<void>,
    callbacks: GateCallbacks,
    debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {
    this.originalHandler = originalHandler
    this.callbacks = callbacks
    this.debounceMs = debounceMs
    this.boundDispatchPending = this.dispatchPending.bind(this)
    this.boundDispatchInterrupt = this.dispatchInterrupt.bind(this)
    this.boundSendFollowUp = this.sendFollowUp.bind(this)
  }

  // ─── Core: add a message to cache ───

  addMessage(msg: BufferedMessage): PerChatCache | undefined {
    const chatKey = this.resolveChatKey(msg.ctx)
    if (!chatKey) {
      this.originalHandler(msg.rawData)
      return undefined
    }

    let cache = this.caches.get(chatKey)
    if (!cache) {
      cache = this.createCache(chatKey, msg.ctx)
      this.caches.set(chatKey, cache)
    }

    const entry: MessageEntry = {
      messageId: msg.messageId ?? "",
      text: msg.text,
      rawEventData: msg.rawEventData,
      gateTime: Date.now(),
      status: "pending",
    }

    cache.messages.push(entry)

    if (cache.processingStatus === "interrupted") {
      entry.status = "supplement"
      this.clearTimer(cache, "supplementTimer")
      cache.supplementTimer = setTimeout(
        () => this.boundDispatchInterrupt(chatKey),
        SUPPLEMENT_WINDOW_MS,
      )
      if (msg.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(msg.messageId)
      }
    } else if (cache.processingStatus === "buffering" || cache.processingStatus === "idle") {
      cache.processingStatus = "buffering"
      this.clearTimer(cache, "dispatchTimer")
      cache.dispatchTimer = setTimeout(
        () => this.boundDispatchPending(chatKey),
        this.debounceMs,
      )
    }

    this.triggerLLMClassification(entry, chatKey, msg.ctx)

    return cache
  }

  // ─── Interrupt handling ───

  handleInterrupt(chatKey: string, interruptText: string, interruptMessageId?: string, interruptRawData?: unknown): void {
    let cache = this.caches.get(chatKey)
    if (!cache) {
      cache = this.createCache(chatKey)
      cache.processingStatus = "interrupted"
      cache.interruptText = interruptText
      cache.interruptMessageId = interruptMessageId
      // P0 fix: store interrupt message as a dispatched entry so dispatchInterrupt has rawEventData
      if (interruptRawData) {
        cache.messages.push({
          messageId: interruptMessageId ?? "",
          text: interruptText,
          rawEventData: interruptRawData,
          gateTime: Date.now(),
          status: "dispatched",
        })
      }
      this.caches.set(chatKey, cache)
      return
    }

    this.clearTimer(cache, "dispatchTimer")

    for (const entry of cache.messages) {
      if (entry.status === "pending" || entry.status === "classified") {
        entry.status = "dispatched"
      }
    }
    cache.lastDispatchedIndex = cache.messages.length

    cache.processingStatus = "interrupted"
    cache.interruptText = interruptText
    cache.interruptMessageId = interruptMessageId

    // P0 fix: store interrupt message itself in cache
    if (interruptRawData) {
      cache.messages.push({
        messageId: interruptMessageId ?? "",
        text: interruptText,
        rawEventData: interruptRawData,
        gateTime: Date.now(),
        status: "dispatched",
      })
      cache.lastDispatchedIndex = cache.messages.length
    }

    this.clearTimer(cache, "supplementTimer")
    cache.supplementTimer = setTimeout(
      () => this.boundDispatchInterrupt(chatKey),
      SUPPLEMENT_WINDOW_MS,
    )

    this.clearTimer(cache, "followUpTimer")
    cache.followUpTimer = setTimeout(
      () => this.boundSendFollowUp(chatKey),
      FOLLOW_UP_DELAY_MS,
    )
  }

  // ─── Flush operations ───

  flushImmediate(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return
    if (cache.processingStatus === "buffering") {
      this.dispatchPending(chatKey)
    }
  }

  flushAll(): void {
    for (const chatKey of this.caches.keys()) {
      this.flushImmediate(chatKey)
    }
  }

  // ─── Dispatch pending messages ───

  private dispatchPending(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return

    this.clearTimer(cache, "dispatchTimer")

    const pendingMessages = cache.messages.filter(
      (e) => e.status !== "dispatched" && e.status !== "supplement",
    )

    if (pendingMessages.length === 0) {
      cache.processingStatus = "idle"
      return
    }

    for (const entry of pendingMessages) {
      entry.status = "dispatched"
    }
    cache.lastDispatchedIndex = cache.messages.length
    cache.processingStatus = "processing"

    this.trimDispatchedMessages(cache)

    this.dispatchMessages(pendingMessages, cache)
  }

  // ─── Dispatch interrupt + supplements ───

  private dispatchInterrupt(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return

    this.clearTimer(cache, "supplementTimer")
    this.clearTimer(cache, "followUpTimer")

    const supplements = cache.messages.filter((e) => e.status === "supplement")
    const preInterruptMessages = cache.messages.filter((e) => e.status === "dispatched")

    const combinedText = this.buildInterruptCombinedText(
      preInterruptMessages,
      cache.interruptText ?? "",
      supplements,
    )

    // use last supplement's data, then last pre-interrupt, then interrupt message itself
    const lastData = supplements.length > 0
      ? supplements[supplements.length - 1].rawEventData
      : preInterruptMessages.length > 0
        ? preInterruptMessages[preInterruptMessages.length - 1].rawEventData
        : null

    if (!lastData) {
      gateLog(`GATE: interrupt resolved but no event data to dispatch for chat=${chatKey}`)
      cache.processingStatus = "idle"
      return
    }

    for (const entry of cache.messages) {
      entry.status = "dispatched"
    }
    cache.lastDispatchedIndex = cache.messages.length
    cache.processingStatus = "processing"

    const allMessages = [...preInterruptMessages, ...supplements]
    for (const m of allMessages.slice(0, -1)) {
      if (m.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(m.messageId)
      }
    }

    const modifiedData = this.cloneWithCombinedText(lastData, combinedText)
    gateLog(
      `GATE: interrupt resolved — ${supplements.length} supplements + ${preInterruptMessages.length} pre-interrupt messages merged for chat=${chatKey}`,
    )

    this.trimDispatchedMessages(cache)
    this.originalHandler(modifiedData)
  }

  // ─── 2-minute follow-up ───

  private sendFollowUp(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return

    this.clearTimer(cache, "followUpTimer")
    cache.followUpSent = true

    if (this.callbacks.sendQuickReply) {
      void this.callbacks.sendQuickReply({
        chatId: cache.replyTarget,
        text: "你还有要补充的吗？如果没有了，我会基于之前的内容回复。",
        accountId: cache.accountId,
      })
    }

    this.clearTimer(cache, "supplementTimer")
    cache.supplementTimer = setTimeout(
      () => this.boundDispatchInterrupt(chatKey),
      FOLLOW_UP_EXTRA_WAIT_MS,
    )
  }

  // ─── LLM classification ───

  private triggerLLMClassification(
    entry: MessageEntry,
    chatKey: string,
    ctx: GateContext,
  ): void {
    if (!this.callbacks.classifyWithLLM || !entry.text) return
    if (entry.status === "supplement") return

    // P1 fix: rate limit — skip if cooldown hasn't expired
    const lastCallTime = this.llmCooldowns.get(chatKey) ?? 0
    if (Date.now() - lastCallTime < LLM_CLASSIFY_COOLDOWN_MS) return
    this.llmCooldowns.set(chatKey, Date.now())

    const cache = this.caches.get(chatKey)
    const recentTexts = cache
      ? cache.messages
          .filter((e) => e.text && e.status !== "supplement")
          .slice(-5)
          .map((e) => e.text ?? "")
      : []

    void this.callbacks.classifyWithLLM({
      text: entry.text,
      accountId: ctx.accountId,
      recentMessages: recentTexts,
    }).then((result) => {
      if (!result) return

      entry.classification = result
      if (entry.status === "pending") {
        entry.status = "classified"
      }

      if (result.intent === "interrupt" && result.confidence >= 0.6) {
        const cache = this.caches.get(chatKey)
        if (cache && cache.processingStatus !== "interrupted") {
          gateLog(
            `GATE: LLM classified as interrupt — text="${entry.text?.substring(0, 30)}" confidence=${result.confidence}`,
          )
          this.handleInterrupt(chatKey, entry.text ?? "", entry.messageId, entry.rawEventData)
          this.steerSessionForChat(chatKey, ctx)
          this.sendQuickReplyForChat(chatKey, ctx)
        }
      }

      if (result.intent === "supplement" || result.intent === "continuation") {
        const cache = this.caches.get(chatKey)
        if (cache) {
          if (cache.processingStatus === "interrupted") {
            entry.status = "supplement"
            this.clearTimer(cache, "supplementTimer")
            cache.supplementTimer = setTimeout(
              () => this.boundDispatchInterrupt(chatKey),
              SUPPLEMENT_WINDOW_MS,
            )
          } else if (cache.processingStatus === "buffering") {
            gateLog(
              `GATE: LLM classified as continuation — extending debounce for text="${entry.text?.substring(0, 30)}"`,
            )
            this.clearTimer(cache, "dispatchTimer")
            cache.dispatchTimer = setTimeout(
              () => this.boundDispatchPending(chatKey),
              this.debounceMs,
            )
          }
        }
      }
    })
  }

  // ─── Build combined text ───

  private buildInterruptCombinedText(
    preInterruptMessages: MessageEntry[],
    interruptText: string,
    supplements: MessageEntry[],
  ): string {
    const parts: string[] = []

    if (preInterruptMessages.length > 0) {
      const texts = preInterruptMessages
        .map((e) => e.text ?? "(non-text message)")
        .filter((t) => t.length > 0)
      if (texts.length === 1) {
        parts.push(`用户之前发送了：${texts[0]}`)
      } else if (texts.length > 1) {
        parts.push(
          `用户之前连续发送了 ${texts.length} 条消息：\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
        )
      }
    }

    parts.push(`然后用户说"${interruptText}"想打断并补充信息。`)

    if (supplements.length > 0) {
      const supplementTexts = supplements
        .map((e) => e.text ?? "(non-text supplement)")
        .filter((t) => t.length > 0)
      if (supplementTexts.length === 1) {
        parts.push(`以下是用户补充的内容：${supplementTexts[0]}`)
      } else {
        parts.push(
          `以下是用户补充的多条内容：\n${supplementTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
        )
      }
    }

    parts.push("请综合理解以上所有消息，给出一条统一回复。")
    return parts.join("\n")
  }

  private buildPendingCombinedText(messages: MessageEntry[]): string {
    const texts = messages
      .map((e) => e.text ?? "(non-text message)")
      .filter((t) => t.length > 0)

    if (texts.length === 0) return ""
    if (texts.length === 1) return texts[0]

    return `用户连续发送了 ${texts.length} 条消息：\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n请综合理解以上内容并给出一条回复。`
  }

  // ─── Dispatch messages ───

  private dispatchMessages(messages: MessageEntry[], cache: PerChatCache): void {
    if (messages.length === 1) {
      this.originalHandler(messages[0].rawEventData)
      return
    }

    const combinedText = this.buildPendingCombinedText(messages)
    const lastMsg = messages[messages.length - 1]
    const modifiedData = this.cloneWithCombinedText(lastMsg.rawEventData, combinedText)

    for (const m of messages.slice(0, -1)) {
      if (m.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(m.messageId)
      }
    }

    gateLog(
      `GATE: MERGE — combined ${messages.length} messages for chat=${cache.chatKey} → "${combinedText.substring(0, 80)}${combinedText.length > 80 ? "..." : ""}"`,
    )

    this.originalHandler(modifiedData)
  }

  // ─── Re-dispatch all messages ───

  redispatchAll(chatKey: string, ctx: GateContext): void {
    const cache = this.caches.get(chatKey)
    if (!cache || cache.messages.length === 0) return

    this.steerSessionForChat(chatKey, ctx)

    const allMessages = cache.messages
    const texts = allMessages
      .map((e) => e.text ?? "(non-text message)")
      .filter((t) => t.length > 0)

    if (texts.length === 0) {
      this.originalHandler(allMessages[allMessages.length - 1].rawEventData)
      return
    }

    const combinedText = texts.length === 1
      ? texts[0]
      : `用户连续发送了 ${texts.length} 条消息：\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n请综合理解以上所有内容并给出一条统一回复。`

    const lastMsg = allMessages[allMessages.length - 1]
    const modifiedData = this.cloneWithCombinedText(lastMsg.rawEventData, combinedText)

    for (const m of allMessages.slice(0, -1)) {
      if (m.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(m.messageId)
      }
    }

    for (const entry of cache.messages) {
      entry.status = "dispatched"
    }
    cache.lastDispatchedIndex = cache.messages.length
    cache.processingStatus = "processing"

    this.clearTimer(cache, "dispatchTimer")
    this.clearTimer(cache, "supplementTimer")
    this.clearTimer(cache, "followUpTimer")

    gateLog(
      `GATE: REDISPATCH — re-combined ${allMessages.length} messages for chat=${chatKey}`,
    )

    this.trimDispatchedMessages(cache)
    this.originalHandler(modifiedData)
  }

  // ─── Helpers ───

  private createCache(chatKey: string, ctx?: GateContext): PerChatCache {
    return {
      chatKey,
      messages: [],
      processingStatus: "idle",
      dispatchTimer: null,
      supplementTimer: null,
      followUpTimer: null,
      followUpSent: false,
      lastDispatchedIndex: 0,
      accountId: ctx?.accountId ?? "",
      replyTarget: ctx ? (ctx.chatId ?? ctx.senderId ?? chatKey) : chatKey,
    }
  }

  private resolveChatKey(ctx: GateContext): string | undefined {
    return ctx.chatId ?? (ctx.senderId ? `p2p:${ctx.accountId}:${ctx.senderId}` : undefined)
  }

  private clearTimer(cache: PerChatCache, timerField: "dispatchTimer" | "supplementTimer" | "followUpTimer"): void {
    const timer = cache[timerField]
    if (timer) {
      clearTimeout(timer)
      cache[timerField] = null
    }
  }

  private cloneWithCombinedText(rawData: unknown, combinedText: string): unknown {
    if (typeof rawData !== "object" || rawData === null) return rawData
    const cloned = structuredClone(rawData) as Record<string, unknown>
    const message = cloned.message as Record<string, unknown> | undefined
    if (message) {
      message.content = JSON.stringify({ text: combinedText })
    }
    return cloned
  }

  private steerSessionForChat(chatKey: string, ctx: GateContext): void {
    if (!this.callbacks.steerSession) return
    const sessionKey = buildSessionKey(ctx, chatKey)
    gateLog(`GATE: steering session ${sessionKey}`)
    void this.callbacks.steerSession({ sessionKey, accountId: ctx.accountId })
  }

  private sendQuickReplyForChat(chatKey: string, ctx: GateContext): void {
    if (!this.callbacks.sendQuickReply) return
    const replyTarget = ctx.chatId ?? ctx.senderId ?? chatKey
    void this.callbacks.sendQuickReply({
      chatId: replyTarget,
      text: "好，请补充你的信息，我在等你。",
      accountId: ctx.accountId,
    })
  }

  /** Trim dispatched messages to prevent unbounded memory growth.
   *  Only keeps the last MAX_DISPATCHED_MESSAGES dispatched entries
   *  (needed for redispatchAll). */
  private trimDispatchedMessages(cache: PerChatCache): void {
    const dispatched = cache.messages.filter((e) => e.status === "dispatched")
    if (dispatched.length <= MAX_DISPATCHED_MESSAGES) return
    // remove oldest dispatched entries, keeping the last MAX_DISPATCHED_MESSAGES
    const toRemove = dispatched.length - MAX_DISPATCHED_MESSAGES
    let removed = 0
    cache.messages = cache.messages.filter((e) => {
      if (e.status === "dispatched" && removed < toRemove) {
        removed++
        return false
      }
      return true
    })
  }

  getCache(chatKey: string): PerChatCache | undefined {
    return this.caches.get(chatKey)
  }

  getOrCreateCache(chatKey: string, ctx: GateContext): PerChatCache {
    let cache = this.caches.get(chatKey)
    if (!cache) {
      cache = this.createCache(chatKey, ctx)
      this.caches.set(chatKey, cache)
    }
    return cache
  }

  getStats(): { chatCount: number; pendingCount: number } {
    let total = 0
    for (const cache of this.caches.values()) {
      total += cache.messages.filter(
        (e) => e.status !== "dispatched",
      ).length
    }
    return { chatCount: this.caches.size, pendingCount: total }
  }
}