// Orchestrator commands for the ticket snapshot and the spec (§6 O1, O3). The orchestrator writes both
// through stdin, because G-ORCH-EDIT blocks Write in its session once the task exists (D3).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareBrief } from '../lib/cycle.mjs';
import { readText, writeAtomic, writeJson } from '../lib/fsx.mjs';
import { tryGit } from '../lib/git.mjs';
import { failedError, preconditionError } from '../lib/out.mjs';
import { buildRulebook, ruleIdPrefixes } from '../lib/rules.mjs';
import { lintSpec } from '../lib/spec.mjs';
import { isActive, readRoundFile, staleAgent, transition, updateTask } from '../lib/task.mjs';
import { isNoTicket, normalizeTicketKey, ticketFileOf, validateSnapshot } from '../lib/ticket.mjs';
import { orchestratorTreeOf, taskPath } from '../lib/workspace.mjs';
import { emit, loadTaskContext, readStdinJson, readStdinText, requireFlag } from './common.mjs';

// Lints the stored spec against the task, the work repo and the project's active rules.
export function lintTaskSpec(ws, task, book = buildRulebook(ws)) {
  const text = readText(taskPath(ws, task.id, 'spec.md'), '');
  const tree = orchestratorTreeOf(ws, task);
  const tracked = new Set((tryGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: tree }) ?? '').split('\n').filter(Boolean));
  return lintSpec(text, {
    task,
    keyPattern: ws.config.tickets.keyPattern,
    ruleIds: new Set(book.rules.map((rule) => rule.id)),
    ruleIdPrefixes: ruleIdPrefixes(book),
    isKnownPath: (path) => tracked.has(path) || existsSync(join(tree, path)),
    appRoot: ws.mode === 'in-place' ? ws.appRoot : null,
  });
}

// The intake instructions per ticket source, for cw ticket context.
const SOURCE_REFERENCE = { jira: 'reference/jira.md', linear: 'reference/linear.md', local: 'reference/local.md' };

function printTicketContext(ctx, { ticket, source, file, exists }) {
  if (source === 'notes') return ctx.out.print(`${ticket} · no ticket: the command's notes are the ticket.`);
  const reference = `cw playbook read ${SOURCE_REFERENCE[source]}`;
  if (source === 'local') return ctx.out.print(`${ticket} · source local: the ticket is ${file} (${reference}).`);
  ctx.out.print(`${ticket} · source ${source}: read the ticket as ${reference} describes.`);
  if (!file) ctx.out.print('Context file: none (tickets.contextPath is not set).');
  else ctx.out.print(exists ? `Context file: ${file}; read it as technical context.` : `Context file: ${file} does not exist.`);
}

