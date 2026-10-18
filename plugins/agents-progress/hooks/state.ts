// Reads the dev workflow's task index (<git-common-dir>/dev-workflow/state.json, written by cw)
// and the claims other sessions hold. Pure functions; the mod calls them with file contents.

import type { ForeignClaim, Phase, TaskState } from '../types'

export type { ForeignClaim, TaskState }

const PHASES: readonly Phase[] = ['spec', 'classify', 'confirm', 'implement', 'review', 'deliver', 'done', 'escalated', 'aborted']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
const stringMap = (value: unknown): Record<string, string | null> => {
  if (!isRecord(value)) return {}
  const out: Record<string, string | null> = {}
  for (const [key, item] of Object.entries(value)) out[key] = typeof item === 'string' ? item : null
  return out
}

// Returns null when the content is not a valid state file, so the caller keeps its last good state.
export function parseState(content: string): TaskState[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.tasks)) return null
  const tasks: TaskState[] = []
  for (const item of raw.tasks) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    const phase = PHASES.find(candidate => candidate === item.phase)
    if (!phase) continue
    const steps = isRecord(item.steps) ? item.steps : {}
    tasks.push({
      id: item.id,
      ticket: text(item.ticket, item.id),
      title: text(item.title),
      phase,
      round: num(item.round),
      maxRounds: num(item.maxRounds, 3),
      complexity: typeof item.complexity === 'string' ? item.complexity : null,
      areas: strings(item.areas),
      prUrl: typeof item.prUrl === 'string' && item.prUrl.startsWith('https://') ? item.prUrl : null,
      agents: stringMap(item.agents),
      descriptions: stringMap(item.descriptions),
      steps: { done: num(steps.done), total: num(steps.total, 9), note: text(steps.note) },
      parent: typeof item.parent === 'string' ? item.parent : null,
    })
  }
  return tasks
}

export const isActive = (task: TaskState): boolean => task.phase !== 'done' && task.phase !== 'aborted'
export const isPlanned = (task: TaskState): boolean => task.phase === 'spec' || task.phase === 'classify' || task.phase === 'confirm'

// The task a subagent run belongs to: by recorded agent id, else by the exact description cw printed.
export function taskOfRun(tasks: readonly TaskState[], run: { agentId?: string; description: string }): { task: TaskState; role: string } | null {
  for (const task of tasks) {
    for (const [role, id] of Object.entries(task.agents)) if (id && run.agentId && id === run.agentId) return { task, role }
  }
  for (const task of tasks) {
    for (const [role, description] of Object.entries(task.descriptions)) if (description && description === run.description) return { task, role }
  }
  return null
}

// Parses `for-each-ref` lines ("<sha> <ref>") plus `cat-file` payloads into claims of other sessions.
export function foreignClaims(payloads: readonly string[], ownTickets: ReadonlySet<string>, now: number, staleHours = 24): ForeignClaim[] {
  const claims: ForeignClaim[] = []
  for (const payload of payloads) {
    let raw: unknown
    try {
      raw = JSON.parse(payload)
    } catch {
      continue
    }
    if (!isRecord(raw) || typeof raw.ticket !== 'string' || ownTickets.has(raw.ticket)) continue
    const holder = isRecord(raw.holder) ? raw.holder : {}
    const since = text(raw.since)
    const updated = Date.parse(text(raw.updatedAt, since)) || now
    claims.push({ ticket: raw.ticket, phase: text(raw.phase, '?'), host: text(holder.host, '?'), since, isStale: now - updated > staleHours * 3_600_000 })
  }
  return claims.sort((a, b) => a.ticket.localeCompare(b.ticket))
}

export function age(since: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - (Date.parse(since) || now)) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}
