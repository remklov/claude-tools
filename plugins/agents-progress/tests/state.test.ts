import { expect, test } from 'claude-code/testing'

import { ancestorsOf, bandLine, isActive, parseState, roleOf, taskOfAgent } from '../hooks/state'

const TASK = {
  id: 'APP-42__feature__login',
  ticket: 'APP-42',
  title: 'Add login',
  branch: 'APP-42/feature/login',
  phase: 'implement',
  outcome: null,
  round: 1,
  reviewRound: 0,
  maxReviewRounds: 3,
  complexity: 'm',
  areas: ['frontend'],
  agents: { implementer: 'impl-1', reviewer: null },
  descriptions: { implementer: null, reviewer: null },
  steps: { done: 3, total: 8, note: 'tests written' },
  prUrl: null,
  updatedAt: '2026-10-22T10:00:00.000Z',
  endedAt: null,
}

const state = (...tasks: unknown[]) => JSON.stringify({ version: 1, updatedAt: '2026-10-22T10:00:00.000Z', tasks })

test('roleOf reads the dev-workflow agents and their tier, nothing else', () => {
  for (const tier of ['s', 'm', 'l', 'xl'] as const) expect(roleOf(`dev-workflow:implementer-${tier}`)).toEqual({ kind: 'implementer', tier })
  expect(roleOf('dev-workflow:reviewer')).toEqual({ kind: 'reviewer' })
  for (const other of ['dev-workflow:implementer-xxl', 'implementer-m', 'reviewer', 'other:reviewer', 'Explore', 'general-purpose']) {
    expect(roleOf(other)).toBeNull()
  }
})

test('parseState keeps the fields the mod draws from, with defaults for missing counts', () => {
  const [task] = parseState(state(TASK)) ?? []
  expect(task).toEqual({
    id: TASK.id,
    ticket: 'APP-42',
    title: 'Add login',
    branch: 'APP-42/feature/login',
    phase: 'implement',
    outcome: null,
    round: 1,
    reviewRound: 0,
    maxReviewRounds: 3,
    complexity: 'm',
    areas: ['frontend'],
    agents: { implementer: 'impl-1', reviewer: null },
    steps: { done: 3, total: 8 },
    prUrl: null,
  })
  const [bare] = parseState(state({ id: 'x', ticket: 'NO-TICKET', title: 'T', phase: 'spec' })) ?? []
  expect(bare).toMatchObject({ branch: 'x', outcome: null, round: 0, reviewRound: 0, maxReviewRounds: 3, complexity: null, areas: [], steps: null })
})

test('parseState refuses invalid JSON and a wrong shape, and skips a task without its keys', () => {
  expect(parseState('{"tasks": [')).toBeNull()
  expect(parseState('[]')).toBeNull()
  expect(parseState('{"tasks": {}}')).toBeNull()
  expect(parseState(state({ id: 'x', ticket: 'K', phase: 'spec' }))).toEqual([])
  expect(parseState(state(TASK, 'not a task'))?.map(task => task.id)).toEqual([TASK.id])
})

test('a task is active until it has an outcome, and an agent finds its task by id', () => {
  const [active, ended] = parseState(state(TASK, { ...TASK, id: 'old', outcome: 'done', phase: 'done' })) ?? []
  expect([active, ended].map(task => task !== undefined && isActive(task))).toEqual([true, false])
  const tasks = parseState(state(TASK, { ...TASK, id: 'b', agents: { implementer: 'impl-2', reviewer: 'rev-2' } })) ?? []
  expect(taskOfAgent(tasks, 'rev-2')?.id).toBe('b')
  expect(taskOfAgent(tasks, 'impl-1')?.id).toBe(TASK.id)
  expect(taskOfAgent(tasks, 'nobody')).toBeUndefined()
  expect(taskOfAgent(tasks, undefined)).toBeUndefined()
})

test('the band line names ticket, title, phase, the review round, the tier and, in implement, the step', () => {
  const [implement] = parseState(state(TASK)) ?? []
  expect(implement && bandLine(implement)).toEqual({ key: TASK.id, text: 'APP-42 · Add login · implement · M · step 3/8', isFailure: false, prUrl: null })
  const [review] = parseState(state({ ...TASK, phase: 'review', reviewRound: 2, steps: null })) ?? []
  expect(review && bandLine(review).text).toBe('APP-42 · Add login · review · Round 2/3 · M')
  const [spec] = parseState(state({ ...TASK, phase: 'spec', steps: { done: 0, total: 8 } })) ?? []
  expect(spec && bandLine(spec).text).toBe('APP-42 · Add login · spec · M')
  const [escalated] = parseState(state({ ...TASK, phase: 'escalated', complexity: null })) ?? []
  expect(escalated && bandLine(escalated)).toMatchObject({ text: 'APP-42 · Add login · escalated', isFailure: true })
})

test('the band links only an https PR/MR', () => {
  const [https] = parseState(state({ ...TASK, phase: 'deliver', prUrl: 'https://gitlab.example.com/a/b/-/merge_requests/7' })) ?? []
  expect(https && bandLine(https).prUrl).toBe('https://gitlab.example.com/a/b/-/merge_requests/7')
  for (const url of ['http://example.com/pr/1', 'javascript:alert(1)', 'not a url']) {
    const [task] = parseState(state({ ...TASK, prUrl: url })) ?? []
    expect(task && bandLine(task).prUrl).toBeNull()
  }
})

test('ancestorsOf walks from a directory up to the root', () => {
  expect(ancestorsOf('/work/proj/app/')).toEqual(['/work/proj/app', '/work/proj', '/work', '/'])
  expect(ancestorsOf('/')).toEqual(['/'])
})
