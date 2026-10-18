// Task state machine and files in <git-common-dir>/dev-workflow/ (spec 01 §5).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CwError, preconditionError } from './out.mjs';
import { readJson, withLockSync, writeJson } from './fsx.mjs';

export const PHASES = ['spec', 'classify', 'confirm', 'implement', 'review', 'deliver', 'done', 'escalated', 'aborted'];
const FINAL = new Set(['done', 'aborted']);
const ACTIVE = new Set(['spec', 'classify', 'confirm', 'implement', 'review', 'deliver', 'escalated']);

const TRANSITIONS = {
  spec: ['classify', 'aborted'],
  classify: ['confirm', 'implement', 'classify', 'aborted'],
  confirm: ['implement', 'classify', 'aborted'],
  implement: ['review', 'classify', 'escalated', 'aborted'],
  review: ['implement', 'deliver', 'escalated', 'review', 'aborted'],
  deliver: ['done', 'implement', 'review', 'aborted'],
  escalated: ['implement', 'aborted', 'done'],
  done: [],
  aborted: [],
};

export const taskIdOf = (branch) => branch.replace(/\//g, '__');
export const tasksDir = (ctx) => join(ctx.stateDir, 'tasks');
export const taskDir = (ctx, id) => join(tasksDir(ctx), id);
const taskFile = (ctx, id) => join(taskDir(ctx, id), 'task.json');
const stateLock = (ctx) => join(ctx.stateDir, 'state.lock');
const now = () => new Date().toISOString();

export function loadTask(ctx, id) {
  const task = readJson(taskFile(ctx, id), null);
  if (!task) throw preconditionError(`No task ${id}. Known: ${listTasks(ctx, { all: true }).map((t) => t.id).join(', ') || 'none'}`);
  return task;
}

export function listTasks(ctx, { all = false } = {}) {
  if (!existsSync(tasksDir(ctx))) return [];
  return readdirSync(tasksDir(ctx))
    .map((id) => readJson(taskFile(ctx, id), null))
    .filter(Boolean)
    .filter((task) => all || ACTIVE.has(task.phase) || (Date.now() - Date.parse(task.updatedAt) < 10 * 60_000))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function writeStateIndex(ctx, profile) {
  const tasks = listTasks(ctx).map((task) => ({
    id: task.id,
    ticket: task.ticket,
    title: task.title,
    phase: task.phase,
    round: task.round,
    maxRounds: profile?.workflow?.maxReviewRounds ?? 3,
    complexity: task.complexity,
    areas: task.areas,
    prUrl: task.prUrl,
    agents: Object.fromEntries(Object.entries(task.agents).map(([role, agent]) => [role, agent.id ?? null])),
    descriptions: Object.fromEntries(Object.entries(task.agents).map(([role, agent]) => [role, agent.description ?? null])),
    steps: task.steps,
    parent: task.parent,
  }));
  writeJson(join(ctx.stateDir, 'state.json'), { version: 1, updatedAt: now(), tasks });
}

export function saveTask(ctx, task, profile) {
  withLockSync(stateLock(ctx), () => {
    task.updatedAt = now();
    writeJson(taskFile(ctx, task.id), task);
    writeStateIndex(ctx, profile);
  });
  return task;
}

export function createTask(ctx, profile, fields) {
  const id = taskIdOf(fields.branch);
  if (existsSync(taskFile(ctx, id))) {
    const existing = readJson(taskFile(ctx, id));
    if (!FINAL.has(existing.phase)) throw preconditionError(`Task ${id} already exists in phase ${existing.phase}.`);
  }
  const task = {
    version: 1,
    id,
    ticket: fields.ticket,
    title: fields.title,
    type: fields.type ?? 'feature',
    phase: 'spec',
    round: 0,
    complexity: null,
    complexityOverride: null,
    areas: [],
    packages: [],
    branch: fields.branch,
    buildsOn: fields.buildsOn ?? null,
    parent: fields.parent ?? null,
    subtasks: [],
    base: null,
    worktree: null,
    agents: {},
    steps: { done: 0, total: 9, note: '' },
    claim: fields.claim ?? null,
    prUrl: null,
    outcome: null,
    confirmation: null,
    stopAttempts: {},
    history: [{ at: now(), from: null, to: 'spec', note: 'created' }],
    createdAt: now(),
    updatedAt: now(),
  };
  return saveTask(ctx, task, profile);
}

export function transition(ctx, profile, task, to, { note = '', check } = {}) {
  if (!PHASES.includes(to)) throw new CwError(`Unknown phase ${to}`);
  const allowed = TRANSITIONS[task.phase] ?? [];
  if (!allowed.includes(to)) {
    throw preconditionError(`Task ${task.id} is in phase ${task.phase}; ${to} is not allowed from there (allowed: ${allowed.join(', ') || 'none'}).`);
  }
  if (check) check(task);
  task.history.push({ at: now(), from: task.phase, to, note });
  task.phase = to;
  return saveTask(ctx, task, profile);
}

export function resolveTaskId(ctx, value) {
  if (value && value !== 'current' && value !== true) return taskIdOf(String(value));
  const tasks = listTasks(ctx).filter((task) => ACTIVE.has(task.phase));
  const inWorktree = tasks.filter((task) => task.worktree && (ctx.cwd === task.worktree || ctx.cwd.startsWith(`${task.worktree}/`) || ctx.repoRoot === task.worktree));
  if (inWorktree.length === 1) return inWorktree[0].id;
  if (tasks.length === 1) return tasks[0].id;
  if (tasks.length === 0) throw preconditionError('No active task. Pass --task <id>.');
  throw preconditionError(`Several active tasks; pass --task <id>: ${tasks.map((task) => task.id).join(', ')}`);
}

export const taskPath = (ctx, task, name) => join(taskDir(ctx, task.id), name);

export function setSteps(ctx, profile, task, done, note) {
  if (task.steps.done >= done && !note) return task;
  task.steps = { done: Math.max(task.steps.done, done), total: task.steps.total ?? 9, note: note ?? task.steps.note };
  return saveTask(ctx, task, profile);
}
