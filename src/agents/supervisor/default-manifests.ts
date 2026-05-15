import type {
  AgentManifest,
  CapabilitySpec,
  BoundarySpec,
  RejectPattern,
  TaskType,
} from "./types.js"

// ─── Agent-Doc: Document Operations ───

const agentDocCapabilities: CapabilitySpec[] = [
  {
    domain: "feishu_doc",
    actions: ["read", "write", "append", "insert", "create", "list_blocks", "update_block", "delete_block", "create_table", "write_table_cells", "upload_image"],
    scopeDescription: "Feishu document read, write, append, insert, create operations",
  },
  {
    domain: "feishu_wiki",
    actions: ["spaces", "nodes", "get", "search", "create"],
    scopeDescription: "Feishu wiki space and node operations",
  },
  {
    domain: "feishu_drive",
    actions: ["list", "info", "create_folder", "move", "delete"],
    scopeDescription: "Feishu drive file and folder operations",
  },
]

const agentDocBoundaries: BoundarySpec[] = [
  {
    domain: "ci",
    reason: "CI operations require agent-ci",
    overrideAllowed: false,
  },
  {
    domain: "feishu_bitable",
    reason: "Bitable operations require agent-data",
    overrideAllowed: false,
  },
]

const agentDocRejectPatterns: RejectPattern[] = [
  {
    pattern: "CI|构建|部署|pipeline",
    reason: "CI operations are handled by agent-ci",
    redirectTo: "agent-ci",
  },
]

const agentDocTaskTypes: TaskType[] = ["create", "update", "query"]

export const AGENT_DOC_MANIFEST: AgentManifest = {
  id: "agent-doc",
  label: "Document Operations",
  description: "Feishu document read, write, append, insert, create, wiki, drive operations",
  capabilities: agentDocCapabilities,
  boundaries: agentDocBoundaries,
  rejectPatterns: agentDocRejectPatterns,
  toolIds: ["feishu_doc", "feishu_doc_legacy", "feishu_wiki", "feishu_drive", "feishu_perm", "read", "write", "edit"],
  priority: 80,
  taskTypes: agentDocTaskTypes,
  keywords: ["文档", "doc", "wiki", "知识库", "drive", "云文档", "写入", "创建文档"],
  summaryManifest: "Feishu doc/wiki/drive operations",
}

// ─── Agent-Data: Data & Query ───

const agentDataCapabilities: CapabilitySpec[] = [
  {
    domain: "feishu_bitable",
    actions: ["get_meta", "list_fields", "list_records", "create_record"],
    scopeDescription: "Feishu bitable table and record operations",
  },
  {
    domain: "feishu_chat",
    actions: ["members", "info", "member_info"],
    scopeDescription: "Feishu chat member and info lookup",
  },
  {
    domain: "web",
    actions: ["search", "fetch"],
    scopeDescription: "Web search and content fetching",
  },
]

const agentDataBoundaries: BoundarySpec[] = [
  {
    domain: "feishu_doc",
    reason: "Doc operations require agent-doc",
    overrideAllowed: false,
  },
  {
    domain: "ci",
    reason: "CI operations require agent-ci",
    overrideAllowed: false,
  },
]

const agentDataRejectPatterns: RejectPattern[] = [
  {
    pattern: "文档|写文档|CI|构建",
    reason: "Outside data/query scope",
  },
]

const agentDataTaskTypes: TaskType[] = ["query"]

export const AGENT_DATA_MANIFEST: AgentManifest = {
  id: "agent-data",
  label: "Data & Query",
  description: "Feishu bitable operations, data search, web search, chat member lookup",
  capabilities: agentDataCapabilities,
  boundaries: agentDataBoundaries,
  rejectPatterns: agentDataRejectPatterns,
  toolIds: ["feishu_bitable", "feishu_chat", "web_search", "web_fetch", "x_search", "memory_search", "memory_get"],
  priority: 70,
  taskTypes: agentDataTaskTypes,
  keywords: ["查询", "搜索", "bitable", "多维表格", "数据", "成员", "搜索网页"],
  summaryManifest: "Bitable, search, web lookup",
}

// ─── Agent-CI: CI/CD Management ───

const agentCiCapabilities: CapabilitySpec[] = [
  {
    domain: "ci",
    actions: ["build", "deploy", "schedule", "monitor"],
    scopeDescription: "CI build and deployment pipeline operations",
  },
  {
    domain: "cron",
    actions: ["create", "list", "delete"],
    scopeDescription: "Cron job scheduling and management",
  },
]

const agentCiBoundaries: BoundarySpec[] = [
  {
    domain: "feishu_doc",
    reason: "Doc operations require agent-doc",
    overrideAllowed: false,
  },
  {
    domain: "feishu_bitable",
    reason: "Data operations require agent-data",
    overrideAllowed: false,
  },
]

const agentCiRejectPatterns: RejectPattern[] = [
  {
    pattern: "文档|查询|搜索网页|写文档",
    reason: "Outside CI scope",
  },
]

const agentCiTaskTypes: TaskType[] = ["create", "update", "query"]

export const AGENT_CI_MANIFEST: AgentManifest = {
  id: "agent-ci",
  label: "CI/CD Management",
  description: "Build tasks, CI pipeline operations, cron scheduling, gateway control",
  capabilities: agentCiCapabilities,
  boundaries: agentCiBoundaries,
  rejectPatterns: agentCiRejectPatterns,
  toolIds: ["exec", "process", "gateway", "cron", "sessions_list", "sessions_spawn"],
  priority: 60,
  taskTypes: agentCiTaskTypes,
  keywords: ["构建", "CI", "CD", "部署", "build", "deploy", "pipeline", "任务", "cron"],
  summaryManifest: "Build, deploy, cron, gateway",
}

// ─── Agent-Chat: General Chat (fallback) ───

const agentChatCapabilities: CapabilitySpec[] = [
  {
    domain: "general",
    actions: ["chat", "explain", "answer", "summarize"],
    scopeDescription: "General conversation, Q&A, explanation",
  },
]

const agentChatBoundaries: BoundarySpec[] = []

const agentChatRejectPatterns: RejectPattern[] = []

const agentChatTaskTypes: TaskType[] = ["chat"]

export const AGENT_CHAT_MANIFEST: AgentManifest = {
  id: "agent-chat",
  label: "General Chat",
  description: "General conversation, Q&A, explanation, simple tasks without specific domain",
  capabilities: agentChatCapabilities,
  boundaries: agentChatBoundaries,
  rejectPatterns: agentChatRejectPatterns,
  toolIds: ["message", "image", "memory_search", "memory_get", "session_status"],
  priority: 10,
  taskTypes: agentChatTaskTypes,
  keywords: ["问答", "解释", "帮助", "通用"],
  summaryManifest: "General Q&A and conversation",
}

// ─── Registry ───

export const DEFAULT_AGENT_MANIFESTS: AgentManifest[] = [
  AGENT_DOC_MANIFEST,
  AGENT_DATA_MANIFEST,
  AGENT_CI_MANIFEST,
  AGENT_CHAT_MANIFEST,
]

export function getDefaultManifestById(id: string): AgentManifest | undefined {
  return DEFAULT_AGENT_MANIFESTS.find(m => m.id === id)
}

export function getDefaultManifestsByTaskType(taskType: TaskType): AgentManifest[] {
  return DEFAULT_AGENT_MANIFESTS
    .filter(m => m.taskTypes.includes(taskType))
    .sort((a, b) => b.priority - a.priority)
}