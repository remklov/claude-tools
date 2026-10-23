// The task's work tree (D5): where it is, and cw ws setup (§6 implementer step 1, Decided in P2).
// In-place, a clean app/ on the recorded base branch gets the task branch at its HEAD. In worktree mode
// the agent's isolated worktree (the cwd) gets the task branch at base.commit with git switch -c, never
// a rename, which would rewrite .git/config (§8, S8). With task.resumeBranch set, both continue the
// existing task branch of an earlier implementer instead.
import { existsSync, realpathSync } from 'node:fs';
import { branchExists, currentBranch, git, gitResult, headCommit, statusEntries, tryGit } from './git.mjs';
import { preconditionError } from './out.mjs';
import { markStep, setResumeBranch, updateTask } from './task.mjs';
import { resolveGitDirs, workTreeOf } from './workspace.mjs';

const AGENT_BRANCH = /^worktree-agent-/;
const BLOCKED = 'Report blocked';

export const listFiles = (files, max = 10) => `${files.slice(0, max).join(', ')}${files.length > max ? ', …' : ''}`;

// The task's work tree from task.json (in-place: appRoot), never from the cwd; exit 3 before ws setup.
export function requireWorkTree(ws, task) {
  const workTree = workTreeOf(ws, task);
  if (!workTree) {
    throw preconditionError(`Task ${task.id} has no work tree yet.`, `Run cw ws setup --task ${task.id} in the implementer's isolated worktree first.`);
  }
  if (!existsSync(workTree)) {
    throw preconditionError(`The work tree ${workTree} of task ${task.id} does not exist.`, 'Ask the orchestrator: the worktree was removed or appRoot is not cloned.');
  }
  return workTree;
}

function requireBase(task) {
  if (!task.base?.branch || !task.base?.commit) {
    throw preconditionError(`Task ${task.id} has no recorded base.`, `${BLOCKED}; the orchestrator starts the task with cw task start --task ${task.id}.`);
  }
}

// In worktree mode a commit would land on the agent branch, which the task branch never sees.
function requireClean(workTree, mode) {
  const dirty = statusEntries(workTree).map((entry) => entry.path);
  if (dirty.length) {
    throw preconditionError(
      `${workTree} has uncommitted changes (${dirty.length} files: ${listFiles(dirty)}).`,
      `${BLOCKED}; the orchestrator asks the user to ${mode === 'worktree' ? 'stash or discard' : 'commit or stash'} them.`,
    );
  }
}

function requireNoTaskBranch(workTree, task) {
  if (branchExists(workTree, task.branch) && task.branchPreexisted) {
    throw preconditionError(
      `The task branch ${task.branch} exists already; it existed before cw task start, so cw did not create it.`,
      `${BLOCKED}; the orchestrator asks the user whose branch it is (cw task reset refuses to delete it).`,
    );
  }
  if (branchExists(workTree, task.branch)) {
    throw preconditionError(
      `The task branch ${task.branch} exists already (from an earlier implementer).`,
      `${BLOCKED}; the orchestrator resets the task (cw task reset --task ${task.id}).`,
    );
  }
}

function setupInPlace(ws, task) {
  const workTree = workTreeOf(ws, task);
  const top = existsSync(workTree) ? tryGit(['rev-parse', '--show-toplevel'], { cwd: workTree }) : null;
  if (!top || realpathSync(top) !== realpathSync(workTree)) {
    throw preconditionError(`The work repo ${workTree} (workspace.appRoot) is not a git repository of its own.`, `${BLOCKED}; the user clones the application into ${ws.appRoot}.`);
  }
  requireBase(task);
  const branch = currentBranch(workTree);
  if (branch === task.branch) return { workTree, base: task.base, created: false, agentBranch: null };
  requireClean(workTree, ws.mode);
  if (branch !== task.base.branch) {
    throw preconditionError(
      `${workTree} is on ${branch || 'a detached HEAD'}, not on the recorded base ${task.base.branch}.`,
      `${BLOCKED}; the orchestrator asks the user to switch ${ws.appRoot} back to ${task.base.branch}.`,
    );
  }
  if (task.resumeBranch && branchExists(workTree, task.branch)) {
    // app/ left the task branch (task cleanup, or a kept branch after a misclassification): go back to it.
    git(['switch', '--quiet', task.branch], { cwd: workTree });
    return { workTree, base: task.base, created: false, agentBranch: null };
  }
  requireNoTaskBranch(workTree, task);
  const head = headCommit(workTree);
  // An explicit start point and --no-track: with branch.autoSetupMerge=always|inherit, git would
  // otherwise write the base's upstream for the task branch into .git/config (git 2.54).
  git(['switch', '--quiet', '--no-track', '-c', task.branch, head], { cwd: workTree });
  return { workTree, base: { ...task.base, commit: head }, created: true, agentBranch: null };
}

