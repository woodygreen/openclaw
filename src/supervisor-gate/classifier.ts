// EventClassifier — rule-based intent classification
// Priority: slash command > recall > compound > simple > default
import type {
  ClassifiedIntent,
  GateContext,
  SupervisorGateDecision,
  SubTaskSpec,
} from "./types.js"

// ─── Slash Command Detection ───

function isSlashCommand(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return trimmed.startsWith("/")
}

// ─── Recall Event Detection ───

function isRecallEvent(eventType: string): boolean {
  return eventType === "im.message.recall_v1"
}

// ─── Compound Intent Detection ───

// keyword pairs that indicate compound intent (multi-domain request)
const COMPOUND_KEYWORD_PAIRS: Array<{
  trigger: RegExp
  decomposition: Array<{
    extractPattern: RegExp
    targetAgentId: string
    domain: string
    taskType: "query" | "create" | "update" | "delete" | "chat"
  }>
}> = [
  {
    // "check X then write/create/update Y" patterns
    trigger: /(?:查|查看|检查|确认).*?(?:然后|再|之后|接着).*(?:写|创建|更新|新建|添加|通知)/i,
    decomposition: [
      {
        extractPattern: /(?:查|查看|检查|确认)(.*?)(?:然后|再|之后|接着)/i,
        targetAgentId: "agent-data",
        domain: "feishu_bitable",
        taskType: "query",
      },
      {
        extractPattern: /(?:然后|再|之后|接着).*(?:写|创建|更新|新建|添加|通知)(.*)/i,
        targetAgentId: "agent-doc",
        domain: "feishu_doc",
        taskType: "create",
      },
    ],
  },
  {
    // "run CI and notify group" patterns
    trigger: /(?:跑|执行|触发|运行).*(?:CI|构建|编译|打包).*?(?:然后|再|之后|接着).*(?:通知|发消息|告诉|群里)/i,
    decomposition: [
      {
        extractPattern: /(?:跑|执行|触发|运行).*(?:CI|构建|编译|打包)/i,
        targetAgentId: "agent-ci",
        domain: "ci",
        taskType: "create",
      },
      {
        extractPattern: /(?:通知|发消息|告诉|群里)/i,
        targetAgentId: "agent-chat",
        domain: "feishu_chat",
        taskType: "create",
      },
    ],
  },
]

// ─── Single-Domain Keywords ───

const DOMAIN_KEYWORDS: Record<string, {
  agentId: string
  domain: string
}> = {
  // document domain
  "文档": { agentId: "agent-doc", domain: "feishu_doc" },
  "飞书文档": { agentId: "agent-doc", domain: "feishu_doc" },
  "wiki": { agentId: "agent-doc", domain: "feishu_wiki" },
  "知识库": { agentId: "agent-doc", domain: "feishu_wiki" },

  // data/query domain
  "多维表格": { agentId: "agent-data", domain: "feishu_bitable" },
  "bitable": { agentId: "agent-data", domain: "feishu_bitable" },
  "数据": { agentId: "agent-data", domain: "feishu_bitable" },
  "进度": { agentId: "agent-data", domain: "feishu_bitable" },

  // CI domain
  "CI": { agentId: "agent-ci", domain: "ci" },
  "构建": { agentId: "agent-ci", domain: "ci" },
  "编译": { agentId: "agent-ci", domain: "ci" },
  "打包": { agentId: "agent-ci", domain: "ci" },
}

// ─── Classifier ───

export function classifyEvent(ctx: GateContext): ClassifiedIntent {
  // Priority 1: slash command — DIRECT_EXECUTE, no delay
  if (ctx.isSlashCommand || (ctx.messageText && isSlashCommand(ctx.messageText))) {
    return {
      decision: "direct_execute",
      reason: "slash command detected — bypassing gate",
    }
  }

  // Priority 2: recall/withdrawal event — WITHDRAW
  if (ctx.isRecallEvent || isRecallEvent(ctx.eventType)) {
    return {
      decision: "withdraw",
      reason: "recall/withdrawal event — intercepting",
    }
  }

  // Priority 3: compound intent detection
  if (ctx.messageText) {
    for (const compound of COMPOUND_KEYWORD_PAIRS) {
      if (compound.trigger.test(ctx.messageText)) {
        const subTasks: SubTaskSpec[] = []
        for (const rule of compound.decomposition) {
          const match = rule.extractPattern.exec(ctx.messageText)
          if (match) {
            subTasks.push({
              targetAgentId: rule.targetAgentId,
              taskDescription: match[0],
              domain: rule.domain,
              taskType: rule.taskType,
            })
          }
        }
        if (subTasks.length >= 2) {
          return {
            decision: "compound_decompose",
            reason: `compound intent matched: ${compound.trigger.source}`,
            subTasks,
          }
        }
      }
    }
  }

  // Priority 4: single-domain keyword (still simple_pass — existing pipeline handles routing)
  // We classify but don't change routing; the gate just passes through
  // Domain info is logged for observability but doesn't change behavior in Phase 1

  // Priority 5: default — SIMPLE_PASS (backward compatible)
  return {
    decision: "simple_pass",
    reason: "no special classification — passing through existing pipeline",
  }
}