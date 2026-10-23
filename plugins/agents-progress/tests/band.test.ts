import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/work/shop'
const STATE = `${ROOT}/.git/dev-workflow/state.json`

const BAND = {
  plugin: 'agents-progress',
  component: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

// Stands for what Claude Code and later mods draw in the band.
const OTHERS = (): RenderElement => ({ type: 'Text', props: {}, children: ['drawn by another mod'] })

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
  areas: ['frontend'],
  agents: { implementer: null, reviewer: null },
  steps: { done: 3, total: 8 },
  prUrl: null,
  ...fields,
})

const stateText = (...tasks: unknown[]) => JSON.stringify({ version: 1, tasks })

// A dev-workflow project on a file system in memory: the config at ROOT, the session in ROOT/app, and
// git answering the common dir. `file` is the state file (absent while undefined).
function project(on: On) {
  const file: { text?: string; mtimeMs: number; reads: number } = { mtimeMs: 1, reads: 0 }
  const runs: string[][] = []
  const commands: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: `${ROOT}/app` }))
  on('command.register', (_, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('fs.exists', (_, e) => ({ value: e.path === `${ROOT}/.claude/dev-workflow/config.json` || (e.path === STATE && file.text !== undefined) }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: file.mtimeMs, isLink: false } }))
  on('fs.read', () => {
    file.reads += 1
    return { value: file.text ?? '' }
  })
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: `${ROOT}/.git\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', OTHERS)
  return { file, runs, commands }
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: `${ROOT}/app` })

test('the session start finds the state file through the config and git, and registers /agents-progress', async ($, on) => {
  mock.clock(on)
  const { file, runs, commands } = project(on)
  file.text = stateText(task({}))

  await start($)
  expect(runs).toEqual([['git', '-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir']])
  expect(commands).toEqual(['agents-progress'])
  expect(file.reads).toBe(1)
})

test('the band shows one line per active task, above what other mods draw', async ($, on) => {
  mock.clock(on)
  const { file } = project(on)
  file.text = stateText(
    task({}),
    task({ id: 'b', ticket: 'APP-43', title: 'Export CSV', phase: 'review', reviewRound: 2, steps: null, prUrl: 'https://gitlab.example.com/a/b/-/merge_requests/7' }),
    task({ id: 'old', ticket: 'APP-40', title: 'Old', phase: 'done', outcome: 'done' }),
  )
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'APP-42 · Add login · implement · M · step 3/8' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'APP-43 · Export CSV · review · Round 2/3 · M' })).toBeDefined()
    expect(await ui.find({ type: 'Link' })).toMatchObject({ props: { href: 'https://gitlab.example.com/a/b/-/merge_requests/7' } })
    expect(await ui.find({ type: 'Text', text: /APP-40/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'drawn by another mod' })).toBeDefined()
    await ui.unmount()
  }
})

test('an escalated task shows in the failure colour', async ($, on) => {
  mock.clock(on)
  const { file } = project(on)
  file.text = stateText(task({ phase: 'escalated', steps: null }))
  await start($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: 'APP-42 · Add login · escalated · M' }))?.props).toMatchObject({ color: '#D0453F' })
})

test('without a state file or outside a project the band stays hidden', async ($, on) => {
  mock.clock(on)
  project(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /APP-42/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by another mod' })).toBeDefined()
})

test('the poll re-reads only a changed file, keeps the last good state on invalid JSON, and clears a deleted one', async ($, on) => {
  const clock = mock.clock(on)
  const { file } = project(on)
  file.text = stateText(task({}))
  await start($)
  expect(file.reads).toBe(1)

  await clock.advance(3000)
  expect(file.reads).toBe(1)

  file.text = stateText(task({ phase: 'review', reviewRound: 1, steps: null }))
  file.mtimeMs = 2
  await clock.advance(1000)
  expect(file.reads).toBe(2)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'APP-42 · Add login · review · Round 1/3 · M' })).toBeDefined()
  await ui.unmount()

  file.text = '{"tasks": ['
  file.mtimeMs = 3
  await clock.advance(1000)
  expect(file.reads).toBe(3)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'APP-42 · Add login · review · Round 1/3 · M' })).toBeDefined()
  await ui.unmount()

  file.text = undefined
  await clock.advance(1000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /APP-42/ })).toBeUndefined()
})

test('a cw call reads the state file right away, also when its mtime looks unchanged', async ($, on) => {
  mock.clock(on)
  const { file } = project(on)
  on('tool.call', () => ({ result: 'ok' }))
  file.text = stateText(task({}))
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(file.reads).toBe(1)
  file.text = stateText(task({ phase: 'deliver', steps: null }))
  await $.tool.call({ tool: 'Bash', command: 'cw pr body --task APP-42__feature__login' })
  expect(file.reads).toBe(2)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'APP-42 · Add login · deliver · M' })).toBeDefined()
})
