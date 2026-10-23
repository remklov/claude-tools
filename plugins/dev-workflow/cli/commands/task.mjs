// Orchestrator commands for the task lifecycle (§6 O1–O10, §8). Each command checks its phase and
// preconditions, changes task.json under the lock, and prints the next step.
import { existsSync } from 'node:fs';
import { writeAtomic } from '../lib/fsx.mjs';
import { branchExists, currentBranch } from '../lib/git.mjs';
import { preconditionError, usageError } from '../lib/out.mjs';
import { specTemplate } from '../lib/spec.mjs';
import { OUTCOMES, createTask, endTask, isActive, listTasks, newTask, readTask, staleAgent, transition, updateTask } from '../lib/task.mjs';
import { renderBranch } from '../lib/template.mjs';
import { isNoTicket, normalizeTicketKey } from '../lib/ticket.mjs';
import { taskPath, workTreeOf } from '../lib/workspace.mjs';
import { mainCheckout } from '../lib/worktree.mjs';
import { emit, loadTaskContext, requireFlag } from './common.mjs';

const ROLES = ['implementer', 'reviewer'];

// Where the playbook continues after a rebind, by phase (D3). A confirmed task (phase confirm) is past
// O5 and ready for cw task start, so it resumes at O6.
const RESUME = {
  spec: ['O3', (id) => `cw spec show --task ${id}`],
  classify: ['O4', (id) => `cw classify --task ${id}`],
  confirm: ['O6', (id) => `cw task start --task ${id}`],
  implement: ['O7', (id) => `cw report show --task ${id} (when no implementer runs any more: cw task start --task ${id} --new-agent)`],
  review: ['O8', (id) => `cw review show --task ${id}`],
  deliver: ['O9', (id, task) => (task.specChanged ? `cw task return --task ${id} --spec-changed --note "<what changed>"` : `cw pr command --task ${id}`)],
  escalated: ['ask', (id) => `cw review show --task ${id}, then ask the user how to continue`],
};

function rebind(ctx) {
  const ws = ctx.workspace();
  const session = ctx.env.CLAUDE_CODE_SESSION_ID;
  if (!session) throw preconditionError('CLAUDE_CODE_SESSION_ID is not set, so there is no session to bind.', 'Run it from the Claude Code session that takes the task over.');
  const before = readTask(ws, ctx.flags.rebind);
  if (!isActive(before)) throw preconditionError(`Task ${before.id} has ended (${before.outcome}).`, 'Start a new task with cw task new.');
  const { task } = updateTask(ws, before.id, (current) => {
    current.ownerSession = session;
    current.sessions.push({ id: session, at: new Date().toISOString(), via: 'rebind' });
    current.history.push({ at: new Date().toISOString(), from: current.phase, to: current.phase, note: `rebound from ${before.ownerSession ?? 'no session'}`, by: 'cw task new --rebind' });
  }, { expectRev: before.rev });
  const [resumeAt, next] = RESUME[task.phase] ?? ['ask', () => 'Ask the user how to continue.'];
  // The agents of the earlier session: cw task review, task return and task start --new-agent give
  // them a fresh Agent call instead of a SendMessage.
  const staleAgents = ROLES.filter((role) => staleAgent(task, role)).map((role) => ({ role, id: task.agents[role].id, session: task.agents[role].session ?? null }));
  return {
    task: task.id,
    ticket: task.ticket,
    phase: task.phase,
    round: task.round,
    reviewRound: task.reviewRound,
    previousOwner: before.ownerSession,
    ownerSession: session,
    resumeAt,
    next: next(task.id, task),
    staleAgents,
  };
}

