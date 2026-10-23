import type { AgentSpawnInput, CommandRunInput, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/work/shop'
const STATE = `${ROOT}/.git/dev-workflow/state.json`
const IMPLEMENTER = 'dev-workflow:implementer-m'
const REVIEWER = 'dev-workflow:reviewer'

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

// The engine beneath the plugin: agents get their description as id, the pane opens, and the state
// file of a dev-workflow project holds `tasks`.
function engine(on: On, tasks: unknown[] = []) {
  let opens = 0
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.exists', (_, e) => ({ value: e.path === `${ROOT}/.claude/dev-workflow/config.json` || e.path === STATE }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: JSON.stringify({ version: 1, tasks }) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: `${ROOT}/.git\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { opens: () => opens }
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })

const task = (fields: Record<string, unknown>) => ({
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
  areas: ['backend'],
  agents: { implementer: 'add endpoint', reviewer: null },
  steps: null,
  prUrl: null,
  ...fields,
})

test('the pane opens by itself exactly once, at the first workflow agent', async ($, on) => {
  mock.clock(on)
  const { opens } = engine(on)

  await $.agent.spawn(spawnInput('general-purpose', 'look around'))
  await $.agent.spawn(spawnInput('Explore', 'scout'))
  expect(opens()).toBe(0)
  await $.agent.spawn(spawnInput(IMPLEMENTER, 'add endpoint'))
  expect(opens()).toBe(1)
  await $.agent.spawn(spawnInput(REVIEWER, 'review endpoint'))
  await $.agent.spawn(spawnInput('dev-workflow:implementer-s', 'add button'))
  expect(opens()).toBe(1)
})

