import { describe, it, expect, vi } from "vitest"
import {
  createSessionIdentityStore,
  bindSessionToUser,
  verifySessionOwnership,
  type SessionIdentityBinding,
  type SessionIdentityStore,
} from "./session-identity"
import {
  createFeishuChatBinding,
  verifyFeishuChatOwnership,
  type FeishuChatBinding,
} from "./feishu-chat-binding"
import { SessionIdentityError } from "./errors"

describe("SessionIdentityStore", () => {
  it("should bind session to user and chat", () => {
    const store = createSessionIdentityStore()
    const binding = store.bind("session-1", "user-1", "chat-1", "feishu")
    expect(binding.sessionId).toBe("session-1")
    expect(binding.userId).toBe("user-1")
    expect(binding.chatId).toBe("chat-1")
    expect(binding.channel).toBe("feishu")
  })

  it("should reject binding a session that is already bound to a different user", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    expect(() => store.bind("session-1", "user-2", "chat-1", "feishu")).toThrow(
      SessionIdentityError,
    )
  })

  it("should allow rebinding with the same user (no-op)", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    const binding = store.bind("session-1", "user-1", "chat-1", "feishu")
    expect(binding.userId).toBe("user-1")
  })

  it("should verify session ownership matches", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    expect(store.verify("session-1", "user-1")).toBe(true)
  })

  it("should reject session ownership mismatch", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    expect(store.verify("session-1", "user-2")).toBe(false)
  })

  it("should reject verification for unbound session", () => {
    const store = createSessionIdentityStore()
    expect(store.verify("session-unknown", "user-1")).toBe(false)
  })

  it("should verify channel+chatId match", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    expect(store.verifyChannelChat("session-1", "feishu", "chat-1")).toBe(true)
    expect(store.verifyChannelChat("session-1", "feishu", "chat-2")).toBe(false)
    expect(store.verifyChannelChat("session-1", "slack", "chat-1")).toBe(false)
  })

  it("should get binding by session id", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    const binding = store.get("session-1")
    expect(binding).not.toBeNull()
    expect(binding!.userId).toBe("user-1")
  })

  it("should return null for unknown session", () => {
    const store = createSessionIdentityStore()
    expect(store.get("session-unknown")).toBeNull()
  })

  it("should find sessions by user id", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    store.bind("session-2", "user-1", "chat-2", "feishu")
    store.bind("session-3", "user-2", "chat-1", "feishu")
    const user1Sessions = store.findByUser("user-1")
    expect(user1Sessions).toHaveLength(2)
    expect(user1Sessions.map((b) => b.sessionId)).toContain("session-1")
    expect(user1Sessions.map((b) => b.sessionId)).toContain("session-2")
  })

  it("should find sessions by chat id", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    store.bind("session-2", "user-2", "chat-1", "feishu")
    store.bind("session-3", "user-1", "chat-2", "feishu")
    const chat1Sessions = store.findByChat("chat-1")
    expect(chat1Sessions).toHaveLength(2)
  })

  it("should unbind a session", () => {
    const store = createSessionIdentityStore()
    store.bind("session-1", "user-1", "chat-1", "feishu")
    store.unbind("session-1")
    expect(store.get("session-1")).toBeNull()
    expect(store.verify("session-1", "user-1")).toBe(false)
  })

  it("should enforce one session per user per chat in strict mode", () => {
    const store = createSessionIdentityStore({ strictOneSessionPerChat: true })
    store.bind("session-1", "user-1", "chat-1", "feishu")
    // same user, same chat, different session should fail in strict mode
    expect(() => store.bind("session-2", "user-1", "chat-1", "feishu")).toThrow(
      SessionIdentityError,
    )
  })

  it("should allow multiple sessions per chat for different users", () => {
    const store = createSessionIdentityStore({ strictOneSessionPerChat: true })
    store.bind("session-1", "user-1", "chat-1", "feishu")
    // different user, same chat, should be fine
    store.bind("session-2", "user-2", "chat-1", "feishu")
    expect(store.findByChat("chat-1")).toHaveLength(2)
  })
})

describe("Feishu Chat Binding", () => {
  it("should create feishu chat binding with open_id", () => {
    const binding = createFeishuChatBinding({
      sessionId: "s-1",
      chatId: "oc_abc123",
      senderOpenId: "ou_xyz789",
      senderUserId: "uid_456",
      scope: "group_sender",
    })
    expect(binding.sessionId).toBe("s-1")
    expect(binding.chatId).toBe("oc_abc123")
    expect(binding.senderOpenId).toBe("ou_xyz789")
    expect(binding.scope).toBe("group_sender")
  })

  it("should verify feishu chat ownership matches", () => {
    const store = createSessionIdentityStore()
    const feishuBinding = createFeishuChatBinding({
      sessionId: "s-1",
      chatId: "oc_abc123",
      senderOpenId: "ou_xyz789",
      scope: "group_sender",
    })
    // bind to identity store
    store.bind(feishuBinding.sessionId, feishuBinding.senderOpenId, feishuBinding.chatId, "feishu")
    expect(
      verifyFeishuChatOwnership(store, {
        sessionId: "s-1",
        userId: "ou_xyz789",
        chatId: "oc_abc123",
      }),
    ).toBe(true)
  })

  it("should reject feishu chat ownership mismatch", () => {
    const store = createSessionIdentityStore()
    const feishuBinding = createFeishuChatBinding({
      sessionId: "s-1",
      chatId: "oc_abc123",
      senderOpenId: "ou_xyz789",
      scope: "group_sender",
    })
    store.bind(feishuBinding.sessionId, feishuBinding.senderOpenId, feishuBinding.chatId, "feishu")
    expect(
      verifyFeishuChatOwnership(store, {
        sessionId: "s-1",
        userId: "ou_different",
        chatId: "oc_abc123",
      }),
    ).toBe(false)
  })

  it("should reject feishu chat mismatch on chatId", () => {
    const store = createSessionIdentityStore()
    const feishuBinding = createFeishuChatBinding({
      sessionId: "s-1",
      chatId: "oc_abc123",
      senderOpenId: "ou_xyz789",
      scope: "group_sender",
    })
    store.bind(feishuBinding.sessionId, feishuBinding.senderOpenId, feishuBinding.chatId, "feishu")
    expect(
      verifyFeishuChatOwnership(store, {
        sessionId: "s-1",
        userId: "ou_xyz789",
        chatId: "oc_other",
      }),
    ).toBe(false)
  })

  it("should build composite conversation id for group scope", () => {
    const binding = createFeishuChatBinding({
      sessionId: "s-1",
      chatId: "oc_abc123",
      scope: "group",
    })
    expect(binding.conversationId).toBe("oc_abc123")
  })

  it("should build composite conversation id for group_sender scope", () => {
    const binding = createFeishuChatBinding({
      sessionId: "s-1",
      chatId: "oc_abc123",
      senderOpenId: "ou_xyz789",
      scope: "group_sender",
    })
    expect(binding.conversationId).toBe("oc_abc123:sender:ou_xyz789")
  })

  it("should build composite conversation id for group_topic_sender scope", () => {
    const binding = createFeishuChatBinding({
      sessionId: "s-1",
      chatId: "oc_abc123",
      senderOpenId: "ou_xyz789",
      topicId: "topic_001",
      scope: "group_topic_sender",
    })
    expect(binding.conversationId).toBe("oc_abc123:topic:topic_001:sender:ou_xyz789")
  })
})