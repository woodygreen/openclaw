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

// ─── Interrupt Request Detection ───
// User says "wait/no/stop/hold on" — wants to pause and supplement info

const INTERRUPT_REQUEST_PATTERNS: RegExp[] = [
  // Chinese patterns
  /等一下/i, /等等/i, /等下/i, /等会/i, /稍等/i, /稍候/i,
  /稍等一下/i, /等一等/i, /等一下下/i,
  /别急/i, /先别/i, /不要急/i, /先别急/i,
  /不对/i, /错了/i, /不是/i, /搞错了/i, /错了错了/i,
  /打断/i, /插一下/i, /暂停/i, /停一下/i,
  /等我有?重要/i, /有重要的事/i, /先处理/i,
  /重新说/i, /再说一遍/i, /我重说/i,
  // English patterns
  /\bwait\b/i, /\bhold on\b/i, /\bhold up\b/i,
  /\bstop\b/i, /\bnot right\b/i, /\bwrong\b/i,
  /\bactually\b/i, /\bno wait\b/i, /\blet me\b/i,
  /\binterrupt/i, /\bpause\b/i,
  /\bhang on\b/i, /\bjust a sec\b/i, /\bone second\b/i,
]

function isInterruptRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return INTERRUPT_REQUEST_PATTERNS.some((p) => p.test(trimmed))
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

  // Priority 2: interrupt request — user wants to pause and supplement
  // E.g. "等一下", "不对", "别急" — pause current processing, ask for supplement
  if (ctx.messageText && isInterruptRequest(ctx.messageText)) {
    return {
      decision: "interrupt_request",
      reason: `interrupt request detected — text="${ctx.messageText.substring(0, 30)}"`,
    }
  }

  // Priority 3: recall/withdrawal event — WITHDRAW
  if (ctx.isRecallEvent || isRecallEvent(ctx.eventType)) {
    return {
      decision: "withdraw",
      reason: "recall/withdrawal event — intercepting",
    }
  }

  // Priority 4: compound intent detection
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

  // Priority 5: single-domain keyword (still simple_pass — existing pipeline handles routing)
  // We classify but don't change routing; the gate just passes through
  // Domain info is logged for observability but doesn't change behavior in Phase 1

  // Priority 6: default — SIMPLE_PASS (backward compatible)
  return {
    decision: "simple_pass",
    reason: "no special classification — passing through existing pipeline",
  }
}