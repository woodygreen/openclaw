// feishu-specific chat binding: maps feishu conversation scopes to identity
// compatible with existing conversation-id.ts composite ID format

export type FeishuChatBinding = {
  sessionId: string
  chatId: string
  senderOpenId?: string
  senderUserId?: string
  topicId?: string
  scope: "group" | "group_sender" | "group_topic" | "group_topic_sender" | "dm"
  conversationId: string // composite conversation ID
}

export type FeishuChatBindingParams = {
  sessionId: string
  chatId: string
  senderOpenId?: string
  senderUserId?: string
  topicId?: string
  scope: FeishuChatBinding["scope"]
}

export function createFeishuChatBinding(params: FeishuChatBindingParams): FeishuChatBinding {
  const conversationId = buildFeishuConversationId({
    chatId: params.chatId,
    scope: params.scope,
    senderOpenId: params.senderOpenId,
    topicId: params.topicId,
  })
  return {
    ...params,
    conversationId,
  }
}

// builds composite conversation ID matching existing format
// group: chatId
// group_sender: chatId:sender:senderOpenId
// group_topic: chatId:topic:topicId
// group_topic_sender: chatId:topic:topicId:sender:senderOpenId
function buildFeishuConversationId(parts: {
  chatId: string
  scope: string
  senderOpenId?: string
  topicId?: string
}): string {
  const { chatId, scope, senderOpenId, topicId } = parts
  if (scope === "group" || scope === "dm") {
    return chatId
  }
  if (scope === "group_sender") {
    return `${chatId}:sender:${senderOpenId ?? "unknown"}`
  }
  if (scope === "group_topic") {
    return `${chatId}:topic:${topicId ?? "unknown"}`
  }
  if (scope === "group_topic_sender") {
    return `${chatId}:topic:${topicId ?? "unknown"}:sender:${senderOpenId ?? "unknown"}`
  }
  return chatId // fallback
}

// verify feishu chat ownership against the session identity store
export function verifyFeishuChatOwnership(
  store: import("./session-identity").SessionIdentityStore,
  params: { sessionId: string; userId: string; chatId: string },
): boolean {
  // must match both userId and chatId
  const userMatch = store.verify(params.sessionId, params.userId)
  const chatMatch = store.verifyChannelChat(params.sessionId, "feishu", params.chatId)
  return userMatch && chatMatch
}