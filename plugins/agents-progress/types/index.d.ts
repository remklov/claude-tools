export type Phase = 'spec' | 'classify' | 'confirm' | 'implement' | 'review' | 'deliver' | 'done' | 'escalated' | 'aborted'

/** One task of the dev workflow's state.json, as written by cw. */
export type TaskState = {
  id: string
  ticket: string
  title: string
  phase: Phase
  round: number
  maxRounds: number
  complexity: string | null
  areas: string[]
  prUrl: string | null
  agents: Record<string, string | null>
  descriptions: Record<string, string | null>
  steps: { done: number; total: number; note: string }
  parent: string | null
}

/** A ticket claimed by another session or machine. */
export type ForeignClaim = { ticket: string; phase: string; host: string; since: string; isStale: boolean }

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

declare module 'claude-code' {
  interface PluginState {
    'agents-progress': {
      agents: AgentRun[]
      tasks: TaskState[]
      claims: ForeignClaim[]
      source: { commonDir: string; mtimeMs: number; claimsAt: number }
      hasAutoOpened: boolean
      now: number
    }
  }
}
