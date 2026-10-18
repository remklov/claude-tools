import type { AgentSpawnInput, CommandRunInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agents-progress',
  component: 'Pane',
  requestId: 'agents-progress',
  viewport: { columns: 120, rows: 40 },
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// What a session's engine fills in for an Agent call, apart from the type and description.
const spawnInput = (subagentType: string, description: string, name?: string): AgentSpawnInput => ({
  tool_use_id: `toolu-${description}`,
  prompt: 'Do the task.',
  description,
  subagentType,
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
  name,
})

const TOGGLE: CommandRunInput = {
  command: 'agents-progress',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
}

const complete = (agentId: string, reason: 'answer' | 'error') => ({
  turnId: `turn-${agentId}`,
  answer: 'Report.',
  durationMs: 1000,
  isAborted: false,
  agentId,
  reason,
})

test('the pane opens by itself exactly once, at the first dev-workflow agent', async ($, on) => {
  mock.clock(on)
  let opens = 0
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', ($, event) => ({ model: 'claude-sonnet-5-5', agentId: event.description }))

  await $.agent.spawn(spawnInput('general-purpose', 'look around'))
  expect(opens).toBe(0)
  await $.agent.spawn(spawnInput('dev-workflow:implementer-m', 'NV-9 · add endpoint'))
  expect(opens).toBe(1)
  await $.agent.spawn(spawnInput('dev-workflow:reviewer', 'Review · NV-9 · add endpoint'))
  expect(opens).toBe(1)
})

test('/agents-progress opens the pane, and closes it when it is open', async ($, on) => {
  mock.clock(on)
  const calls: string[] = []
  let isOpen = false
  on('ui.panes', () => ({
    value: isOpen ? [{ id: 'agents-progress', title: 'Agents', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', ($, event) => {
    calls.push(`open ${event.id}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, event) => {
    calls.push(`close ${event.id}`)
    return { value: undefined }
  })

  await $.command.run(TOGGLE)
  isOpen = true
  await $.command.run(TOGGLE)
  expect(calls).toEqual(['open agents-progress', 'close agents-progress'])
})

test('a row shows role, tier, model and status', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', ($, event) => ({ model: 'claude-sonnet-5-5', agentId: event.description }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn(spawnInput('dev-workflow:implementer-m', 'NV-9 · add endpoint'))
  await $.turn.complete(complete('NV-9 · add endpoint', 'answer'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'implementer · M · Sonnet 5.5 · done' })).toBeDefined()
})

test('a SendMessage that resumes an agent shows it running again', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', ($, event) => ({ model: 'claude-opus-5-5', agentId: event.description }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'sent' }))

  await $.agent.spawn(spawnInput('dev-workflow:implementer-l', 'OPS-12 · add pipeline'))
  await $.turn.complete(complete('OPS-12 · add pipeline', 'answer'))
  await $.tool.call({ tool: 'SendMessage', to: 'OPS-12 · add pipeline', message: 'Fix the review findings.' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'implementer · L · Opus 5.5 · running' })).toBeDefined()
})

test('a failed SendMessage leaves the agent as it was', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', ($, event) => ({ model: 'claude-opus-5-5', agentId: event.description }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ isError: true, result: 'No agent by that name.' }))

  await $.agent.spawn(spawnInput('dev-workflow:reviewer', 'Review · NV-9 · add endpoint'))
  await $.turn.complete(complete('Review · NV-9 · add endpoint', 'answer'))
  await $.tool.call({ tool: 'SendMessage', to: 'Review · NV-9 · add endpoint', message: 'Round 2.' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'reviewer · Opus 5.5 · done' })).toBeDefined()
})
