import { expect, test } from 'claude-code/testing'

import { foreignClaims, isActive, isPlanned, parseState, taskOfRun } from '../hooks/state'

const STATE = JSON.stringify({
  version: 1,
  updatedAt: '2026-10-18T09:40:00Z',
  tasks: [
    {
      id: 'nv-9-cre-totaliva', ticket: 'NV-9', title: 'Fix the CRE totalIva', phase: 'review', round: 2, maxRounds: 3,
      complexity: 'l', areas: ['backend'], prUrl: null,
      agents: { implementer: 'a1', reviewer: 'r1' }, descriptions: { implementer: 'NV-9 · Fix the CRE totalIva', reviewer: 'Review · NV-9 · Fix the CRE totalIva' },
      steps: { done: 9, total: 9, note: 'report done' }, parent: null,
    },
    { id: 'app-2-counts', ticket: 'APP-2', title: 'Pending counts', phase: 'classify', round: 0, complexity: null, areas: [], agents: {}, descriptions: {}, steps: { done: 0, total: 9, note: '' } },
    { id: 'broken', phase: 'nonsense' },
  ],
})

test('a valid state file parses; unknown phases are dropped', () => {
  const tasks = parseState(STATE)
  expect(tasks?.map(task => task.id)).toEqual(['nv-9-cre-totaliva', 'app-2-counts'])
  expect(tasks?.[0]?.round).toBe(2)
  expect(tasks?.[1]?.maxRounds).toBe(3)
})

test('invalid content returns null so the last good state stays', () => {
  expect(parseState('{ not json')).toBe(null)
  expect(parseState(JSON.stringify({ version: 2, tasks: [] }))).toBe(null)
})

test('a PR link is kept only when it is https', () => {
  const tasks = parseState(JSON.stringify({ version: 1, tasks: [{ id: 'x', phase: 'deliver', prUrl: 'javascript:alert(1)' }, { id: 'y', phase: 'deliver', prUrl: 'https://github.com/o/r/pull/1' }] }))
  expect(tasks?.map(task => task.prUrl)).toEqual([null, 'https://github.com/o/r/pull/1'])
})

test('runs link to tasks by agent id, else by the description cw printed', () => {
  const tasks = parseState(STATE) ?? []
  expect(taskOfRun(tasks, { agentId: 'r1', description: 'whatever' })?.role).toBe('reviewer')
  expect(taskOfRun(tasks, { agentId: 'new', description: 'NV-9 · Fix the CRE totalIva' })?.role).toBe('implementer')
  expect(taskOfRun(tasks, { agentId: 'x', description: 'other' })).toBe(null)
})

test('active and planned phases', () => {
  const tasks = parseState(STATE) ?? []
  expect(tasks.filter(isActive).length).toBe(2)
  expect(tasks.filter(isPlanned).map(task => task.ticket)).toEqual(['APP-2'])
})

test('foreign claims skip this checkout\'s tickets and mark stale ones', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  const payloads = [
    JSON.stringify({ ticket: 'NV-9', phase: 'review', holder: { host: 'here' }, since: '2026-10-18T09:00:00Z' }),
    JSON.stringify({ ticket: 'OPS-14', phase: 'implement', holder: { host: 'laptop' }, since: '2026-10-18T11:00:00Z', updatedAt: '2026-10-18T11:30:00Z' }),
    JSON.stringify({ ticket: 'SEC-6', phase: 'spec', holder: { host: 'cloud' }, since: '2026-10-15T09:00:00Z', updatedAt: '2026-10-15T09:00:00Z' }),
    'garbage',
  ]
  const claims = foreignClaims(payloads, new Set(['NV-9']), now)
  expect(claims.map(claim => [claim.ticket, claim.host, claim.isStale])).toEqual([['OPS-14', 'laptop', false], ['SEC-6', 'cloud', true]])
})
