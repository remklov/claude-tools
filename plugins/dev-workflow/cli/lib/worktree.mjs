// Claude Code's agent worktrees (D5, S4): where the main checkout is, and how cw removes a clean task
// worktree with its agent branch. Used by task reset, the agent handover of task return and task
// cleanup. No command here rewrites .git/config (§8).
import { lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { branchExists, deleteBranch, git, gitResult } from './git.mjs';
import { quote } from './host/index.mjs';
import { CwError, preconditionError } from './out.mjs';
import { resolveGitDirs } from './workspace.mjs';

const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

// The main checkout, also when cw runs inside an agent worktree. A submodule's git dir names its work
// tree in core.worktree. A separate git dir (git clone --separate-git-dir) names none: its main
// checkout is the nearest directory at or above the work repo whose .git points at the common dir.
// Otherwise it is the parent of the common dir (git 2.54: `git worktree list` reports the git dir
// itself in both special cases, so it does not help).
export function mainCheckout(ws) {
  const configured = gitResult(['--git-dir', ws.commonDir, 'config', '--get', 'core.worktree'], { cwd: ws.commonDir });
  if (configured.code === 0 && configured.stdout.trim()) return resolve(ws.commonDir, configured.stdout.trim());
  const common = real(ws.commonDir);
  for (let dir = ws.repoRoot; dir; ) {
    const dirs = resolveGitDirs(dir);
    if (!dirs) break;
    if (real(dirs.gitDir) === common) return dirs.repoRoot;
    const parent = dirname(dirs.repoRoot);
    dir = parent === dirs.repoRoot ? null : parent;
  }
  return dirname(ws.commonDir);
}

// The agent branch Claude Code created for a worktree: recorded by ws setup, else from the directory name.
export const agentBranchOf = (task) =>
  task.agentBranch ?? (task.workTree && basename(task.workTree).startsWith('agent-') ? `worktree-${basename(task.workTree)}` : null);

// Untracked node_modules symlinks (worktree.symlinkDirectories, S4): `git worktree remove` without
// --force refuses a worktree that has them, and unlinking removes only the link.
export function linkedNodeModules(workTree) {
  const entries = gitResult(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: workTree }).stdout.split('\0');
  return entries
    .filter((entry) => entry.startsWith('?? ') && /(^|\/)node_modules$/.test(entry.slice(3)))
    .map((entry) => join(workTree, entry.slice(3)))
    .filter((path) => lstatSync(path).isSymbolicLink());
}

// The sandbox lets git delete a worktree's directory but not its record under .git/worktrees (observed
// in the P3 dry run, CLI 2.1.308: "failed to delete '.git/worktrees/<name>': Operation not permitted").
const DENIED = /Operation not permitted|Permission denied/;

function worktreeGit(mainRoot, args) {
  const result = gitResult(['worktree', ...args], { cwd: mainRoot });
  if (result.code === 0) return;
  const stderr = result.stderr.trim();
  if (DENIED.test(stderr)) {
    throw preconditionError(
      `git worktree ${args.join(' ')} could not finish in ${mainRoot}: ${stderr.split('\n')[0]}`,
      `Run the same cw command again outside the sandbox (only git's record of the worktree is left), or ask the user to run git -C ${quote(mainRoot)} worktree prune.`,
      { cwd: mainRoot, stderr },
    );
  }
  throw new CwError(`git worktree ${args.join(' ')} failed in ${mainRoot}: ${stderr}`, { details: { cwd: mainRoot, stderr } });
}

// Removes a clean worktree (the caller checked it); never --force.
export function removeWorktree(mainRoot, workTree) {
  for (const link of linkedNodeModules(workTree)) unlinkSync(link);
  worktreeGit(mainRoot, ['remove', workTree]);
}

// Forgets worktrees whose directory is gone; git keeps their branches checked out until then.
export const pruneWorktrees = (mainRoot) => worktreeGit(mainRoot, ['prune']);

// Whether git still lists the worktree (also as prunable, after its directory went away).
export const isListedWorktree = (mainRoot, workTree) =>
  git(['worktree', 'list', '--porcelain'], { cwd: mainRoot }).split('\n').some((line) => line.startsWith('worktree ') && real(line.slice('worktree '.length)) === real(workTree));

// The work tree that has the branch checked out, from `git worktree list --porcelain`; null if none.
export function worktreeHolding(mainRoot, branch) {
  let path = null;
  for (const line of git(['worktree', 'list', '--porcelain'], { cwd: mainRoot }).split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

// Deletes a local branch if it exists. deleteBranch tolerates the sandbox's .git/config warning (S8).
export function dropBranch(mainRoot, branch) {
  if (!branch || !branchExists(mainRoot, branch)) return { removed: null, warning: null };
  const { warning } = deleteBranch(mainRoot, branch);
  return { removed: branch, warning: warning ?? null };
}

// Deletes the task's agent branch only when every commit on it is on another branch or remote-tracking
// ref too: an implementer that committed before cw ws setup left work there that nothing else holds.
// `--exclude` takes the short branch name before `--branches` (git 2.54, git-rev-list(1)).
export function dropAgentBranch(mainRoot, task) {
  const agent = agentBranchOf(task);
  if (!agent || !branchExists(mainRoot, agent)) return { removed: null, warning: null };
  const unique = Number(git(['rev-list', '--count', `refs/heads/${agent}`, '--not', `--exclude=${agent}`, '--branches', '--remotes'], { cwd: mainRoot }));
  if (unique > 0) {
    return { removed: null, warning: `kept ${agent}: ${unique} commit(s) on it are on no other branch; ask the user whether to keep them (git branch -D ${agent} deletes them).` };
  }
  return dropBranch(mainRoot, agent);
}
