// The task store under <git common dir>/dev-workflow/: task.json per task, the state.json index for the
// mod and the hooks, and the phase state machine. Every write is a read-modify-write under one lock (§8).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { implementerAgentType } from './brief.mjs';
import { readJson, withLock, writeJson } from './fsx.mjs';
import { preconditionError } from './out.mjs';
import { taskDir, taskPath } from './workspace.mjs';

export const PHASES = ['spec', 'classify', 'confirm', 'implement', 'review', 'deliver', 'done', 'escalated', 'aborted'];
export const OUTCOMES = ['done', 'escalated', 'aborted'];
export const STEPS_TOTAL = 8;
const ENDED_VISIBLE_MS = 10 * 60_000;

// Phase changes cw allows; ending a task is endTask's job.
export const TRANSITIONS = {
  spec: ['spec', 'classify'],
  classify: ['classify', 'spec', 'confirm', 'implement'],
  confirm: ['classify', 'spec', 'implement'],
  implement: ['review', 'classify'],
  review: ['implement', 'escalated', 'deliver'],
  deliver: ['implement', 'review'],
  escalated: ['implement'],
};

export const isActive = (task) => task.outcome === null;

// An agent recorded in another session than the task's owner: after a rebind (D3) the plan assumes the
// new session cannot reach it with SendMessage (§8 Decided in P2), so a fresh Agent call replaces it.
export function staleAgent(task, role) {
  const agent = task.agents[role];
  return Boolean(agent?.id) && (agent.session ?? null) !== (task.ownerSession ?? null);
}

export const taskIdOf = (branch) => branch.replaceAll('/', '__');

const iso = (now) => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
const lockPath = (ws) => join(ws.stateDir, 'state.lock');
const taskFile = (ws, id) => taskPath(ws, id, 'task.json');

// A new task object; fields come from cw task new.
export function newTask(ws, { ticket, title, type, slug, branch, ownerSession, base = null }, { now } = {}) {
  const at = iso(now);
  return {
    version: 1,
    rev: 0,
    id: taskIdOf(branch),
    ticket,
    title,
    type,
    slug,
    branch,
    mode: ws.mode,
    configRoot: ws.configRoot,
    workTree: ws.mode === 'in-place' ? ws.workRepo : null,
    agentBranch: null,
    phase: 'spec',
    outcome: null,
    round: 0,
    reviewRound: 0,
    cycle: 1,
    complexity: null,
    minComplexity: null,
    complexityOverride: null,
    classifyWhy: null,
    areas: [],
    packages: [],
    paths: [],
    base,
    ownerSession: ownerSession ?? null,
    sessions: [{ id: ownerSession ?? null, at, via: 'new' }],
    confirmation: null,
    resetPending: false,
    resumeBranch: false,
    resumeBranchBy: null,
    branchPreexisted: false,
    previousComplexity: null,
    specChanged: false,
    returnedWith: null,
    agents: { implementer: null, reviewer: null },
    stopBlocks: {},
    steps: { done: 0, total: STEPS_TOTAL, note: '' },
    prUrl: null,
    noPrReason: null,
    history: [{ at, from: null, to: 'spec', note: 'created', by: 'cw task new' }],
    createdAt: at,
    updatedAt: at,
    endedAt: null,
  };
}

function activeIdsHint(ws) {
  const ids = listTasks(ws).map((task) => task.id);
  return ids.length ? `Active tasks: ${ids.join(', ')}.` : 'There is no active task; start one with cw task new.';
}

export function readTask(ws, id) {
  const file = taskFile(ws, id);
  if (!existsSync(file)) throw preconditionError(`No task ${id} in ${ws.tasksDir}.`, `Pass an existing --task id. ${activeIdsHint(ws)}`);
  return readJson(file);
}

