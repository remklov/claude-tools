// Orchestrator-side task commands: task lifecycle, spec, classification, delegation texts, delivery.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as claims from '../lib/claims.mjs';
import { agentName, agentPrompt, description, renderBrief } from '../lib/brief.mjs';
import { classify } from '../lib/classify.mjs';
import { currentBranch, git, headCommit, lines, tryGit } from '../lib/git.mjs';
import { color, CwError, EXIT, preconditionError, print, printJson, table, usageError, warn } from '../lib/out.mjs';
import { complexityRank, COMPLEXITIES } from '../lib/profile.mjs';
import { baseMoved, prBody, prBodyPath, prTitle } from '../lib/pr.mjs';
import { lintSpec, parseSpec, renderBranch, specTemplate } from '../lib/spec.mjs';
import { createTask, listTasks, loadTask, PHASES, resolveTaskId, saveTask, taskPath, transition } from '../lib/task.mjs';
import { readJson, writeJson } from '../lib/fsx.mjs';
import { emit, load, loadWithTask, need, rulebook } from './common.mjs';

const isTicketless = (profile, task) => !task.ticket || task.ticket === profile.git.noTicketKey;

// Pushes the task's phase into its claim so other sessions see it. Losing the claim stops the task.
export function syncClaim(ctx, profile, task, fields = {}) {
  if (isTicketless(profile, task) || !task.claim) return;
  try {
    const updated = claims.update(ctx, profile.tickets.claims, task.ticket, task.claim.sha, {
      phase: task.phase, round: task.round, branch: task.branch, task: task.id, title: task.title, prUrl: task.prUrl, ...fields,
    });
    task.claim = { ...task.claim, sha: updated.sha ?? task.claim.sha };
    saveTask(ctx, task, profile);
  } catch (error) {
    if (/unreachable|network/i.test(error.message)) warn(`claim ${task.ticket} not updated (remote unreachable)`);
    else throw new CwError(`The claim for ${task.ticket} is no longer ours: ${error.message}. Stop and tell the user.`, { code: EXIT.precondition });
  }
}

function report(ctx, task, round = task.round) {
  return readJson(taskPath(ctx, task, `report-${round}.json`), null);
}
function review(ctx, task, round = task.round) {
  return readJson(taskPath(ctx, task, `review-${round}.json`), null);
}

function specOf(ctx, task) {
  return parseSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'));
}