// Commits on the agent worktree's HEAD that neither the base nor any other branch or remote-tracking
// ref holds: switching away would leave them on the agent branch only.
function unsharedCommits(workTree, agentBranch, baseCommit) {
  const exclude = agentBranch ? [`--exclude=${agentBranch}`] : [];
  return Number(git(['rev-list', '--count', 'HEAD', '--not', baseCommit, ...exclude, '--branches', '--remotes'], { cwd: workTree }));
}

function setupWorktree(ws, task, cwd) {
  const top = tryGit(['rev-parse', '--show-toplevel'], { cwd });
  if (!top) throw preconditionError(`${cwd} is not inside a git work tree.`, `${BLOCKED}; run cw ws setup in your isolated worktree.`);
  const workTree = realpathSync(top);
  const dirs = resolveGitDirs(workTree);
  const linked = realpathSync(dirs.gitDir) !== realpathSync(dirs.commonDir);
  if (!linked || realpathSync(dirs.commonDir) !== realpathSync(ws.commonDir)) {
    throw preconditionError(
      `cw ws setup runs inside your isolated worktree; ${workTree} is ${linked ? 'a worktree of another repository' : 'the main checkout'}.`,
      `${BLOCKED}; the orchestrator delegates with isolation "worktree".`,
    );
  }
  const branch = currentBranch(workTree);
  if (branch === task.branch) return { workTree, base: task.base, created: false, agentBranch: task.agentBranch ?? null };
  if (branch && !AGENT_BRANCH.test(branch)) {
    throw preconditionError(`${workTree} is on ${branch}, not on the worktree-agent-* branch Claude Code created.`, `${BLOCKED}; the orchestrator delegates with isolation "worktree".`);
  }
  requireClean(workTree, ws.mode);
  requireBase(task);
  if (gitResult(['rev-parse', '--verify', '--quiet', `${task.base.commit}^{commit}`], { cwd: workTree }).code !== 0) {
    throw preconditionError(`The base commit ${task.base.commit} does not exist in ${workTree}.`, `${BLOCKED}; the orchestrator restarts the task.`);
  }
  const unshared = unsharedCommits(workTree, branch, task.base.commit);
  if (unshared) {
    throw preconditionError(
      `${workTree} has ${unshared} commit(s) on ${branch || 'a detached HEAD'} that no other branch holds; the task branch would leave them behind.`,
      `${BLOCKED}; the orchestrator asks the user whether to keep them (on a branch of their own) or drop them, then delegates again.`,
    );
  }
  if (task.resumeBranch && branchExists(workTree, task.branch)) {
    // The previous agent's worktree was released (a new agent, task cleanup, task reset --keep):
    // continue its branch.
    git(['switch', '--quiet', task.branch], { cwd: workTree });
    return { workTree, base: task.base, created: false, agentBranch: branch || null };
  }
  requireNoTaskBranch(workTree, task);
  git(['switch', '--quiet', '-c', task.branch, task.base.commit], { cwd: workTree });
  return { workTree, base: task.base, created: true, agentBranch: branch || null };
}

// Creates (or confirms) the task branch in the task's work tree and records workTree, base and the
// agent branch. Idempotent: a work tree already on the task branch is left as it is.
export function setupWorkTree(ws, task, { cwd }) {
  if (task.phase !== 'implement') {
    throw preconditionError(`cw ws setup needs phase implement; task ${task.id} is in ${task.phase}.`, `${BLOCKED}; the orchestrator runs cw task start --task ${task.id}.`);
  }
  const result = ws.mode === 'in-place' ? setupInPlace(ws, task) : setupWorktree(ws, task, cwd);
  updateTask(ws, task.id, (current) => {
    current.workTree = result.workTree;
    current.base = result.base;
    current.agentBranch = result.agentBranch;
    setResumeBranch(current, false);
  });
  markStep(ws, task.id, 1, 'workspace');
  return { task: task.id, mode: ws.mode, workTree: result.workTree, branch: task.branch, base: result.base, created: result.created, agentBranch: result.agentBranch };
}
