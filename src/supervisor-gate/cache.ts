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
  ChatProcessingStatus,
} from "./types.js"

// ─── Configuration ───

const DEFAULT_DEBOUNCE_MS = 3000       // 3s — wait for rapid-fire messages
const SUPPLEMENT_WINDOW_MS = 10_000    // 10s — collect supplement info after interrupt
const FOLLOW_UP_DELAY_MS = 120_000     // 2min — ask user if they have more to add
const FOLLOW_UP_EXTRA_WAIT_MS = 30_000 // 30s — wait after follow-up before dispatching alone

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

  /** Add a message to the per-chat cache. Starts or resets the debounce timer. */
  addMessage(msg: BufferedMessage): PerChatCache {
    const chatKey = this.resolveChatKey(msg.ctx)
    if (!chatKey) {
      // no chatId or senderId — can't cache, pass through immediately
      this.originalHandler(msg.rawData)
      // return a dummy — caller won't use it
      return this.createDummyCache()
    }

    let cache = this.caches.get(chatKey)
    if (!cache) {
      cache = this.createCache(chatKey)
      this.caches.set(chatKey, cache)
    }

    const entry: MessageEntry = {
      messageId: msg.messageId ?? "",
      text: msg.text,
      rawEventData: msg.rawData,
      gateTime: Date.now(),
      status: "pending",
    }

    cache.messages.push(entry)

    // if we're in supplement collection mode, mark as supplement
    if (cache.processingStatus === "interrupted") {
      entry.status = "supplement"
      // reset supplement timer
      this.clearTimer(cache, "supplementTimer")
      cache.supplementTimer = setTimeout(
        () => this.boundDispatchInterrupt(chatKey),
        SUPPLEMENT_WINDOW_MS,
      )
      // mark supplement message as handled in dedup
      if (msg.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(msg.messageId)
      }
    } else if (cache.processingStatus === "buffering" || cache.processingStatus === "idle") {
      cache.processingStatus = "buffering"
      // reset debounce timer
      this.clearTimer(cache, "dispatchTimer")
      cache.dispatchTimer = setTimeout(
        () => this.boundDispatchPending(chatKey),
        this.debounceMs,
      )
    }

    // trigger async LLM classification (if available and needed)
    this.triggerLLMClassification(entry, chatKey, msg.ctx)

    return cache
  }

  // ─── Interrupt handling ───

  /** Mark a chat as interrupted. Clears debounce timer, starts supplement collection. */
  handleInterrupt(chatKey: string, interruptText: string, interruptMessageId?: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) {
      // no existing cache — create one for the interrupt
      const newCache = this.createCache(chatKey)
      newCache.processingStatus = "interrupted"
      newCache.interruptText = interruptText
      newCache.interruptMessageId = interruptMessageId
      this.caches.set(chatKey, newCache)
      return
    }

    // flush any pending dispatch timer
    this.clearTimer(cache, "dispatchTimer")

    // mark all pending messages as dispatched (they were already sent or will be merged)
    for (const entry of cache.messages) {
      if (entry.status === "pending" || entry.status === "classified") {
        entry.status = "dispatched"
      }
    }
    cache.lastDispatchedIndex = cache.messages.length

    // set interrupt state
    cache.processingStatus = "interrupted"
    cache.interruptText = interruptText
    cache.interruptMessageId = interruptMessageId

    // start supplement collection timer
    this.clearTimer(cache, "supplementTimer")
    cache.supplementTimer = setTimeout(
      () => this.boundDispatchInterrupt(chatKey),
      SUPPLEMENT_WINDOW_MS,
    )

    // start follow-up timer (2min)
    this.clearTimer(cache, "followUpTimer")
    cache.followUpTimer = setTimeout(
      () => this.boundSendFollowUp(chatKey),
      FOLLOW_UP_DELAY_MS,
    )
  }

  // ─── Flush operations ───

  /** Flush any pending buffer for a chat immediately (e.g. when a slash command arrives). */
  flushImmediate(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return
    if (cache.processingStatus === "buffering") {
      this.dispatchPending(chatKey)
    }
  }

  /** Flush all pending buffers (for shutdown/reset). */
  flushAll(): void {
    for (const chatKey of this.caches.keys()) {
      this.flushImmediate(chatKey)
    }
  }

  // ─── Dispatch pending messages ───

  /** When debounce timer expires, combine all pending/classified but un-dispatched
   *  messages and send through originalHandler as one combined prompt. */
  private dispatchPending(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return

    // clear timers
    this.clearTimer(cache, "dispatchTimer")

    // gather all un-dispatched messages
    const pendingMessages = cache.messages.filter(
      (e) => e.status !== "dispatched" && e.status !== "supplement",
    )

    if (pendingMessages.length === 0) {
      cache.processingStatus = "idle"
      return
    }

    // mark as dispatched
    for (const entry of pendingMessages) {
      entry.status = "dispatched"
    }
    cache.lastDispatchedIndex = cache.messages.length
    cache.processingStatus = "processing"

    // dispatch
    this.dispatchMessages(pendingMessages, cache)
  }

  // ─── Dispatch interrupt + supplements ───

  /** When supplement window closes, merge interrupt text + supplements
   *  and dispatch through originalHandler as a single combined message. */
  private dispatchInterrupt(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return

    // clear timers
    this.clearTimer(cache, "supplementTimer")
    this.clearTimer(cache, "followUpTimer")

    // gather supplement messages
    const supplements = cache.messages.filter((e) => e.status === "supplement")
    const preInterruptMessages = cache.messages.filter((e) => e.status === "dispatched")

    // build combined text
    const combinedText = this.buildInterruptCombinedText(
      preInterruptMessages,
      cache.interruptText ?? "",
      supplements,
    )

    // use the last supplement's event data if available, otherwise last pre-interrupt
    const lastData = supplements.length > 0
      ? supplements[supplements.length - 1].rawEventData
      : preInterruptMessages.length > 0
        ? preInterruptMessages[preInterruptMessages.length - 1].rawEventData
        : null

    if (!lastData) {
      // no event data at all — can't dispatch, the quick reply already told user we're waiting
      gateLog(`GATE: interrupt resolved but no event data to dispatch for chat=${chatKey}`)
      cache.processingStatus = "idle"
      return
    }

    // mark all messages as dispatched
    for (const entry of cache.messages) {
      entry.status = "dispatched"
    }
    cache.lastDispatchedIndex = cache.messages.length
    cache.processingStatus = "processing"

    // mark all non-last messages as handled in dedup
    const allMessages = [...preInterruptMessages, ...supplements]
    for (const m of allMessages.slice(0, -1)) {
      if (m.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(m.messageId)
      }
    }

    // dispatch combined message
    const modifiedData = this.cloneWithCombinedText(lastData, combinedText)
    gateLog(
      `GATE: interrupt resolved — ${supplements.length} supplements + ${preInterruptMessages.length} pre-interrupt messages merged for chat=${chatKey}`,
    )
    this.originalHandler(modifiedData)
  }

  // ─── 2-minute follow-up ───

  /** Send a follow-up message asking user if they have more to add. */
  private sendFollowUp(chatKey: string): void {
    const cache = this.caches.get(chatKey)
    if (!cache) return

    // clear follow-up timer
    this.clearTimer(cache, "followUpTimer")
    cache.followUpSent = true

    // send follow-up message
    if (this.callbacks.sendQuickReply) {
      // extract account ID from chatKey format
      // chatKey is either a real chatId (oc_xxx) or "p2p:{accountId}:{senderId}"
      const accountId = this.extractAccountIdFromChatKey(chatKey, cache)
      const replyTarget = this.extractReplyTarget(chatKey, cache)
      void this.callbacks.sendQuickReply({
        chatId: replyTarget,
        text: "你还有要补充的吗？如果没有了，我会基于之前的内容回复。",
        accountId,
      })
    }

    // set extra wait timer — 30s after follow-up, then dispatch alone
    this.clearTimer(cache, "supplementTimer")
    cache.supplementTimer = setTimeout(
      () => this.boundDispatchInterrupt(chatKey),
      FOLLOW_UP_EXTRA_WAIT_MS,
    )
  }

  // ─── LLM classification ───

  /** Trigger async LLM classification for a message entry. */
  private triggerLLMClassification(
    entry: MessageEntry,
    chatKey: string,
    ctx: GateContext,
  ): void {
    if (!this.callbacks.classifyWithLLM || !entry.text) return
    // skip LLM classification for messages already in supplement/interrupt mode
    if (entry.status === "supplement") return

    // gather recent messages for context
    const cache = this.caches.get(chatKey)
    const recentTexts = cache
      ? cache.messages
          .filter((e) => e.text && e.status !== "supplement")
          .slice(-5) // last 5 messages for context
          .map((e) => e.text ?? "")
      : []

    void this.callbacks.classifyWithLLM({
      text: entry.text,
      accountId: ctx.accountId,
      recentMessages: recentTexts,
    }).then((result) => {
      if (!result) return // LLM failed/timeout — keep pending, rule layer result prevails

      entry.classification = result
      if (entry.status === "pending") {
        entry.status = "classified"
      }

      // LLM detected interrupt — trigger interrupt flow
      if (result.intent === "interrupt" && result.confidence >= 0.6) {
        const cache = this.caches.get(chatKey)
        if (cache && cache.processingStatus !== "interrupted") {
          gateLog(
            `GATE: LLM classified as interrupt — text="${entry.text?.substring(0, 30)}" confidence=${result.confidence}`,
          )
          this.handleInterrupt(chatKey, entry.text ?? "", entry.messageId)
          // abort running session if any
          this.steerSessionForChat(chatKey, ctx)
          // send quick reply
          this.sendQuickReplyForChat(chatKey, ctx)
        }
      }

      // LLM detected supplement/continuation — merge into existing interrupt or extend debounce
      if (result.intent === "supplement" || result.intent === "continuation") {
        const cache = this.caches.get(chatKey)
        if (cache) {
          if (cache.processingStatus === "interrupted") {
            // treat as supplement to existing interrupt
            entry.status = "supplement"
            // reset supplement timer
            this.clearTimer(cache, "supplementTimer")
            cache.supplementTimer = setTimeout(
              () => this.boundDispatchInterrupt(chatKey),
              SUPPLEMENT_WINDOW_MS,
            )
          } else if (cache.processingStatus === "buffering") {
            // continuation — reset debounce timer, wait for more
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

    // pre-interrupt messages
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

    // interrupt context
    parts.push(`然后用户说"${interruptText}"想打断并补充信息。`)

    // supplement messages
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
      // single message — just pass through
      this.originalHandler(messages[0].rawEventData)
      return
    }

    // multiple messages — combine into one prompt
    const combinedText = this.buildPendingCombinedText(messages)
    const lastMsg = messages[messages.length - 1]
    const modifiedData = this.cloneWithCombinedText(lastMsg.rawEventData, combinedText)

    // mark all non-last messages as handled in dedup
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

  // ─── Re-dispatch all messages (for mid-turn new message handling) ───

  /** Re-dispatch all messages in cache (including previously dispatched ones)
   *  after aborting a running session. Used when new messages arrive during
   *  active agent processing. */
  redispatchAll(chatKey: string, ctx: GateContext): void {
    const cache = this.caches.get(chatKey)
    if (!cache || cache.messages.length === 0) return

    // abort running session
    this.steerSessionForChat(chatKey, ctx)

    // gather all messages (including previously dispatched ones)
    const allMessages = cache.messages

    const texts = allMessages
      .map((e) => e.text ?? "(non-text message)")
      .filter((t) => t.length > 0)

    if (texts.length === 0) {
      this.originalHandler(allMessages[allMessages.length - 1].rawEventData)
      return
    }

    // build full combined text
    const combinedText = texts.length === 1
      ? texts[0]
      : `用户连续发送了 ${texts.length} 条消息：\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n请综合理解以上所有内容并给出一条统一回复。`

    const lastMsg = allMessages[allMessages.length - 1]
    const modifiedData = this.cloneWithCombinedText(lastMsg.rawEventData, combinedText)

    // mark all non-last messages as handled
    for (const m of allMessages.slice(0, -1)) {
      if (m.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(m.messageId)
      }
    }

    // update cache state
    for (const entry of cache.messages) {
      entry.status = "dispatched"
    }
    cache.lastDispatchedIndex = cache.messages.length
    cache.processingStatus = "processing"

    // clear all timers
    this.clearTimer(cache, "dispatchTimer")
    this.clearTimer(cache, "supplementTimer")
    this.clearTimer(cache, "followUpTimer")

    gateLog(
      `GATE: REDISPATCH — re-combined ${allMessages.length} messages (including previously dispatched) for chat=${chatKey}`,
    )

    this.originalHandler(modifiedData)
  }

  // ─── Helpers ───

  private createCache(chatKey: string): PerChatCache {
    return {
      chatKey,
      messages: [],
      processingStatus: "idle",
      dispatchTimer: null,
      supplementTimer: null,
      followUpTimer: null,
      followUpSent: false,
      lastDispatchedIndex: 0,
    }
  }

  private createDummyCache(): PerChatCache {
    return {
      chatKey: "__passthrough__",
      messages: [],
      processingStatus: "idle",
      dispatchTimer: null,
      supplementTimer: null,
      followUpTimer: null,
      followUpSent: false,
      lastDispatchedIndex: 0,
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
    // build session key from chatKey
    const chatType = ctx.chatType ?? (ctx.chatId ? "group" : "p2p")
    // extract session suffix from chatKey
    let sessionSuffix: string
    if (chatKey.startsWith("p2p:")) {
      // p2p:{accountId}:{senderId} → use senderId as suffix
      const parts = chatKey.split(":")
      sessionSuffix = parts[2] ?? ctx.senderId ?? chatKey
    } else {
      sessionSuffix = chatKey
    }
    const sessionKey = `agent:main:feishu:${chatType}:${sessionSuffix}`
    gateLog(`GATE: steering session ${sessionKey}`)
    void this.callbacks.steerSession({ sessionKey, accountId: ctx.accountId })
  }

  private sendQuickReplyForChat(chatKey: string, ctx: GateContext): void {
    if (!this.callbacks.sendQuickReply) return
    const accountId = ctx.accountId
    // for P2P, reply target is senderId (open_id); for group, it's chatId (chat_id)
    const replyTarget = ctx.chatId ?? ctx.senderId ?? chatKey
    void this.callbacks.sendQuickReply({
      chatId: replyTarget,
      text: "好，请补充你的信息，我在等你。",
      accountId,
    })
  }

  private extractAccountIdFromChatKey(chatKey: string, cache: PerChatCache): string {
    if (chatKey.startsWith("p2p:")) {
      const parts = chatKey.split(":")
      return parts[1] ?? ""
    }
    // for group chats, try to find accountId from messages
    // fallback: look for any message with accountId in rawEventData
    return ""
  }

  private extractReplyTarget(chatKey: string, cache: PerChatCache): string {
    if (chatKey.startsWith("p2p:")) {
      // p2p:{accountId}:{senderId} → senderId is the reply target (open_id)
      const parts = chatKey.split(":")
      return parts[2] ?? chatKey
    }
    // group chat → chatKey is the chat_id
    return chatKey
  }

  /** Get cache for a chat key (for external inspection). */
  getCache(chatKey: string): PerChatCache | undefined {
    return this.caches.get(chatKey)
  }

  /** Get or create cache for a chat key. */
  getOrCreateCache(chatKey: string): PerChatCache {
    let cache = this.caches.get(chatKey)
    if (!cache) {
      cache = this.createCache(chatKey)
      this.caches.set(chatKey, cache)
    }
    return cache
  }

  /** Get buffer stats for debugging. */
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

// ─── Gate Logger (shared with gate.ts) ───

let gateLog: (...args: unknown[]) => void = (...args) => {
  console.log("[supervisor-gate]", ...args)
}

export function setCacheLogger(logFn: (...args: unknown[]) => void): void {
  gateLog = logFn
}