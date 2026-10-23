// agents-progress: the Agents pane and the task band of the dev-workflow plugin (docs/PLAN.md §11).
// Event handling and the pane's layout are adapted from the MIT-licensed savvy-progress mod; see the
// notice in ./avatars.ts and the README. The tasks come from dev-workflow's state file; the mod
// makes no network call and runs no git fetch.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, StateSource } from '../types'
import { CRAB_CSS, avatarOf, crab } from './avatars'
import { CONFIG, ancestorsOf, bandLine, isActive, parseState, roleOf, taskOfAgent } from './state'

const NO_SOURCE: StateSource = { path: null, mtimeMs: 0, reads: 0 }
const agents = atom({ plugin: 'agents-progress', key: 'agents' } as const, [])
const tasks = atom({ plugin: 'agents-progress', key: 'tasks' } as const, [])
const source = atom({ plugin: 'agents-progress', key: 'source' } as const, NO_SOURCE)
const hasAutoOpened = atom({ plugin: 'agents-progress', key: 'hasAutoOpened' } as const, false)
const now = atom({ plugin: 'agents-progress', key: 'now' } as const, 0)

const PANE = 'agents-progress'
const PANE_TITLE = 'Agents'
const ACCENT = '#8f8cf4'
const STATUS_COLOR = { running: ACCENT, done: '#3B9C5F', failed: '#D0453F' } as const