function recordBase(ctx, profile, task) {
  if (task.buildsOn) {
    const ref = task.buildsOn;
    if (ref.startsWith('origin/')) tryGit(['fetch', '--quiet', 'origin'], { cwd: ctx.mainCheckout, timeoutMs: 60_000 });
    const commit = tryGit(['rev-parse', ref], { cwd: ctx.mainCheckout });
    if (!commit) throw preconditionError(`builds-on ref ${ref} does not exist`);
    return { branch: ref.replace(/^origin\//, ''), commit };
  }
  const branch = currentBranch(ctx.mainCheckout);
  if (!branch) throw preconditionError('The main checkout is on a detached HEAD; check out the base branch first.');
  if (profile.isolation.mode === 'worktree' && listTasks(ctx).some((other) => other.branch === branch)) {
    throw preconditionError(`The main checkout is on the task branch ${branch}, not on a base branch.`);
  }
  return { branch, commit: headCommit(ctx.mainCheckout) };
}

function confirmNeeded(profile, task) {
  return profile.workflow.confirm.includes(task.complexity);
}

const PRECONDITIONS = {
  classify: (ctx, profile, task) => {
    if (task.phase === 'spec') {
      const { errors } = lintSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'), { profile });
      if (errors.length) throw preconditionError(`cw spec lint fails:\n- ${errors.join('\n- ')}`);
    }
    if (task.phase === 'implement' && report(ctx, task)?.status !== 'misclassified') throw preconditionError('Back to classify only after a misclassified report.');
  },
  review: (ctx, profile, task) => {
    const r = report(ctx, task);
    if (task.phase === 'implement' && r?.status !== 'done') throw preconditionError(`No valid done report for round ${task.round}.`);
  },
  deliver: (ctx, profile, task) => {
    if (review(ctx, task)?.status !== 'approved') throw preconditionError(`Review round ${task.round} is not approved.`);
  },
  done: (ctx, profile, task) => {
    if (!task.prUrl && !task.noPrReason) throw preconditionError('No PR recorded (cw pr record --url) and no --no-pr reason.');
  },
};

export async function taskCommand(flags, [sub, ...args]) {
  switch (sub) {
    case 'new': return taskNew(flags);
    case 'show': {
      const { ctx } = load(flags);
      const task = loadTask(ctx, resolveTaskId(ctx, args[0] ?? flags.task));
      return emit(flags, task, () => print(`${task.id}: ${task.ticket} · ${task.title}\nphase ${task.phase} · round ${task.round} · ${task.complexity ?? '?'} · areas ${task.areas.join(',') || '—'}\nbranch ${task.branch} · base ${task.base?.branch ?? '?'}@${task.base?.commit?.slice(0, 10) ?? '?'}\nworktree ${task.worktree ?? '—'} · PR ${task.prUrl ?? '—'}\ndir ${taskPath(ctx, task, '')}`));
    }
    case 'list': {
      const { ctx } = load(flags);
      const tasks = listTasks(ctx, { all: Boolean(flags.all) });
      return emit(flags, tasks, () => print(table(tasks.map((t) => ({ id: t.id, ticket: t.ticket, phase: t.phase, round: t.round, size: t.complexity ?? '', updated: t.updatedAt })), ['id', 'ticket', 'phase', 'round', 'size', 'updated']) || 'no tasks'));
    }
    case 'phase': {
      const { ctx, profile, task } = loadWithTask(flags);
      const to = need({ to: args[0] }, 'to', `one of ${PHASES.join(', ')}`);
      PRECONDITIONS[to]?.(ctx, profile, task);
      if (to === 'done' && flags['no-pr']) task.noPrReason = flags['no-pr'];
      transition(ctx, profile, task, to, { note: flags.note ?? '' });
      syncClaim(ctx, profile, task);
      return print(`${task.id}: ${to}`);
    }
    case 'confirm': {
      const { ctx, profile, task } = loadWithTask(flags);
      if (task.phase !== 'classify') throw preconditionError('Confirm after cw classify --set.');
      task.confirmation = { note: need(flags, 'note', 'what the user confirmed'), at: new Date().toISOString() };
      transition(ctx, profile, task, 'confirm', { note: task.confirmation.note });
      syncClaim(ctx, profile, task);
      return print(`${task.id}: confirmed`);
    }
    case 'start': return taskStart(flags);
    case 'agent': {
      const { ctx, profile, task } = loadWithTask(flags);
      const role = need(flags, 'role');
      task.agents[role] = { ...(task.agents[role] ?? {}), id: need(flags, 'id'), type: task.agents[role]?.type ?? agentName(profile, role, task.complexity) };
      saveTask(ctx, task, profile);
      return print(`${task.id}: ${role} = ${task.agents[role].id}`);
    }
    case 'review': return taskReview(flags);
    case 'return': return taskReturn(flags);
    case 'investigate': return taskInvestigate(flags);
    case 'end': return taskEnd(flags);
    case 'cleanup': return taskCleanup(flags);
    default:
      throw usageError('usage: cw task <new|show|list|phase|confirm|start|agent|review|return|investigate|end|cleanup>');
  }
}

async function taskNew(flags) {
  const { ctx, profile } = load(flags);
  const ticket = String(need(flags, 'ticket'));
  const slug = need(flags, 'slug', '2–4 lowercase words joined by hyphens');
  const title = need(flags, 'title');
  let branch;
  try {
    branch = renderBranch(profile, { ticket, slug, type: flags['branch-type'] });
  } catch (error) {
    throw usageError(error.message);
  }
  let claim = null;
  if (ticket !== profile.git.noTicketKey) {
    const current = claims.getClaim(ctx, profile.tickets.claims, ticket);
    if (!current) throw preconditionError(`${ticket} is not claimed. Run cw intake ${ticket} first.`);
    if (!claims.isMine(current)) throw preconditionError(`${ticket} is claimed by another session (${current.holder?.host}, ${current.phase}).`);
    claim = { ref: `${profile.tickets.claims.namespace}/${ticket}`, sha: current.sha ?? null, since: current.since };
  }
  const task = createTask(ctx, profile, { ticket, title, branch, type: flags.type ?? 'feature', buildsOn: typeof flags['builds-on'] === 'string' ? flags['builds-on'] : null, parent: flags.parent ?? null, claim });
  writeFileSync(taskPath(ctx, task, 'spec.md'), specTemplate(task, profile));
  if (task.parent) {
    const parent = loadTask(ctx, task.parent);
    parent.subtasks = [...new Set([...parent.subtasks, task.id])];
    saveTask(ctx, parent, profile);
  }
  syncClaim(ctx, profile, task);
  emit(flags, { task: task.id, branch, spec: taskPath(ctx, task, 'spec.md') }, (v) => print(`task ${v.task} created\nbranch ${v.branch}\nwrite the spec: ${v.spec}`));
}

export async function specCommand(flags, [sub]) {
  if (sub === 'save' || sub === 'show') {
    const { ctx, task } = loadWithTask(flags);
    const file = taskPath(ctx, task, 'spec.md');
    if (sub === 'show') return print(readFileSync(file, 'utf8'));
    const text = readFileSync(0, 'utf8');
    if (!text.trim()) throw usageError('cw spec save reads the spec from stdin');
    writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
    return print(`saved ${file}; next: cw spec lint --task ${task.id}`);
  }
  if (sub !== 'lint') throw usageError('usage: cw spec <save|show|lint> --task <id>');
  const base = loadWithTask(flags);
  const { ctx, profile, task } = base;
  const ruleIds = new Set(rulebook(base).rules.map((rule) => rule.id));
  const { errors, warnings } = lintSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'), { profile, ctx, base: task.base?.commit ?? 'HEAD', ruleIds });
  emit(flags, { errors, warnings }, () => {
    for (const error of errors) print(color.red(`error: ${error}`));
    for (const warning of warnings) print(color.yellow(`warning: ${warning}`));
    if (!errors.length) print('spec ok');
  });
  return errors.length ? EXIT.failed : EXIT.ok;
}

export async function classifyCommand(flags) {
  const { ctx, profile, packs, task } = loadWithTask(flags);
  const file = taskPath(ctx, task, 'classify.json');
  if (flags.set) {
    const chosen = String(flags.set);
    if (!COMPLEXITIES.includes(chosen)) throw usageError(`--set must be one of ${COMPLEXITIES.join(', ')}`);
    const data = readJson(file, null);
    if (!data) throw preconditionError('Run cw classify --task <id> first.');
    if (complexityRank(chosen) < complexityRank(data.minComplexity) && typeof flags.override !== 'string') {
      throw preconditionError(`${chosen} is below the minimum ${data.minComplexity} (${data.reasons.join('; ')}). Choose ≥ ${data.minComplexity} or pass --override "<reason the user approved>".`);
    }
    data.chosen = chosen;
    data.justification = need(flags, 'why', 'one sentence');
    data.override = typeof flags.override === 'string' ? flags.override : null;
    data.agent = agentName(profile, 'implementer', chosen);
    writeJson(file, data);
    task.complexity = chosen;
    task.complexityOverride = data.override;
    saveTask(ctx, task, profile);
    const next = confirmNeeded(profile, task) ? 'ask the user to confirm, then cw task confirm' : 'cw task start';
    return emit(flags, data, () => print(`${task.id}: complexity ${chosen} → ${data.agent}. Next: ${next}.`));
  }
  const spec = specOf(ctx, task);
  const extra = [].concat(flags.paths ?? []).flatMap((p) => String(p).split(','));
  const result = classify(ctx, profile, packs, { paths: [...new Set([...spec.paths, ...extra])], text: `${spec.title}\n${spec.body('Requirements')}` });
  task.areas = result.areas;
  task.packages = result.packages;
  if (task.phase === 'spec') {
    PRECONDITIONS.classify(ctx, profile, task);
    transition(ctx, profile, task, 'classify');
  } else saveTask(ctx, task, profile);
  writeJson(file, { ...result, chosen: null, justification: null, override: null, agent: null });
  syncClaim(ctx, profile, task);
  emit(flags, result, () => {
    print(`packages ${result.packages.join(', ') || '—'} · areas ${result.areas.join(', ') || '—'}`);
    print(`minimum complexity ${result.minComplexity}: ${result.reasons.join('; ')}`);
    if (result.unowned.length) print(color.yellow(`paths outside any package: ${result.unowned.join(', ')}`));
    if (result.splitRecommended) print(color.yellow(`split recommended in this order: ${result.order.join(' → ')}`));
    for (const [role, list] of Object.entries(result.procedures)) if (list.length) print(`${role} procedures: ${list.join(', ')}`);
    print('Next: cw classify --task <id> --set <s|m|l|xl> --why "<one sentence>"');
  });
}

async function taskStart(flags) {
  const { ctx, profile, packs, task } = loadWithTask(flags);
  if (!task.complexity) throw preconditionError('Set the complexity first: cw classify --set.');
  if (task.phase === 'classify' && confirmNeeded(profile, task)) throw preconditionError(`Complexity ${task.complexity} needs the user's confirmation first (cw task confirm).`);
  if (!['classify', 'confirm'].includes(task.phase)) throw preconditionError(`Task is in phase ${task.phase}.`);
  if (profile.tickets.file) {
    const dirty = lines(tryGit(['status', '--porcelain', '--', profile.tickets.file], { cwd: ctx.mainCheckout }) ?? '');
    if (dirty.length) throw preconditionError(`${profile.tickets.file} has uncommitted changes in the main checkout.`);
  }
  if (!isTicketless(profile, task)) {
    const current = claims.getClaim(ctx, profile.tickets.claims, task.ticket);
    if (!claims.isMine(current, task)) throw preconditionError(`The claim for ${task.ticket} is not held by this session anymore.`);
  }
  task.base = recordBase(ctx, profile, task);
  task.round = 1;
  task.steps = { done: 0, total: 9, note: '' };
  const role = 'implementer';
  task.agents.implementer = { type: agentName(profile, role, task.complexity), description: description(task, role) };
  saveTask(ctx, task, profile);
  const brief = renderBrief(ctx, profile, packs, task, role);
  transition(ctx, profile, task, 'implement', { note: `base ${task.base.branch}@${task.base.commit.slice(0, 10)}` });
  syncClaim(ctx, profile, task);
  const out = { agent: task.agents.implementer.type, description: task.agents.implementer.description, prompt: agentPrompt(task, role, brief), brief };
  emit({ json: true }, out);
}

async function taskReview(flags) {
  const { ctx, profile, packs, task } = loadWithTask(flags);
  if (task.phase === 'implement') {
    PRECONDITIONS.review(ctx, profile, task);
    transition(ctx, profile, task, 'review');
  } else if (task.phase === 'deliver') {
    transition(ctx, profile, task, 'review', { note: 'base moved: review of the rebase' });
  } else if (task.phase !== 'review') throw preconditionError(`Task is in phase ${task.phase}.`);
  const brief = renderBrief(ctx, profile, packs, task, 'reviewer');
  task.agents.reviewer = { ...(task.agents.reviewer ?? {}), type: agentName(profile, 'reviewer'), description: description(task, 'reviewer') };
  saveTask(ctx, task, profile);
  syncClaim(ctx, profile, task);
  if (task.agents.reviewer.id) {
    return emit({ json: true }, { sendMessageTo: task.agents.reviewer.id, message: `Round ${task.round}: the implementer reports done again (${taskPath(ctx, task, `report-${task.round}.json`)}). The brief is updated: ${brief}. Review the changes since your last review and check every earlier blocking finding; finish with cw review save --task ${task.id}.` });
  }
  emit({ json: true }, { agent: task.agents.reviewer.type, description: task.agents.reviewer.description, prompt: agentPrompt(task, 'reviewer', brief), brief });
}

async function taskReturn(flags) {
  const { ctx, profile, task } = loadWithTask(flags);
  if (task.phase !== 'review') throw preconditionError(`Task is in phase ${task.phase}.`);
  const r = review(ctx, task);
  if (r?.status !== 'changes_requested') throw preconditionError(`Review round ${task.round} is not changes_requested.`);
  const items = r.findings.filter((f) => f.severity === 'blocking' || f.sendAlong);
  if (task.round >= profile.workflow.maxReviewRounds) {
    transition(ctx, profile, task, 'escalated', { note: `${profile.workflow.maxReviewRounds} review rounds used` });
    syncClaim(ctx, profile, task);
    return emit({ json: true }, { escalated: true, message: `Round ${task.round} of ${profile.workflow.maxReviewRounds} still has blocking findings. Escalate to the user with the findings.`, findings: items });
  }
  task.round += 1;
  task.steps = { done: 0, total: 9, note: 'review fixes' };
  saveTask(ctx, task, profile);
  transition(ctx, profile, task, 'implement', { note: `round ${task.round}` });
  syncClaim(ctx, profile, task);
  const message = [
    `Review round ${task.round - 1} requests changes. Fix these on the same branch, rerun cw checks --changed, commit (cw commit msg + git commit -F) and finish with cw report save --task ${task.id} (round ${task.round}):`,
    ...items.map((f) => `- [${f.severity === 'blocking' ? 'blocking' : 'also'} · ${f.rule}] ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}: ` : ''}${f.issue}${f.suggestion ? ` — ${f.suggestion}` : ''}`),
  ].join('\n');
  emit({ json: true }, { sendMessageTo: task.agents.implementer?.id ?? null, message });
}

async function taskInvestigate(flags) {
  const { ctx, profile, packs, task } = loadWithTask(flags);
  const question = need(flags, 'question');
  const brief = renderBrief(ctx, profile, packs, task, 'investigator', { question });
  task.agents.investigator = { type: agentName(profile, 'investigator'), description: description(task, 'investigator') };
  saveTask(ctx, task, profile);
  emit({ json: true }, { agent: task.agents.investigator.type, description: task.agents.investigator.description, prompt: agentPrompt(task, 'investigator', brief), brief });
}

async function taskEnd(flags) {
  const { ctx, profile, task } = loadWithTask(flags);
  const outcome = need(flags, 'outcome', 'done|escalated|aborted');
  if (outcome === 'done') {
    if (typeof flags['no-pr'] === 'string') task.noPrReason = flags['no-pr'];
    PRECONDITIONS.done(ctx, profile, task);
    if (task.phase === 'review') PRECONDITIONS.deliver(ctx, profile, task);
    if (task.phase !== 'deliver') transition(ctx, profile, task, 'deliver');
    transition(ctx, profile, task, 'done');
    syncClaim(ctx, profile, task);
  } else if (outcome === 'aborted') {
    transition(ctx, profile, task, 'aborted', { note: flags.note ?? '' });
    if (!isTicketless(profile, task) && task.claim) {
      try {
        claims.release(ctx, profile.tickets.claims, task.ticket, { expectedSha: task.claim.sha });
      } catch (error) {
        warn(`claim not released: ${error.message}`);
      }
    }
  } else if (outcome === 'escalated') {
    if (task.phase !== 'escalated') transition(ctx, profile, task, 'escalated', { note: flags.note ?? '' });
    syncClaim(ctx, profile, task);
  } else throw usageError('--outcome must be done, escalated or aborted');
  print(`${task.id}: ${task.phase}${outcome === 'done' ? ' (the claim stays until the PR is merged)' : ''}`);
}

async function taskCleanup(flags) {
  const { ctx, profile, task } = loadWithTask(flags);
  const results = [];
  const all = [task, ...task.subtasks.map((id) => loadTask(ctx, id))];
  for (const item of all) {
    if (profile.isolation.mode === 'in-place') {
      const app = join(ctx.mainCheckout, profile.isolation.appRoot);
      const clean = (tryGit(['status', '--porcelain'], { cwd: app }) ?? 'x') === '';
      if (clean && item.base) git(['switch', item.base.branch], { cwd: app });
      results.push({ task: item.id, switchedBack: clean, reason: clean ? null : 'app checkout has uncommitted changes' });
      continue;
    }
    if (!item.worktree || !existsSync(item.worktree)) {
      results.push({ task: item.id, removed: false, reason: 'no worktree recorded or already gone' });
      continue;
    }
    const clean = (tryGit(['status', '--porcelain'], { cwd: item.worktree }) ?? 'x') === '';
    const head = tryGit(['rev-parse', 'HEAD'], { cwd: item.worktree });
    const pushed = tryGit(['rev-parse', `origin/${item.branch}`], { cwd: ctx.mainCheckout });
    if (!clean || !pushed || head !== pushed) {
      results.push({ task: item.id, removed: false, reason: !clean ? 'worktree has uncommitted changes' : 'branch tip is not the pushed one' });
      continue;
    }
    git(['worktree', 'remove', item.worktree], { cwd: ctx.mainCheckout });
    tryGit(['branch', '-D', item.branch], { cwd: ctx.mainCheckout });
    results.push({ task: item.id, removed: true });
  }
  emit(flags, results, () => results.forEach((r) => print(`${r.task}: ${r.removed || r.switchedBack ? 'cleaned up' : `kept (${r.reason})`}`)));
}

export async function baseMovedCommand(flags) {
  const { ctx, task } = loadWithTask(flags);
  const result = baseMoved(ctx, task, task.worktree ?? ctx.mainCheckout);
  emit(flags, result, () => print(!result.moved ? 'base unchanged' : result.rebaseNeeded ? `base moved to ${result.newTip}; rebase needed (${[...result.conflicts, ...result.overlap].join(', ')}).\nSend to the implementer:\n${result.implementerMessage}` : `base moved to ${result.newTip}; no overlap with this task, no rebase needed`));
  return result.rebaseNeeded ? EXIT.failed : EXIT.ok;
}

export async function prCommand(flags, [sub]) {
  const { ctx, profile, packs, task } = loadWithTask(flags);
  switch (sub) {
    case 'title':
      return print(prTitle(ctx, task));
    case 'body': {
      const body = flags.stdin ? readFileSync(0, 'utf8') : prBody(ctx, profile, packs, task);
      const out = typeof flags.out === 'string' ? flags.out : prBodyPath(ctx, task);
      writeFileSync(out, body);
      return emit(flags, { file: out, body }, () => print(`${out}\n\n${body}`));
    }
    case 'record': {
      const url = need(flags, 'url');
      if (!/^https:\/\//.test(url)) throw usageError('--url must be an https URL');
      task.prUrl = url;
      saveTask(ctx, task, profile);
      if (task.phase === 'review') {
        PRECONDITIONS.deliver(ctx, profile, task);
        transition(ctx, profile, task, 'deliver');
      }
      syncClaim(ctx, profile, task, { prUrl: url });
      return print(`${task.id}: PR ${url}`);
    }
    default:
      throw usageError('usage: cw pr <title|body|record --url> --task <id>');
  }
}

export { printJson };
