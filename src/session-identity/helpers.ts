// convenience helper functions that delegate to store methods
import type { SessionIdentityStore, SessionIdentityBinding } from "./session-identity"

export function bindSessionToUser(
  store: SessionIdentityStore,
  sessionId: string,
  userId: string,
  chatId: string,
  channel: string,
): SessionIdentityBinding {
  return store.bind(sessionId, userId, chatId, channel)
}

export function verifySessionOwnership(
  store: SessionIdentityStore,
  sessionId: string,
  userId: string,
): boolean {
  return store.verify(sessionId, userId)
}