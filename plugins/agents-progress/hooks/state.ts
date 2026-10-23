// What the mod reads from dev-workflow (docs/PLAN.md §8, §11): the roles of the workflow agents, the
// tasks of the state file cw writes (`<git common dir>/dev-workflow/state.json`) and the band line of a
// task. No engine calls here.
import type { TaskState } from '../types'

export type Tier = 's' | 'm' | 'l' | 'xl'
export type Role = { kind: 'implementer'; tier: Tier } | { kind: 'reviewer' }

const TIERS: readonly Tier[] = ['s', 'm', 'l', 'xl']
// The agents of the dev-workflow plugin: `dev-workflow:implementer-<tier>` and `dev-workflow:reviewer`.
const WORKFLOW_AGENT = /^dev-workflow:(?:implementer-([a-z]+)|(reviewer))$/

export function roleOf(agentType: string): Role | null {
  const match = WORKFLOW_AGENT.exec(agentType)
  if (!match) return null
  if (match[2]) return { kind: 'reviewer' }
  const tier = TIERS.find(candidate => candidate === match[1])
  return tier ? { kind: 'implementer', tier } : null
}

/** Where cw looks for the project config, relative to a directory. */
export const CONFIG = '.claude/dev-workflow/config.json'

/** The directory and every directory above it, nearest first: where the project config may be. */
export function ancestorsOf(dir: string): string[] {
  const out: string[] = []
  let current = dir.replace(/\/+$/, '') || '/'
  for (;;) {
    out.push(current)
    if (current === '/') return out
    current = current.slice(0, current.lastIndexOf('/')) || '/'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const count = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback

function taskOf(raw: unknown): TaskState | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const ticket = text(raw.ticket)
  const title = text(raw.title)
  const phase = text(raw.phase)
  if (!id || !ticket || !title || !phase) return null
  const agents = isRecord(raw.agents) ? raw.agents : {}
  const steps = isRecord(raw.steps) && count(raw.steps.total, 0) > 0 ? { done: count(raw.steps.done, 0), total: count(raw.steps.total, 0) } : null
  return {
    id,
    ticket,
    title,
    branch: text(raw.branch) ?? id,
    phase,
    outcome: text(raw.outcome),
    round: count(raw.round, 0),
    reviewRound: count(raw.reviewRound, 0),
    maxReviewRounds: count(raw.maxReviewRounds, 3),
    complexity: text(raw.complexity),
    areas: Array.isArray(raw.areas) ? raw.areas.filter((area): area is string => typeof area === 'string') : [],
    agents: { implementer: text(agents.implementer), reviewer: text(agents.reviewer) },
    steps,
    prUrl: text(raw.prUrl),
  }
}

/** The tasks of a state file's text; null when it is no valid state (the caller keeps the last good one). */
export function parseState(source: string): TaskState[] | null {
  let data: unknown
  try {
    data = JSON.parse(source)
  } catch {
    return null
  }
  if (!isRecord(data) || !Array.isArray(data.tasks)) return null
  return data.tasks.map(taskOf).filter((task): task is TaskState => task !== null)
}

/** A task that has not ended; cw keeps ended ones in the state file for ten minutes. */
export const isActive = (task: TaskState): boolean => task.outcome === null

/** The task an agent works for, by the agent id cw recorded. */
export const taskOfAgent = (tasks: readonly TaskState[], agentId: string | undefined): TaskState | undefined =>
  agentId ? tasks.find(task => task.agents.implementer === agentId || task.agents.reviewer === agentId) : undefined

// The Desktop app draws only https links as links.
const isHttps = (url: string | null): url is string => url !== null && URL.canParse(url) && new URL(url).protocol === 'https:'

export type BandLine = { key: string; text: string; isFailure: boolean; prUrl: string | null }

/** One band line: ticket · title · phase · `Round n/m` in review · tier · `step n/m` in implement, and the PR/MR link. */
export function bandLine(task: TaskState): BandLine {
  const parts = [task.ticket, task.title, task.phase]
  if (task.phase === 'review' && task.reviewRound > 0) parts.push(`Round ${task.reviewRound}/${task.maxReviewRounds}`)
  if (task.complexity) parts.push(task.complexity.toUpperCase())
  // The implementer's step marks; before the implementer starts they read 0.
  if (task.steps && task.phase === 'implement') parts.push(`step ${task.steps.done}/${task.steps.total}`)
  return { key: task.id, text: parts.join(' · '), isFailure: task.phase === 'escalated', prUrl: isHttps(task.prUrl) ? task.prUrl : null }
}
