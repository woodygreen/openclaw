// GateMessageBuffer — per-chat message buffering and merging
// When messages arrive quickly for the same chat, they are buffered
// within a debounce window and then combined into a single prompt.
// This prevents each message triggering a separate agent turn.
import type { BufferedMessage, GateCallbacks } from "./types.js"

// ─── Buffer Configuration ───

const DEFAULT_DEBOUNCE_MS = 3000  // 3 seconds — enough to catch rapid-fire messages

// ─── Per-Chat Buffer ───

type ChatBuffer = {
  messages: BufferedMessage[]
  timer: ReturnType<typeof setTimeout> | null
}

// ─── Message Buffer Manager ───

export class GateMessageBuffer {
  private buffers = new Map<string, ChatBuffer>()
  private debounceMs: number
  private callbacks: GateCallbacks
  private originalHandler: (data: unknown) => Promise<void>

  constructor(
    originalHandler: (data: unknown) => Promise<void>,
    callbacks: GateCallbacks,
    debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {
    this.originalHandler = originalHandler
    this.callbacks = callbacks
    this.debounceMs = debounceMs
  }

  /** Add a message to the per-chat buffer. Starts or resets the debounce timer. */
  enqueue(msg: BufferedMessage): void {
    const chatId = msg.ctx.chatId
    if (!chatId) {
      // no chatId — can't buffer, pass through immediately
      this.originalHandler(msg.rawData)
      return
    }

    let buf = this.buffers.get(chatId)
    if (!buf) {
      buf = { messages: [], timer: null }
      this.buffers.set(chatId, buf)
    }

    buf.messages.push(msg)

    // reset debounce timer
    if (buf.timer) {
      clearTimeout(buf.timer)
    }
    buf.timer = setTimeout(() => {
      this.flushForChat(chatId)
    }, this.debounceMs)
  }

  /** Flush buffer for a specific chat — combine messages and dispatch. */
  private flushForChat(chatId: string): void {
    const buf = this.buffers.get(chatId)
    if (!buf) return

    // remove from map
    this.buffers.delete(chatId)
    if (buf.timer) {
      clearTimeout(buf.timer)
      buf.timer = null
    }

    const messages = buf.messages
    if (messages.length === 0) return

    if (messages.length === 1) {
      // single message — just pass through
      this.originalHandler(messages[0].rawData)
      return
    }

    // multiple messages — combine into one prompt
    this.dispatchMergedMessages(messages)
  }

  /** Flush any pending buffer for a chat immediately (e.g. when a slash command arrives). */
  flushImmediate(chatId: string): void {
    const buf = this.buffers.get(chatId)
    if (!buf) return
    this.flushForChat(chatId)
  }

  /** Flush all pending buffers (for shutdown/reset). */
  flushAll(): void {
    for (const chatId of this.buffers.keys()) {
      this.flushForChat(chatId)
    }
  }

  /** Combine multiple buffered messages into one and dispatch through originalHandler.
   *  The last message's event data is modified to include combined text.
   *  All other message IDs are marked as "handled" in dedup so the pipeline skips them. */
  private dispatchMergedMessages(messages: BufferedMessage[]): void {
    const lastMsg = messages[messages.length - 1]
    const texts = messages
      .map((m, i) => m.text ?? `(message ${i + 1}: non-text)`)
      .filter((t) => t.length > 0)

    if (texts.length === 0) {
      // all non-text — just pass through last one
      this.originalHandler(lastMsg.rawData)
      return
    }

    // Build combined text
    const combinedText = texts.length === 1
      ? texts[0]
      : `用户连续发送了 ${texts.length} 条消息：\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n请综合理解以上内容并给出一条回复。`

    // Modify the last message's event data to contain combined text
    const modifiedData = this.cloneWithCombinedText(lastMsg.rawData, combinedText)

    // Mark all non-last messages as handled in dedup
    for (const m of messages.slice(0, -1)) {
      if (m.messageId && this.callbacks.markMessageHandled) {
        void this.callbacks.markMessageHandled(m.messageId)
      }
    }

    // Log the merge
    console.log(
      `[supervisor-gate] MERGE: combined ${messages.length} messages for chat=${lastMsg.ctx.chatId} → "${combinedText.substring(0, 80)}${combinedText.length > 80 ? "..." : ""}"`,
    )

    // Dispatch the combined message through original handler
    this.originalHandler(modifiedData)
  }

  /** Clone event data and replace message content with combined text. */
  private cloneWithCombinedText(rawData: unknown, combinedText: string): unknown {
    if (typeof rawData !== "object" || rawData === null) {
      return rawData
    }
    // Deep clone the event data (only the parts we modify)
    const cloned = structuredClone(rawData) as Record<string, unknown>
    const message = cloned.message as Record<string, unknown> | undefined
    if (message) {
      message.content = JSON.stringify({ text: combinedText })
    }
    return cloned
  }

  /** Get buffer stats for debugging. */
  getStats(): { chatCount: number; pendingCount: number } {
    let total = 0
    for (const buf of this.buffers.values()) {
      total += buf.messages.length
    }
    return { chatCount: this.buffers.size, pendingCount: total }
  }
}