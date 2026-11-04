// Overlap with the other open tasks (ADR 0022), checked by cw task start before a round starts. Two
// tasks that change the same file conflict at the second PR; two that change the same exclusive area
// (workflow.exclusivePaths, such as migrations or a lock file) can break the base without a conflict.
// Open are the started active tasks and the tasks that ended done whose branch origin's base does not
// hold yet. A task still in its spec meets the overlap at its own start.
import { taskChangedFiles } from './cycle.mjs';
import { gitResult } from './git.mjs';
import { matchGlob } from './glob.mjs';
import { isActive, listTasks } from './task.mjs';
import { orchestratorTreeOf } from './workspace.mjs';

// A squash merge leaves the branch's commits unknown to the base: such a task counts as open until
// this long after it ended.
const UNMERGED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const trimSlash = (path) => path.replace(/\/+$/, '');
// The same file, or a directory and a file in it (the spec may name a directory).
const samePath = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function branchFiles(repo, task) {
  if (!task.base?.commit) return [];
  const result = gitResult(['diff', '--name-only', '--no-renames', '-z', `${task.base.commit}...${task.branch}`], { cwd: repo });
  return result.code === 0 ? result.stdout.split('\0').filter(Boolean) : [];
}

// Commits of the branch that origin's base holds neither as such nor as the same patch (git cherry).
function unmerged(repo, task) {
  const base = task.base?.branch;
  if (!base) return false;
  const upstream = gitResult(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], { cwd: repo }).code === 0 ? `origin/${base}` : base;
  const cherry = gitResult(['cherry', upstream, task.branch], { cwd: repo });
  return cherry.code === 0 && cherry.stdout.split('\n').some((line) => line.startsWith('+ '));
}

function isOpen(repo, task, now) {
  if (isActive(task)) return task.round >= 1;
  if (task.outcome !== 'done' || !task.endedAt || now - Date.parse(task.endedAt) > UNMERGED_DAYS * DAY_MS) return false;
  return unmerged(repo, task);
}

// What the task changes or plans to change: its spec's paths, its branch, and an active task's work tree.
function touchedPaths(ws, repo, task) {
  const changed = isActive(task) && task.workTree ? taskChangedFiles(ws, task) : branchFiles(repo, task);
  return [...new Set([...(task.paths ?? []), ...changed].map(trimSlash))];
}

// [{ task, ticket, phase, ended, prUrl, files, exclusive, packages }] per open task that shares a path,
// an exclusive area or a package with the task. files and exclusive need the user's decision;
// packages alone are a note.
export function findOverlaps(ws, task, { now = Date.now() } = {}) {
  const mine = (task.paths ?? []).map(trimSlash);
  const exclusivePaths = ws.config.workflow.exclusivePaths;
  const repo = orchestratorTreeOf(ws, null);
  const overlaps = [];
  for (const other of listTasks(ws, { all: true })) {
    if (other.id === task.id || !isOpen(repo, other, now)) continue;
    const theirs = touchedPaths(ws, repo, other);
    const files = theirs.filter((path) => mine.some((own) => samePath(own, path)));
    const exclusive = exclusivePaths.filter((glob) => mine.some((path) => matchGlob(path, glob)) && theirs.some((path) => matchGlob(path, glob)));
    const packages = (task.packages ?? []).filter((pkg) => (other.packages ?? []).includes(pkg));
    if (!files.length && !exclusive.length && !packages.length) continue;
    overlaps.push({ task: other.id, ticket: other.ticket, phase: other.phase, ended: !isActive(other), prUrl: other.prUrl ?? null, files, exclusive, packages });
  }
  return overlaps;
}

export const needsDecision = (overlap) => overlap.files.length > 0 || overlap.exclusive.length > 0;

// One line per overlap, for the refusal and the output of the start.
export function overlapLine(overlap) {
  const where = overlap.ended ? `ended, PR ${overlap.prUrl ?? 'unknown'} not merged` : `phase ${overlap.phase}`;
  const parts = [];
  if (overlap.files.length) parts.push(`files ${overlap.files.join(', ')}`);
  if (overlap.exclusive.length) parts.push(`exclusive ${overlap.exclusive.join(', ')}`);
  if (overlap.packages.length) parts.push(`packages ${overlap.packages.join(', ')}`);
  return `${overlap.task} (${overlap.ticket}, ${where}): ${parts.join('; ')}`;
}
