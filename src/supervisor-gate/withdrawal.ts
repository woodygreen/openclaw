// WithdrawalInterceptor — handles message recall/withdrawal events
// Recalled messages should NOT enter the message pipeline
import type { GateContext, WithdrawalEvent } from "./types.js"

// ─── Parse Recall Event ───

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseWithdrawalEvent(ctx: GateContext): WithdrawalEvent | null {
  if (!ctx.isRecallEvent) return null

  const data = ctx.rawEventData
  if (!isRecord(data)) return null

  // Lark SDK recall event structure
  const event = data.event as Record<string, unknown> | undefined
  if (!isRecord(event)) return null

  const message = event.message as Record<string, unknown> | undefined
  if (!isRecord(message)) return null

  const messageId = message.message_id as string | undefined
  const chatId = message.chat_id as string | undefined

  const sender = event.sender as Record<string, unknown> | undefined
  const senderIdObj = sender?.sender_id as Record<string, unknown> | undefined
  const senderId = senderIdObj?.open_id as string | undefined

  if (!messageId || !chatId) {
    return null
  }

  return {
    messageId,
    chatId,
    senderId: senderId ?? "",
    accountId: ctx.accountId,
  }
}

// ─── Withdrawal Handler ───

// Active withdrawal tracking — messages that have been recalled
// In-memory only; cleared on gateway restart
const recalledMessages = new Set<string>()

export function markMessageRecalled(messageId: string): void {
  recalledMessages.add(messageId)
}

export function isMessageRecalled(messageId: string): boolean {
  return recalledMessages.has(messageId)
}

export function clearRecalledMessages(): void {
  recalledMessages.clear()
}

// ─── Withdrawal Statistics ───

export function getWithdrawalStats(): {
  totalRecalled: number
  recalledMessageIds: string[]
} {
  return {
    totalRecalled: recalledMessages.size,
    recalledMessageIds: [...recalledMessages],
  }
}