// The status dot pulses while the agent runs, unless the system asks for reduced motion.
const STATUS_CSS = `<style>
.live{animation:pulse 1.6s ease-in-out infinite}@keyframes pulse{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// The status bar's stripe slides while the agent runs, unless the system asks for reduced motion.
const BAR_CSS = `<style>
.stripe{animation:slide 1s linear infinite}@keyframes slide{to{transform:translateX(16px)}}
@media (prefers-reduced-motion: reduce){.stripe{animation:none}}
</style>`

const AVATAR_WIDTH = 44
const AVATAR_HEIGHT = 36
const BAR_HEIGHT = 6

// The state file: the nearest directory with the project config, then its git common dir, which
// `git rev-parse --git-common-dir` answers in a linked worktree too (S5).
async function locate($: EngineInterface): Promise<string | null> {
  for (const dir of ancestorsOf(await $.session.cwd())) {
    if (!(await $.fs.exists(`${dir === '/' ? '' : dir}/${CONFIG}`))) continue
    const git = await $.process.run(['git', '-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => null)
    const common = git?.exitCode === 0 ? git.stdout.trim() : ''
    return common ? `${common}/dev-workflow/state.json` : null
  }
  return null
}

// Reads the state file when its mtime changed, or always with `force`. A missing file shows no task;
// invalid JSON keeps the last good tasks. `$.fs.stat` rejects a missing file, so `exists` comes first.
async function refresh($: EngineInterface, force = false): Promise<void> {
  const { path, mtimeMs } = await read($, source)
  if (!path) return
  if (!(await $.fs.exists(path))) {
    if (mtimeMs === 0) return
    await update($, source, current => ({ ...current, mtimeMs: 0 }))
    await update($, tasks, () => [])
    return
  }
  const stat = await $.fs.stat(path).catch(() => null)
  if (!stat || (!force && stat.mtimeMs === mtimeMs)) return
  const content = await $.fs.read(path).catch(() => null)
  await update($, source, current => ({ ...current, mtimeMs: stat.mtimeMs, reads: current.reads + 1 }))
  const parsed = content === null ? null : parseState(content)
  if (parsed) await update($, tasks, () => parsed)
}

export const register: Register = on => {
  on('session.start', async ($, event, next) => {
    const started = await next(event)
    await update($, source, () => NO_SOURCE)
    await update($, tasks, () => [])
    const path = await locate($)
    if (path) {
      await update($, source, current => ({ ...current, path }))
      await refresh($)
    }
    // Every second: the state file, and the elapsed time of running agents.
    $.clock.every(1000, async () => {
      await refresh($)
      const list = await read($, agents)
      if (!list.some(run => run.status === 'running')) return
      const at = await $.clock.now()
      await update($, now, () => at)
    })
    // Registered last: a refused name throws and would skip what follows.
    await $.command.register({ name: 'agents-progress', description: 'Show or hide the Agents pane', immediate: true })
    return started
  })

  on('command.run', { command: 'agents-progress' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return {}
    }
    const at = await $.clock.now()
    await update($, now, () => at)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return {}
  })

  // A cw call changes the state file: read it right away instead of at the next tick.
  on('tool.call', { tool: 'Bash' }, async ($, event, next) => {
    const result = await next(event)
    if (/^\s*cw\s/.test(event.command)) await refresh($, true)
    return result
  })

  on('agent.spawn', async ($, event, next) => {
    const started = await next(event)
    if (started.deny !== undefined) return started
    const at = await $.clock.now()
    const run: AgentRun = {
      id: started.agentId ?? event.tool_use_id,
      agentId: started.agentId,
      name: event.name,
      type: event.subagentType,
      description: event.description,
      model: started.model,
      status: 'running',
      startedAt: at,
      contextTokens: 0,
      contextMax: 0,
      tokens: 0,
    }
    await update($, agents, list => [...list.filter(item => item.id !== run.id), run])
    await update($, now, () => at)

    // The pane opens by itself once per session, at the first workflow agent.
    if (!roleOf(event.subagentType) || (await read($, hasAutoOpened))) return started
    await update($, hasAutoOpened, () => true)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return started
  })

  // agent.spawn does not fire when SendMessage resumes an agent, so the agent shows as running
  // again here. Rounds come from the state file.
  on('tool.call', { tool: 'SendMessage' }, async ($, event, next) => {
    const result = await next(event)
    if (result.deny !== undefined || result.isError) return result
    // A name may carry a ` [ref]` suffix from the agent listing.
    const to = typeof event.to === 'string' ? event.to.replace(/\s*\[[^\]]*\]$/, '').trim() : ''
    if (!to) return result
    await update($, agents, list => {
      const index = list.findLastIndex(run => run.agentId === to || run.name === to)
      if (index === -1) return list
      return list.map((run, i) => (i === index ? { ...run, status: 'running', endedAt: undefined } : run))
    })
    return result
  })

  // Each model request of a subagent: model, effort, context and tokens.
  on('turn.step', async function* ($, event, next) {
    const result = yield* next(event)
    const agentId = event.agentId
    const usage = result.usage
    if (!agentId || !usage) return result
    const model = usage.model || event.model
    const requestTokens =
      (usage.input_tokens || 0) +
      (usage.output_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0)
    await update($, agents, list =>
      list.map(run =>
        run.agentId !== agentId
          ? run
          : {
              ...run,
              model,
              effort: event.effort === undefined ? run.effort : String(event.effort),
              status: 'running',
              endedAt: undefined,
              contextTokens: requestTokens,
              // The engine reports no window: assume 1M, or 200k for Haiku.
              contextMax: /haiku/i.test(model) ? 200_000 : 1_000_000,
              tokens: run.tokens + requestTokens,
            },
      ),
    )
    return result
  })

  on('turn.complete', async ($, event, next) => {
    const agentId = event.agentId
    if (!agentId) return next(event)
    const at = await $.clock.now()
    await update($, agents, list =>
      list.map(run =>
        run.agentId === agentId ? { ...run, status: event.reason === 'answer' ? 'done' : 'failed', endedAt: at } : run,
      ),
    )
    await update($, now, () => at)
    return next(event)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, event) => {
    const ui = $.ui.resolve(event)
    const { Box, Text } = ui
    const list = await read($, agents)
    if (list.length === 0) return <Text dimColor>No subagents yet.</Text>

    const known = await read($, tasks)
    const at = Math.max(await read($, now), ...list.map(run => run.startedAt), 0)
    // Running agents first, newest first within each group.
    const ordered = [
      ...list.filter(run => run.status === 'running').reverse(),
      ...list.filter(run => run.status !== 'running').reverse(),
    ]
    const runningCount = list.filter(run => run.status === 'running').length
    const barColumns = Math.max(6, Math.min(20, (event.props.bodyColumns || 40) - 40))
    const barPixels = Math.max(80, Math.min(240, (event.props.bodyColumns || 40) * 4))

    return (
      <Box flexDirection="column">
        <Text dimColor>{`${runningCount} running · ${list.length - runningCount} finished`}</Text>
        {ordered.map(run => {
          const task = taskOfAgent(known, run.agentId)
          const role = roleOf(run.type)
          const avatar = avatarOf(run.type, role?.kind === 'implementer' ? task?.areas : [])
          const modelMatch = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(run.model)
          const [, family = '', major = '', minor] = modelMatch ?? []
          const modelLabel = family
            ? `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
            : run.model.replace(/^claude-/, '') || '—'
          const meta = [run.type, modelLabel]
          if (run.effort) meta.push(run.effort)
          // The rounds of its task, from the state file: implementer rounds, review rounds.
          if (task && role?.kind === 'implementer' && task.round > 1) meta.push(`Round ${task.round}`)
          if (task && role?.kind === 'reviewer' && task.reviewRound > 1) meta.push(`Round ${task.reviewRound}/${task.maxReviewRounds}`)
          meta.push(run.status)

          const percent = run.contextMax ? Math.min(100, Math.round((run.contextTokens / run.contextMax) * 100)) : 0
          const tokens = run.tokens >= 1e6 ? `${(run.tokens / 1e6).toFixed(1)}M` : run.tokens >= 1e3 ? `${Math.round(run.tokens / 1e3)}k` : `${run.tokens}`
          const seconds = Math.max(0, Math.round(((run.endedAt ?? Math.max(at, run.startedAt)) - run.startedAt) / 1000))
          const hours = Math.floor(seconds / 3600)
          const minutes = Math.floor((seconds % 3600) / 60)
          const restSeconds = String(seconds % 60).padStart(2, '0')
          const elapsed = hours ? `${hours}:${String(minutes).padStart(2, '0')}:${restSeconds}` : `${minutes}:${restSeconds}`

          // Only constants and numbers go into the SVG markup; every text from the session is a Text element.
          const statusMark = `<circle${run.status === 'running' ? ' class="live"' : ''} cx="${AVATAR_WIDTH - 4}" cy="4" r="3.5" fill="${STATUS_COLOR[run.status]}"/>`
          const avatarElement =
            event.surface === 'desktop' && 'Svg' in ui ? (
              <ui.Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_WIDTH}" height="${AVATAR_HEIGHT}" viewBox="0 0 ${AVATAR_WIDTH} ${AVATAR_HEIGHT}">${STATUS_CSS}${CRAB_CSS}${crab(avatar, 0, 2, run.status === 'running')}${statusMark}</svg>`}
                alt={`${avatar.costume} crab${avatar.badge ? `, ${avatar.badge}` : ''}, ${run.status}`}
                width={AVATAR_WIDTH}
                height={AVATAR_HEIGHT}
              />
            ) : (
              // The terminal shows the badge alone (docs/PLAN.md §11).
              <Text color={avatar.accent} bold>
                {avatar.badge ? `[${avatar.badge}]` : '[·]'}
              </Text>
            )

          // A status bar, not progress: a sliding stripe while running, full once done or failed.
          const barMarkup =
            run.status === 'running'
              ? `${BAR_CSS}<defs><pattern id="agents-progress-stripes" width="16" height="${BAR_HEIGHT}" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)"><rect width="8" height="${BAR_HEIGHT}" fill="${STATUS_COLOR.running}"/></pattern><clipPath id="agents-progress-track"><rect width="${barPixels}" height="${BAR_HEIGHT}" rx="3"/></clipPath></defs><g clip-path="url(#agents-progress-track)"><rect width="${barPixels}" height="${BAR_HEIGHT}" fill="${STATUS_COLOR.running}" opacity="0.25"/><rect class="stripe" x="-16" width="${barPixels + 16}" height="${BAR_HEIGHT}" fill="url(#agents-progress-stripes)"/></g>`
              : `<rect width="${barPixels}" height="${BAR_HEIGHT}" rx="3" fill="${STATUS_COLOR[run.status]}"/>`
          const barElement =
            event.surface === 'desktop' && 'Svg' in ui ? (
              <ui.Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${barPixels}" height="${BAR_HEIGHT}" viewBox="0 0 ${barPixels} ${BAR_HEIGHT}">${barMarkup}</svg>`}
                alt={`Status: ${run.status}`}
                width={barPixels}
                height={BAR_HEIGHT}
              />
            ) : (
              <Text color={STATUS_COLOR[run.status]}>
                {(run.status === 'running' ? '▒' : '█').repeat(barColumns)}
              </Text>
            )

          return (
            <Box key={run.id} flexDirection="row" gap={1} marginTop={1}>
              {avatarElement}
              <Box flexDirection="column">
                <Text bold wrap="truncate-end">
                  {run.description || run.type}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {meta.join(' · ')}
                </Text>
                <Box key={`bar-${run.id}`} flexDirection="row" gap={1}>
                  {barElement}
                  <Text dimColor wrap="truncate-end">
                    {`ctx ${percent}% · ${tokens} tokens · ${elapsed}`}
                  </Text>
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, event, next) => {
    const active = (await read($, tasks)).filter(isActive)
    if (active.length === 0 || event.props.hasSurvey) return next(event)
    const { Box, Text, Link } = $.ui.resolve(event)
    // Later mods draw in the band too: keep their drawing under ours.
    const others = await next(event)
    return (
      <Box flexDirection="column">
        {active.map(bandLine).map(line => (
          <Box key={line.key} flexDirection="row" gap={1}>
            <Text color={line.isFailure ? STATUS_COLOR.failed : ACCENT}>●</Text>
            <Text color={line.isFailure ? STATUS_COLOR.failed : undefined} wrap="truncate-end">
              {line.text}
            </Text>
            {line.prUrl ? <Link href={line.prUrl} label="PR/MR" /> : null}
          </Box>
        ))}
        {others}
      </Box>
    )
  })
}
