// session identity binding: formalizes user-to-session ownership
// validates that requests match the session's bound identity
import { SessionIdentityError } from "./errors"

export type SessionIdentityBinding = {
  sessionId: string
  userId: string
  chatId: string
  channel: string // "feishu" | "slack" | "discord" | "cli" | "web"
  createdAt: number
}

export type SessionIdentityStoreConfig = {
  strictOneSessionPerChat?: boolean // enforce one session per user per chat
}

export type SessionIdentityStore = {
  bind(
    sessionId: string,
    userId: string,
    chatId: string,
    channel: string,
  ): SessionIdentityBinding
  unbind(sessionId: string): boolean
  verify(sessionId: string, userId: string): boolean
  verifyChannelChat(sessionId: string, channel: string, chatId: string): boolean
  get(sessionId: string): SessionIdentityBinding | null
  findByUser(userId: string): SessionIdentityBinding[]
  findByChat(chatId: string): SessionIdentityBinding[]
}

export function createSessionIdentityStore(
  config?: SessionIdentityStoreConfig,
): SessionIdentityStore {
  const bindings = new Map<string, SessionIdentityBinding>()

  function bind(
    sessionId: string,
    userId: string,
    chatId: string,
    channel: string,
  ): SessionIdentityBinding {
    const existing = bindings.get(sessionId)
    if (existing) {
      // same user rebinding = no-op
      if (existing.userId === userId && existing.chatId === chatId && existing.channel === channel) {
        return existing
      }
      // different user trying to bind an already-bound session
      throw new SessionIdentityError(
        "already_bound",
        `session ${sessionId} is already bound to user ${existing.userId}`,
      )
    }

    // strict mode: one session per user per chat
    if (config?.strictOneSessionPerChat) {
      const userChatBindings = [...bindings.values()].filter(
        (b) => b.userId === userId && b.chatId === chatId && b.channel === channel,
      )
      if (userChatBindings.length > 0) {
        throw new SessionIdentityError(
          "strict_duplicate",
          `user ${userId} already has session ${userChatBindings[0].sessionId} in chat ${chatId}`,
        )
      }
    }

    const binding: SessionIdentityBinding = {
      sessionId,
      userId,
      chatId,
      channel,
      createdAt: Date.now(),
    }
    bindings.set(sessionId, binding)
    return binding
  }

  function unbind(sessionId: string): boolean {
    return bindings.delete(sessionId)
  }

  function verify(sessionId: string, userId: string): boolean {
    const binding = bindings.get(sessionId)
    if (!binding) return false
    return binding.userId === userId
  }

  function verifyChannelChat(
    sessionId: string,
    channel: string,
    chatId: string,
  ): boolean {
    const binding = bindings.get(sessionId)
    if (!binding) return false
    return binding.channel === channel && binding.chatId === chatId
  }

  function get(sessionId: string): SessionIdentityBinding | null {
    return bindings.get(sessionId) ?? null
  }

  function findByUser(userId: string): SessionIdentityBinding[] {
    return [...bindings.values()].filter((b) => b.userId === userId)
  }

  function findByChat(chatId: string): SessionIdentityBinding[] {
    return [...bindings.values()].filter((b) => b.chatId === chatId)
  }

  return { bind, unbind, verify, verifyChannelChat, get, findByUser, findByChat }
}

// convenience aliases matching test import names
export { bindSessionToUser, verifySessionOwnership } from "./helpers"