function create(ctx) {
  const ws = ctx.workspace();
  const ticket = normalizeTicketKey(ws.config, requireFlag(ctx.flags, 'ticket', 'Pass --ticket <KEY|NO-TICKET>.'));
  const slug = requireFlag(ctx.flags, 'slug', 'Pass --slug <2–4 lowercase words joined by hyphens>.');
  const title = requireFlag(ctx.flags, 'title', 'Pass --title "<short task title>".');
  const type = requireFlag(ctx.flags, 'type', 'Pass --type feature|bugfix|hotfix.');
  if (!isNoTicket(ws.config, ticket)) {
    const active = listTasks(ws, { ticket });
    if (active.length) {
      throw preconditionError(
        `Ticket ${ticket} has an active task: ${active.map((task) => `${task.id} (${task.phase})`).join(', ')}.`,
        `To continue it in this session: cw task new --rebind ${active[0].id}. To drop it: cw task end --task ${active[0].id} --outcome aborted.`,
      );
    }
  }
  const branch = renderBranch(ws.config.git.conventions, { ticket, type, slug, noTicket: isNoTicket(ws.config, ticket) });
  const repo = ws.mode === 'in-place' ? ws.workRepo : mainCheckout(ws);
  if (existsSync(repo) && branchExists(repo, branch)) {
    ctx.out.warn(`${branch} exists already in ${repo}; cw did not create it. Ask the user whose it is before the task starts.`);
  }
  const ownerSession = ctx.env.CLAUDE_CODE_SESSION_ID || null;
  if (!ownerSession) ctx.out.warn('CLAUDE_CODE_SESSION_ID is not set: the edit guard cannot bind this task to a session.');
  const task = createTask(ws, newTask(ws, { ticket, title, type, slug, branch, ownerSession }));
  const spec = taskPath(ws, task.id, 'spec.md');
  writeAtomic(spec, specTemplate(task));
  return {
    task: task.id,
    branch,
    spec,
    ownerSession,
    next: `cw ticket save --task ${task.id} (stdin JSON), then cw spec save --task ${task.id} (stdin Markdown), then cw spec lint --task ${task.id}`,
  };
}

