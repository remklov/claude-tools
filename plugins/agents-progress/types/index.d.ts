export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  /** The agent id the engine answered at spawn, or the spawn's tool_use_id. */
  id: string
  agentId?: string
  /** The Agent call's `name`, which SendMessage can address it by. */
  name?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
}

/** One task of dev-workflow's state file, as the mod keeps it (docs/PLAN.md §8). */
export type TaskState = {
  id: string
  ticket: string
  title: string
  branch: string
  phase: string
  /** null while the task is active; its outcome once it ended. */
  outcome: string | null
  /** The implementer round. */
  round: number
  reviewRound: number
  maxReviewRounds: number
  complexity: string | null
  areas: string[]
  /** The agent ids cw recorded for the task. */
  agents: { implementer: string | null; reviewer: string | null }
  /** The implementer's step marks (`cw step`), when there are any. */
  steps: { done: number; total: number } | null
  prUrl: string | null
}

/** The state file the mod follows: its path (null outside a dev-workflow project) and the mtime it last read. */
export type StateSource = {
  path: string | null
  mtimeMs: number
  /** How often the file was read, for the tests and the debug log. */
  reads: number
}

declare module 'claude-code' {
  interface PluginState {
    'agents-progress': {
      agents: AgentRun[]
      tasks: TaskState[]
      source: StateSource
      hasAutoOpened: boolean
      now: number
    }
  }
}