export const commands = [
  {
    path: ['ticket', 'context'],
    group: 'orchestrator',
    usage: 'cw ticket context --ticket <KEY> [--json]',
    summary: 'Name the ticket source of a key and its ticket or context file (tickets.contextPath)',
    flags: { ticket: 'string' },
    run(ctx) {
      const ws = ctx.workspace();
      const ticket = normalizeTicketKey(ws.config, requireFlag(ctx.flags, 'ticket', 'Pass the ticket key: cw ticket context --ticket <KEY>.'));
      const source = isNoTicket(ws.config, ticket) ? 'notes' : ws.config.tickets.source;
      const file = ticketFileOf(ws.config, ticket);
      const exists = file !== null && existsSync(join(ws.configRoot, file));
      if (source === 'local' && !exists) {
        throw preconditionError(`The ticket file ${file} of ${ticket} does not exist (tickets.source local).`, `Check the key with the user, or ask them to add ${file}.`);
      }
      emit(ctx, { ticket, source, file, exists }, (value) => printTicketContext(ctx, value));
    },
  },
  {
    path: ['ticket', 'save'],
    group: 'orchestrator',
    usage: 'cw ticket save --task <id> < <JSON file>',
    summary: 'Store the ticket snapshot (stdin JSON, bare or in a json fence)',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const input = readStdinJson(ctx, `cw ticket save --task ${task.id} < <scratchpad>/${task.id}-ticket-1.json`);
      const { value, errors } = validateSnapshot(ws.config, task, input);
      if (errors.length) throw failedError(`The ticket snapshot is invalid:\n- ${errors.join('\n- ')}`, 'Correct the JSON, write it to a new file and save it again.', { errors });
      const file = taskPath(ws, task.id, 'ticket.json');
      writeJson(file, value);
      emit(ctx, { task: task.id, file }, () => ctx.out.print(`Saved the ticket snapshot: ${file}`));
    },
  },
  {
    path: ['spec', 'save'],
    group: 'orchestrator',
    usage: 'cw spec save --task <id> < <Markdown file>',
    summary: 'Store the spec (stdin Markdown); a change after classification classifies again',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const text = readStdinText(ctx, `cw spec save --task ${task.id} < <scratchpad>/${task.id}-spec-1.md`);
      if (!isActive(task)) throw preconditionError(`Task ${task.id} has ended (${task.outcome}).`, 'Start a new task with cw task new.');
      // A blocked implementer waits for the answer, which may change the spec (O7).
      const waiting = task.phase === 'implement' && readRoundFile(ws, task, 'report').data?.status === 'blocked';
      // After an approval (still in review until the first pr command) a change restarts the cycle (O8).
      const approved = task.phase === 'review' && readRoundFile(ws, task, 'review').data?.status === 'approved';
      if (task.phase === 'implement' && !waiting) {
        throw preconditionError(`Task ${task.id} is in implement; the implementer works from the current spec.`, `Wait for its report (cw report show --task ${task.id}); the spec can change while the report is blocked.`);
      }
      if (task.phase === 'review' && !approved) {
        throw preconditionError(`Task ${task.id} is in review; the reviewer checks against the current spec.`, `Wait for the review (cw review show --task ${task.id}); the spec can change once it is approved, after an escalation, or while a report is blocked.`);
      }
      const { task: updated } = updateTask(ws, task.id, (current) => {
        if (['classify', 'confirm'].includes(current.phase)) {
          transition(current, 'spec', { note: 'spec changed', by: 'cw spec save' });
          current.complexity = null;
          current.confirmation = null;
        } else if (['deliver', 'escalated', 'review'].includes(current.phase)) {
          current.specChanged = true;
        }
      }, { expectRev: task.rev });
      const file = taskPath(ws, task.id, 'spec.md');
      writeAtomic(file, text.endsWith('\n') ? text : `${text}\n`);
      const brief = waiting ? prepareBrief(ws, updated, 'implementer').path : null;
      const implementer = updated.agents.implementer?.id;
      const answer = staleAgent(updated, 'implementer')
        ? `start a fresh implementer with the new brief: cw task start --task ${task.id} --new-agent (${implementer} belongs to an earlier session)`
        : `SendMessage ${implementer ?? '<implementer agentId>'} (the same implementer) the answer and that the spec and its brief ${brief} changed`;
      const next = updated.specChanged
        ? `cw task return --task ${task.id} --spec-changed --note "<what changed>"`
        : waiting
          ? `cw spec lint --task ${task.id}, then ${answer}`
          : `cw spec lint --task ${task.id}`;
      emit(ctx, { task: task.id, file, phase: updated.phase, next }, (value) => ctx.out.print(`Saved ${value.file}. Next: ${value.next}`));
    },
  },
  {
    path: ['spec', 'show'],
    group: 'orchestrator',
    usage: 'cw spec show --task <id> [--json]',
    summary: 'Print the spec',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const file = taskPath(ws, task.id, 'spec.md');
      const text = readText(file);
      if (text === null) throw preconditionError(`Task ${task.id} has no spec yet.`, `Write it: cw spec save --task ${task.id}.`);
      emit(ctx, { task: task.id, file, spec: text }, (value) => ctx.out.print(value.spec.trimEnd()));
    },
  },
  {
    path: ['spec', 'lint'],
    group: 'orchestrator',
    usage: 'cw spec lint --task <id> [--json]',
    summary: 'Check the spec: sections, numbering, testable criteria, header, paths and rule references',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const { errors, warnings } = lintTaskSpec(ws, task);
      if (errors.length) {
        const listed = [...errors.map((error) => `- error: ${error}`), ...warnings.map((warning) => `- warning: ${warning}`)].join('\n');
        throw failedError(`The spec of ${task.id} has ${errors.length} error(s):\n${listed}`, `Fix them and save the spec again: cw spec save --task ${task.id}.`, { errors, warnings });
      }
      emit(ctx, { task: task.id, ok: true, errors, warnings }, (value) => {
        for (const warning of value.warnings) ctx.out.print(`warning: ${warning}`);
        ctx.out.print(`The spec of ${task.id} is clean.`);
      });
    },
  },
];
