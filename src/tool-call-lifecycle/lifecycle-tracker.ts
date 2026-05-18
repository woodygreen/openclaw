// tool call lifecycle phases
export enum ToolCallPhase {
  ContextLoad = "context_load",
  ModelDecision = "model_decision",
  PermissionCheck = "permission_check",
  ArgumentValidation = "argument_validation",
  Execution = "execution",
  ResultReturn = "result_return",
  FinalAnswer = "final_answer",
}

export type ToolCallLifecycleEvent = {
  runId: string
  sessionId: string
  phase: ToolCallPhase
  timestamp: number
  data: Record<string, unknown>
}

export type ToolCallLifecycleTrace = {
  runId: string
  events: ToolCallLifecycleEvent[]
  isTerminal(): boolean
}

const COMPLETE_PHASES: ToolCallPhase[] = [
  ToolCallPhase.ContextLoad,
  ToolCallPhase.ModelDecision,
  ToolCallPhase.PermissionCheck,
  ToolCallPhase.ArgumentValidation,
  ToolCallPhase.Execution,
  ToolCallPhase.ResultReturn,
  ToolCallPhase.FinalAnswer,
]

const MAX_TRACE_ENTRIES = 10_000

export function createToolCallLifecycleTracker() {
  const traces = new Map<string, ToolCallLifecycleEvent[]>()

  function record(event: ToolCallLifecycleEvent): void {
    // evict oldest entries when trace map exceeds max size
    if (traces.size >= MAX_TRACE_ENTRIES) {
      const oldest_key = traces.keys().next().value
      if (oldest_key !== undefined) traces.delete(oldest_key)
    }
    if (!traces.has(event.runId)) {
      traces.set(event.runId, [])
    }
    traces.get(event.runId)!.push(event)
  }

  function getTrace(runId: string): ToolCallLifecycleTrace | null {
    const events = traces.get(runId)
    if (!events) return null
    return {
      runId,
      events: [...events],
      isTerminal(): boolean {
        const phases = events.map((e) => e.phase)
        // must have context load + model decision at minimum
        if (!phases.includes(ToolCallPhase.ContextLoad)) return false
        if (!phases.includes(ToolCallPhase.ModelDecision)) return false
        // if permission denied or arg validation failed, lifecycle terminated early
        // (still "terminal" — all phases that should occur did occur)
        const permCheck = events.find((e) => e.phase === ToolCallPhase.PermissionCheck)
        if (permCheck && permCheck.data.allowed === false) return true
        const argCheck = events.find((e) => e.phase === ToolCallPhase.ArgumentValidation)
        if (argCheck && argCheck.data.valid === false) return true
        // full lifecycle must reach final_answer
        return phases.includes(ToolCallPhase.FinalAnswer)
      },
    }
  }

  function listRuns(): string[] {
    return [...traces.keys()]
  }

  return { record, getTrace, listRuns }
}