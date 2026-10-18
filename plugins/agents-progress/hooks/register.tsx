// agents-progress: the Agents pane and the task band for the dev workflow. Tasks, phases, review
// rounds and step progress come from the workflow state that `cw` writes; agent runs come from the
// engine's events. Event handling and the pane's layout are adapted from the MIT-licensed
// savvy-progress mod; see the notice in ./avatars.ts and the README.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun } from '../types'
import { CRAB_CSS, avatarOf, crab, parseAgentType } from './avatars'
import { age, foreignClaims, isActive, isPlanned, parseState, taskOfRun } from './state'
import type { ForeignClaim, TaskState } from './state'

const agents = atom({ plugin: 'agents-progress', key: 'agents' } as const, [])
const tasks = atom({ plugin: 'agents-progress', key: 'tasks' } as const, [])
const claims = atom({ plugin: 'agents-progress', key: 'claims' } as const, [])
const source = atom({ plugin: 'agents-progress', key: 'source' } as const, { commonDir: '', mtimeMs: 0, claimsAt: 0 })
const hasAutoOpened = atom({ plugin: 'agents-progress', key: 'hasAutoOpened' } as const, false)
const now = atom({ plugin: 'agents-progress', key: 'now' } as const, 0)

const PANE = 'agents-progress'
const PANE_TITLE = 'Agents'
const ACCENT = '#8f8cf4'
const STATUS_COLOR = { running: ACCENT, done: '#3B9C5F', failed: '#D0453F' } as const
const CLAIMS_EVERY_MS = 120_000
const MAX_CLAIMS = 12

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

const TIER_LABEL: Record<string, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' }

// Re-reads state.json when its modification time changed. Never throws: a missing or broken file
// keeps the last good state.
async function refreshState($: EngineInterface): Promise<void> {
  const current = await read($, source)
  if (!current.commonDir) return
  const path = `${current.commonDir}/dev-workflow/state.json`
  try {
    const stat = await $.fs.stat(path)
    if (stat.mtimeMs === current.mtimeMs) return
    const parsed = parseState(String(await $.fs.read(path)))
    await update($, source, value => ({ ...value, mtimeMs: stat.mtimeMs }))
    if (!parsed) return
    await update($, tasks, () => parsed)
    $.ui.invalidate('ui.render')
  } catch {
    // No state yet (no task started in this repository).
  }
}

// Fetches the claims of all sessions and keeps the ones this checkout doesn't work on.
async function refreshClaims($: EngineInterface): Promise<void> {
  const current = await read($, source)
  if (!current.commonDir) return
  try {
    await $.process.run(['git', 'fetch', '--quiet', '--prune', 'origin', '+refs/claims/*:refs/dw/claims/*'], { timeoutMs: 20_000 })
    const refs = await $.process.run(['git', 'for-each-ref', '--format=%(objectname)', 'refs/dw/claims/'], { timeoutMs: 10_000 })
    const shas = refs.stdout.split('\n').filter(Boolean).slice(0, MAX_CLAIMS)
    const payloads: string[] = []
    for (const sha of shas) {
      const blob = await $.process.run(['git', 'cat-file', '-p', `${sha}:claim.json`], { timeoutMs: 10_000 })
      if (blob.exitCode === 0) payloads.push(blob.stdout)
    }
    const own = new Set((await read($, tasks)).map(task => task.ticket))
    const at = await $.clock.now()
    await update($, claims, () => foreignClaims(payloads, own, at))
    $.ui.invalidate('ui.render')
  } catch {
    // Offline or no remote: keep the last result.
  }
}