// Tasks in creation order; ended tasks only with all. Unreadable task files are skipped with onWarn.
export function listTasks(ws, { all = false, ticket, onWarn } = {}) {
  if (!existsSync(ws.tasksDir)) return [];
  const tasks = [];
  for (const id of readdirSync(ws.tasksDir)) {
    const file = taskFile(ws, id);
    if (!existsSync(file)) continue;
    try {
      tasks.push(readJson(file));
    } catch (error) {
      onWarn?.(`skipping ${file}: ${error.message}`);
    }
  }
  return tasks
    .filter((task) => (all || isActive(task)) && (!ticket || task.ticket === ticket))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Rewrites state.json from the task files: active tasks plus tasks ended in the last 10 minutes.
export function rebuildState(ws, { now } = {}) {
  const at = new Date(iso(now)).getTime();
  const entries = listTasks(ws, { all: true })
    .filter((task) => isActive(task) || at - Date.parse(task.endedAt ?? task.updatedAt) < ENDED_VISIBLE_MS)
    .map((task) => ({
      id: task.id,
      ticket: task.ticket,
      title: task.title,
      branch: task.branch,
      phase: task.phase,
      outcome: task.outcome,
      ownerSession: task.ownerSession,
      round: task.round,
      reviewRound: task.reviewRound,
      maxReviewRounds: ws.config.workflow.maxReviewRounds,
      cycle: task.cycle,
      complexity: task.complexity,
      areas: task.areas,
      packages: task.packages,
      agents: { implementer: task.agents.implementer?.id ?? null, reviewer: task.agents.reviewer?.id ?? null },
      descriptions: { implementer: task.agents.implementer?.description ?? null, reviewer: task.agents.reviewer?.description ?? null },
      steps: task.steps,
      prUrl: task.prUrl,
      updatedAt: task.updatedAt,
      endedAt: task.endedAt,
    }));
  writeJson(join(ws.stateDir, 'state.json'), { version: 1, updatedAt: iso(now), configRoot: ws.configRoot, mode: ws.mode, tasks: entries });
}

export function createTask(ws, task, { now } = {}) {
  return withLock(lockPath(ws), () => {
    if (existsSync(taskDir(ws, task.id))) {
      throw preconditionError(`Task ${task.id} exists already (also ended tasks keep their id).`, 'Choose another --slug.');
    }
    writeJson(taskFile(ws, task.id), task);
    rebuildState(ws, { now });
    return task;
  });
}

// Fresh read, rev check, mutate, rev+1, write task.json and state.json: all under the lock.
export function updateTask(ws, id, mutate, { expectRev, now } = {}) {
  return withLock(lockPath(ws), () => {
    const task = readTask(ws, id);
    if (expectRev !== undefined && task.rev !== expectRev) {
      throw preconditionError(`Task ${id} changed while this command ran.`, 'Run the command again.');
    }
    const result = mutate(task);
    task.rev += 1;
    task.updatedAt = iso(now);
    writeJson(taskFile(ws, id), task);
    rebuildState(ws, { now });
    return { task, result };
  });
}

// Moves the task to another phase; refuses edges outside TRANSITIONS (pure; call inside updateTask).
export function transition(task, to, { note = '', by, now } = {}) {
  if (!isActive(task)) throw preconditionError(`Task ${task.id} has ended (${task.outcome}).`, 'Start a new task with cw task new.');
  const allowed = TRANSITIONS[task.phase] ?? [];
  if (!allowed.includes(to)) {
    throw preconditionError(
      `Task ${task.id} cannot go from ${task.phase} to ${to}.`,
      allowed.length ? `From ${task.phase} the next phase is one of: ${allowed.join(', ')}.` : `${task.phase} has no next phase.`,
    );
  }
  task.history.push({ at: iso(now), from: task.phase, to, note, by });
  task.phase = to;
}

// Ends the task with an outcome; done only from deliver (pure; call inside updateTask).
export function endTask(task, outcome, { note = '', by, now } = {}) {
  if (!isActive(task)) throw preconditionError(`Task ${task.id} has ended already (${task.outcome}).`, 'Nothing to do; start a new task with cw task new.');
  if (!OUTCOMES.includes(outcome)) throw preconditionError(`Unknown outcome ${outcome}.`, `Use one of ${OUTCOMES.join(', ')}.`);
  if (outcome === 'done' && task.phase !== 'deliver') {
    throw preconditionError(`Task ${task.id} is in ${task.phase}; done needs the deliver phase.`, 'Finish the review and record the PR (cw pr record), or end with --outcome escalated or aborted.');
  }
  const at = iso(now);
  task.history.push({ at, from: task.phase, to: outcome, note, by });
  task.phase = outcome;
  task.outcome = outcome;
  task.endedAt = at;
}

// Whether the next ws setup continues the existing task branch, and why: 'keep' (cw task reset --keep),
// 'handover' (a new or returning implementer takes the branch over) or 'cleanup' (cw task cleanup saw
// the branch). cw task start keeps only the first two (pure; call inside updateTask).
export function setResumeBranch(task, resume, by = null) {
  task.resumeBranch = Boolean(resume);
  task.resumeBranchBy = resume ? by : null;
}

// Raises steps.done to n (never lowers it) for the mod's "step n/8".
export const markStep = (ws, id, n, note = '', options) =>
  updateTask(ws, id, (task) => {
    task.steps = { ...task.steps, done: Math.max(task.steps.done, n), note };
  }, options);

// A round file (report-<n>.json or review-<n>.json) of the task's current round.
export function readRoundFile(ws, task, kind, round = task.round) {
  const path = taskPath(ws, task.id, `${kind}-${round}.json`);
  return { path, data: existsSync(path) ? readJson(path) : null };
}

// SubagentStart (§9): the owner session's tasks that wait for an agent of this role in this round. An
// implementer counts only for a task of its complexity (agentType dev-workflow:implementer-<c>): in
// worktree mode one session can have several tasks in implement, and the hook must not hand B's
// implementer task A.
export function tasksAwaitingAgent(ws, { sessionId, role, agentType }) {
  const phase = role === 'implementer' ? 'implement' : 'review';
  return listTasks(ws).filter((task) =>
    task.ownerSession === sessionId
    && task.phase === phase
    && (role !== 'implementer' || agentType === implementerAgentType(task.complexity))
    && (!task.agents[role] || task.agents[role].round !== task.round || !task.agents[role].startedAt));
}

// The one task waiting for this agent; null when none or more than one waits (the hook then records
// nothing rather than guess).
export function findTaskAwaitingAgent(ws, query) {
  const waiting = tasksAwaitingAgent(ws, query);
  return waiting.length === 1 ? waiting[0] : null;
}

export const recordAgentStart = (ws, id, { role, agentId, agentType, at, session = null }, options) =>
  updateTask(ws, id, (task) => {
    task.agents[role] = { ...(task.agents[role] ?? {}), id: agentId, type: agentType, startedAt: at, round: task.round, session };
  }, options);

// SubagentStop (§9): counts the blocks per agent id; at most 2 are allowed.
export const bumpStopBlocks = (ws, id, agentId, options) =>
  updateTask(ws, id, (task) => {
    task.stopBlocks[agentId] = (task.stopBlocks[agentId] ?? 0) + 1;
    return task.stopBlocks[agentId];
  }, options).result;

// G-ORCH-EDIT (§9): the active tasks the session owns, from state.json only.
export function activeTasksOwnedBy(ws, sessionId) {
  if (!sessionId) return [];
  const state = readJson(join(ws.stateDir, 'state.json'), { tasks: [] });
  return state.tasks.filter((entry) => entry.outcome === null && entry.ownerSession === sessionId);
}