test('/agents-progress opens the pane, and closes it when it is open', async ($, on) => {
  mock.clock(on)
  const calls: string[] = []
  let isOpen = false
  on('ui.panes', () => ({
    value: isOpen ? [{ id: 'agents-progress', title: 'Agents', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', (_, e) => {
    calls.push(`open ${e.id}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    calls.push(`close ${e.id}`)
    return { value: undefined }
  })

  await $.command.run(TOGGLE)
  isOpen = true
  await $.command.run(TOGGLE)
  expect(calls).toEqual(['open agents-progress', 'close agents-progress'])
})

test('a SendMessage that resumes an agent shows it running again', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('tool.call', () => ({ result: 'sent' }))

  await $.agent.spawn(spawnInput(IMPLEMENTER, 'add endpoint', 'endpoint-impl'))
  await $.turn.complete(complete('add endpoint', 'answer'))
  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: `${IMPLEMENTER} · Opus 5.5 · done` })).toBeDefined()
  await before.unmount()

  // A name may carry the listing's ` [ref]` suffix.
  await $.tool.call({ tool: 'SendMessage', to: 'endpoint-impl [a1b2]', message: 'Fix the review findings.' })
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: `${IMPLEMENTER} · Opus 5.5 · running` })).toBeDefined()
})

test('a SendMessage that fails, or goes to an unknown recipient, changes no agent', async ($, on) => {
  mock.clock(on)
  engine(on)
  let isError = true
  on('tool.call', () => (isError ? { isError: true as const, result: 'No agent by that name.' } : { result: 'sent' }))

  await $.agent.spawn(spawnInput(IMPLEMENTER, 'add endpoint'))
  await $.turn.complete(complete('add endpoint', 'answer'))
  await $.tool.call({ tool: 'SendMessage', to: 'add endpoint', message: 'Fix the findings.' })
  isError = false
  await $.tool.call({ tool: 'SendMessage', to: 'someone-else', message: 'Hello.' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: `${IMPLEMENTER} · Opus 5.5 · done` })).toBeDefined()
})

test('turn.complete ends an agent as done on an answer and as failed otherwise', async ($, on) => {
  mock.clock(on)
  engine(on)

  await $.agent.spawn(spawnInput('dev-workflow:implementer-s', 'add button'))
  await $.agent.spawn(spawnInput(REVIEWER, 'review button'))
  await $.turn.complete(complete('add button', 'answer'))
  await $.turn.complete(complete('review button', 'error'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'dev-workflow:implementer-s · Opus 5.5 · done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `${REVIEWER} · Opus 5.5 · failed` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0 running · 2 finished' })).toBeDefined()
})

test("the rounds of an agent's task come from the state file, on that agent's row only", async ($, on) => {
  mock.clock(on)
  engine(on, [task({ phase: 'review', round: 2, reviewRound: 2, agents: { implementer: 'add endpoint', reviewer: 'review endpoint' } })])
  await start($)

  await $.agent.spawn(spawnInput(IMPLEMENTER, 'add endpoint'))
  await $.agent.spawn(spawnInput(REVIEWER, 'review endpoint'))
  await $.agent.spawn(spawnInput('dev-workflow:implementer-l', 'other task'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: `${IMPLEMENTER} · Opus 5.5 · Round 2 · running` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `${REVIEWER} · Opus 5.5 · Round 2/3 · running` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'dev-workflow:implementer-l · Opus 5.5 · running' })).toBeDefined()
})

test('the pane draws an implementer in the costume of its task area with its tier badge, on both surfaces', async ($, on) => {
  mock.clock(on)
  engine(on, [task({ areas: ['frontend'], agents: { implementer: '<b>build page</b>', reviewer: null } })])
  await start($)

  await $.agent.spawn(spawnInput('dev-workflow:implementer-xl', '<b>build page</b>'))

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: '[XL]' }))?.props).toMatchObject({ color: '#D85A30' })
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const avatar = await desktop.find({ type: 'Svg' })
  expect(avatar?.props).toMatchObject({ source: expect.stringContaining('class="c-painter run"') })
  expect(avatar?.props).toMatchObject({ source: expect.stringContaining('>XL</text>') })
  // The description is drawn as text, never inside the SVG markup.
  expect(avatar?.props).not.toMatchObject({ source: expect.stringContaining('build page') })
  expect(await desktop.find({ type: 'Text', text: '<b>build page</b>' })).toBeDefined()
})

test('the reviewer is a detective, Explore a pirate, without a badge', async ($, on) => {
  mock.clock(on)
  engine(on)

  await $.agent.spawn(spawnInput(REVIEWER, 'review'))
  await $.agent.spawn(spawnInput('Explore', 'scout'))
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const sources = (await desktop.findAll({ type: 'Svg' })).map(element => String(element.props.source))
  expect(sources.some(source => source.includes('class="c-detective run"'))).toBe(true)
  expect(sources.some(source => source.includes('class="c-pirate run"'))).toBe(true)
  expect(sources.some(source => source.includes('</text>'))).toBe(false)
})

test('the status bar shows a moving stripe while running and a full bar once done or failed', async ($, on) => {
  mock.clock(on)
  engine(on)

  await $.agent.spawn(spawnInput(IMPLEMENTER, 'running task'))
  await $.agent.spawn(spawnInput(IMPLEMENTER, 'done task'))
  await $.agent.spawn(spawnInput(IMPLEMENTER, 'failed task'))
  await $.turn.complete(complete('done task', 'answer'))
  await $.turn.complete(complete('failed task', 'error'))

  // Each row's status line is a Box keyed by the agent; the bar is its first child.
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await desktop.find({ key: 'bar-running task' }))?.children?.[0]).toMatchObject({
    type: 'Svg',
    props: { source: expect.stringContaining('class="stripe"') },
  })
  expect((await desktop.find({ key: 'bar-running task' }))?.children?.[0]).toMatchObject({
    props: { source: expect.stringContaining('@media (prefers-reduced-motion: reduce){.stripe{animation:none}}') },
  })
  expect((await desktop.find({ key: 'bar-done task' }))?.children?.[0]).toMatchObject({
    type: 'Svg',
    props: { source: expect.stringMatching(/^<svg[^>]*><rect [^>]*fill="#3B9C5F"\/><\/svg>$/) },
  })
  expect((await desktop.find({ key: 'bar-failed task' }))?.children?.[0]).toMatchObject({
    type: 'Svg',
    props: { source: expect.stringMatching(/^<svg[^>]*><rect [^>]*fill="#D0453F"\/><\/svg>$/) },
  })
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await terminal.find({ key: 'bar-running task' }))?.children?.[0]).toMatchObject({
    type: 'Text',
    props: { color: '#8f8cf4' },
    children: [expect.stringMatching(/^▒+$/)],
  })
  expect((await terminal.find({ key: 'bar-done task' }))?.children?.[0]).toMatchObject({
    type: 'Text',
    props: { color: '#3B9C5F' },
    children: [expect.stringMatching(/^█+$/)],
  })
})