export const commands = [
  {
    path: ['task', 'new'],
    group: 'orchestrator',
    usage: 'cw task new --ticket <KEY|NO-TICKET> --slug <slug> --title <title> --type feature|bugfix|hotfix | --rebind <id>',
    summary: 'Create a task (branch name from the git preset), or rebind an active task to this session',
    flags: { ticket: 'string', slug: 'string', title: 'string', type: 'string', rebind: 'string' },
    run(ctx) {
      if (ctx.flags.rebind && (ctx.flags.ticket || ctx.flags.slug || ctx.flags.title || ctx.flags.type)) {
        throw usageError('--rebind takes no other options', 'Run cw task new --rebind <id> alone.');
      }
      const result = ctx.flags.rebind ? rebind(ctx) : create(ctx);
      emit(ctx, result, (value) => {
        // A rebind names the playbook step to resume at, as --json does (resumeAt).
        ctx.out.print(`${value.task}${value.branch ? ` on ${value.branch}` : ` (${value.phase}), resume at ${value.resumeAt}`}. Next: ${value.next}`);
        if (value.staleAgents?.length) {
          ctx.out.print(`Agents of the earlier session (each gets a fresh Agent call, never a SendMessage): ${value.staleAgents.map((agent) => `${agent.role} ${agent.id}`).join(', ')}.`);
        }
      });
    },
  },
  {
    path: ['task', 'list'],
    group: 'orchestrator',
    usage: 'cw task list [--all] [--ticket <KEY>] [--json]',
    summary: 'List the active tasks (with --all also the ended ones)',
    flags: { all: 'boolean', ticket: 'string' },
    run(ctx) {
      const ws = ctx.workspace();
      const ticket = ctx.flags.ticket ? normalizeTicketKey(ws.config, ctx.flags.ticket) : undefined;
      const tasks = listTasks(ws, { all: Boolean(ctx.flags.all), ticket, onWarn: (text) => ctx.out.warn(text) });
      const rows = tasks.map((task) => ({ id: task.id, ticket: task.ticket, phase: task.phase, complexity: task.complexity ?? '', owner: task.ownerSession ?? '', title: task.title }));
      emit(ctx, { tasks: rows }, (value) => ctx.out.print(value.tasks.length ? ctx.out.table(value.tasks, ['id', 'ticket', 'phase', 'complexity', 'owner', 'title']) : 'No tasks.'));
    },
  },
  {
    path: ['task', 'show'],
    group: 'orchestrator',
    usage: 'cw task show --task <id> [--json]',
    summary: 'Print a task',
    flags: { task: 'string' },
    run(ctx) {
      const { task } = loadTaskContext(ctx);
      emit(ctx, task, (value) => {
        ctx.out.print(`${value.id} · ${value.ticket} · ${value.title}`);
        ctx.out.print(`phase ${value.phase}${value.outcome ? ` (ended: ${value.outcome})` : ''} · complexity ${value.complexity ?? '-'} · round ${value.round} · review round ${value.reviewRound}`);
        ctx.out.print(`branch ${value.branch} · base ${value.base ? `${value.base.branch}@${value.base.commit.slice(0, 10)}` : '-'} · work tree ${value.workTree ?? '-'}`);
        if (value.prUrl) ctx.out.print(`PR ${value.prUrl}`);
      });
    },
  },
  {
    path: ['task', 'confirm'],
    group: 'orchestrator',
    usage: 'cw task confirm --task <id> --note <what the user confirmed>',
    summary: 'Record the user confirmation of the spec and the complexity (O5)',
    flags: { task: 'string', note: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const note = requireFlag(ctx.flags, 'note', 'Pass --note "<what the user confirmed>".');
      if (!task.complexity) throw preconditionError(`Task ${task.id} has no complexity yet.`, `Classify first: cw classify --task ${task.id} --set <c> --why "…".`);
      updateTask(ws, task.id, (current) => {
        transition(current, 'confirm', { note, by: 'cw task confirm' });
        current.confirmation = { note, at: new Date().toISOString() };
      }, { expectRev: task.rev });
      emit(ctx, { task: task.id, phase: 'confirm', next: `cw task start --task ${task.id}` }, (value) => ctx.out.print(`Confirmed. Next: ${value.next}`));
    },
  },
  {
    path: ['task', 'agent'],
    group: 'orchestrator',
    usage: 'cw task agent --task <id> --role implementer|reviewer --id <agentId>',
    summary: 'Record the id the Agent tool returned and the session it runs in, for SendMessage later (O6, O8)',
    flags: { task: 'string', role: 'string', id: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const role = requireFlag(ctx.flags, 'role', 'Pass --role implementer|reviewer.');
      if (!ROLES.includes(role)) throw usageError(`--role ${role} is not a role`, 'Use --role implementer or --role reviewer.');
      const id = requireFlag(ctx.flags, 'id', 'Pass --id <the agentId the Agent tool returned>.');
      const previous = task.agents[role]?.id;
      if (previous && previous !== id) ctx.out.warn(`The ${role} of ${task.id} was recorded as ${previous}; it is now ${id}.`);
      // The session tells a later rebind (D3) that this agent belongs to an earlier session.
      const session = ctx.env.CLAUDE_CODE_SESSION_ID || null;
      updateTask(ws, task.id, (current) => {
        current.agents[role] = { ...(current.agents[role] ?? {}), id, round: current.agents[role]?.round ?? current.round, session };
      }, { expectRev: task.rev });
      emit(ctx, { task: task.id, role, id }, () => ctx.out.print(`Recorded ${role} ${id} for ${task.id}.`));
    },
  },
  {
    path: ['task', 'end'],
    group: 'orchestrator',
    usage: 'cw task end --task <id> --outcome done|escalated|aborted [--note <text>]',
    summary: 'End a task (O10); done needs the deliver phase and a recorded PR or a skip reason',
    flags: { task: 'string', outcome: 'string', note: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const outcome = requireFlag(ctx.flags, 'outcome', 'Pass --outcome done|escalated|aborted.');
      if (!OUTCOMES.includes(outcome)) throw usageError(`--outcome ${outcome} is not an outcome`, `Use --outcome ${OUTCOMES.join('|')}.`);
      if (outcome === 'done') {
        if (task.specChanged) throw preconditionError(`The spec of ${task.id} changed after the review.`, `Restart the cycle: cw task return --task ${task.id} --spec-changed --note "<what changed>".`);
        if (task.phase === 'deliver' && !task.prUrl && !task.noPrReason) {
          throw preconditionError(`Task ${task.id} has no recorded PR/MR.`, `Record it: cw pr record --task ${task.id} --url <url>, or --skipped "<reason>".`);
        }
      }
      const { task: ended } = updateTask(ws, task.id, (current) => endTask(current, outcome, { note: ctx.flags.note ?? '', by: 'cw task end' }), { expectRev: task.rev });
      const tree = workTreeOf(ws, ended);
      if (ws.mode === 'in-place' && tree && currentBranch(tree) === ended.branch) {
        ctx.out.warn(`${tree} is still on ${ended.branch}; switch it back with cw task cleanup --task ${ended.id}.`);
      }
      emit(ctx, { task: ended.id, outcome: ended.outcome, prUrl: ended.prUrl }, (value) => ctx.out.print(`Ended ${value.task}: ${value.outcome}.`));
    },
  },
];