export const register: Register = on => {
  on('session.start', async ($, event, next) => {
    const started = await next(event)
    try {
      const result = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: 10_000 })
      if (result.exitCode === 0) {
        const commonDir = result.stdout.trim()
        await update($, source, value => ({ ...value, commonDir }))
      }
    } catch {
      // Not a git repository: only the generic agents pane works.
    }
    await refreshState($)
    $.clock.every(1000, async () => {
      await refreshState($)
      const list = await read($, agents)
      const at = await $.clock.now()
      if (list.some(run => run.status === 'running')) await update($, now, () => at)
      const current = await read($, source)
      const isIdle = !list.some(run => run.status === 'running')
      if (isIdle && current.commonDir && at - current.claimsAt > CLAIMS_EVERY_MS) {
        await update($, source, value => ({ ...value, claimsAt: at }))
        await refreshClaims($)
      }
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

  // A cw command may have changed the workflow state: read it right away instead of on the next tick.
  on('tool.call', { tool: 'Bash' }, async ($, event, next) => {
    const result = await next(event)
    const command = typeof event.command === 'string' ? event.command.trim() : ''
    if (/^(cw|.*\/cw)\s/.test(command)) await refreshState($)
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

    const isWorkflowAgent = parseAgentType(event.subagentType).role !== null
    if (!isWorkflowAgent || (await read($, hasAutoOpened))) return started
    await update($, hasAutoOpened, () => true)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return started
  })

  // agent.spawn does not fire when SendMessage resumes an agent, so the agent shows as running again here.
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
    const taskList: TaskState[] = await read($, tasks)
    const planned = taskList.filter(isPlanned)
    if (list.length === 0 && planned.length === 0) return <Text dimColor>No subagents yet.</Text>

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
        <Text dimColor>{`${runningCount} running · ${list.length - runningCount} finished${planned.length ? ` · ${planned.length} planned` : ''}`}</Text>
        {ordered.map(run => {
          const linked = taskOfRun(taskList, run)
          const avatar = avatarOf(run.type, linked?.task.areas ?? [])
          const parsed = parseAgentType(run.type)
          const modelMatch = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(run.model)
          const [, family = '', major = '', minor] = modelMatch ?? []
          const modelLabel = family
            ? `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
            : run.model.replace(/^claude-/, '') || '—'
          const meta = [parsed.role ? `${parsed.role}${parsed.tier ? ` · ${TIER_LABEL[parsed.tier] ?? parsed.tier}` : ''}` : run.type, modelLabel]
          if (run.effort) meta.push(run.effort)
          if (linked && linked.role === 'reviewer' && linked.task.round > 1) meta.push(`Round ${linked.task.round}`)
          meta.push(run.status)
          const steps = linked && linked.role === 'implementer' && run.status === 'running' && linked.task.steps.done > 0
            ? ` · step ${linked.task.steps.done}/${linked.task.steps.total}${linked.task.steps.note ? ` ${linked.task.steps.note}` : ''}`
            : ''

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
              // The terminal shows the badge alone, to keep the scope small.
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
                  {meta.join(' · ') + steps}
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
        {planned.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Planned</Text>
            {planned.map(task => (
              <Text key={`planned-${task.id}`} wrap="truncate-end">
                {`· ${task.ticket} · ${task.title}${task.complexity ? ` · ${TIER_LABEL[task.complexity] ?? task.complexity}` : ''} · ${task.phase}`}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, event, next) => {
    const active = (await read($, tasks)).filter(isActive)
    const foreign: ForeignClaim[] = await read($, claims)
    if ((active.length === 0 && foreign.length === 0) || event.props.hasSurvey) return next(event)
    const { Box, Text, Link } = $.ui.resolve(event)
    const at = await $.clock.now()
    // Later mods draw in the band too: keep their drawing under ours.
    const others = await next(event)
    return (
      <Box flexDirection="column">
        {active.map(task => (
          <Box key={task.id} flexDirection="row" gap={1}>
            <Text color={task.phase === 'escalated' ? STATUS_COLOR.failed : ACCENT}>●</Text>
            <Text wrap="truncate-end">
              {[task.ticket, task.title, task.phase]
                .concat(task.phase === 'review' && task.round ? [`Round ${task.round}/${task.maxRounds}`] : [])
                .concat(task.phase === 'implement' && task.steps.done ? [`step ${task.steps.done}/${task.steps.total}`] : [])
                .concat(task.complexity ? [TIER_LABEL[task.complexity] ?? task.complexity] : [])
                .join(' · ')}
            </Text>
            {task.prUrl ? <Link href={task.prUrl} label="PR" /> : null}
          </Box>
        ))}
        {foreign.length > 0 ? (
          <Text dimColor wrap="truncate-end">
            {`elsewhere: ${foreign.map(claim => `${claim.ticket} · ${claim.phase} · ${claim.host} · ${age(claim.since, at)}${claim.isStale ? ' (stale)' : ''}`).join('  ·  ')}`}
          </Text>
        ) : null}
        {others}
      </Box>
    )
  })
}
