// The base branch brought up to date with origin (ADR 0021): before the orchestrator reads the code for
// the spec (cw ticket context, O1) and before the task branch starts from it (cw task start). cw used
// the local branch as it was, so a stale checkout gave a spec against old code and a task branch on an
// old base. Only a fast-forward: local commits, a diverged branch, a checkout in another worktree or
// local changes in the files the update touches leave the branch as it is, and the user decides.
// Nothing here rewrites .git/config (§8).
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, gitResult, lines, tryGit } from './git.mjs';
import { mainCheckout } from './worktree.mjs';

const REMOTE = 'origin';
const FETCH_TIMEOUT_MS = 60_000;
// A fetch that needs a password fails at once instead of waiting for input that never comes.
const FETCH_ENV = { GIT_TERMINAL_PROMPT: '0' };
// The states the orchestrator asks the user about: go on with the local base, or stop.
const ASK_USER = new Set(['fetch-failed', 'no-upstream', 'no-branch', 'ahead', 'diverged', 'elsewhere', 'blocked', 'error']);

const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};
const commitOf = (repo, ref) => tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repo });
const countCommits = (repo, range) => Number(git(['rev-list', '--count', range], { cwd: repo }));
// git's message in one line: the reason of a failed fetch or merge.
const reasonOf = (result) => (result.stderr.trim() || result.stdout.trim()).split('\n').map((line) => line.trim()).filter(Boolean).join(' ').slice(0, 300);

// The worktree that has the branch checked out, or null.
function checkoutOf(repo, branch) {
  let path = null;
  for (const line of lines(git(['worktree', 'list', '--porcelain'], { cwd: repo }))) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

// { state, branch, remote, needsUser, ... }. state: updated, current, off (git.updateBase false),
// no-repo, no-remote, or one of ASK_USER. commit is the local branch's tip afterwards. A git failure
// of its own is the state error: the update never stops the command it runs in.
export function updateBase(ws, branch = ws.config.git.defaultBase) {
  const result = (state, extra = {}) => ({ state, branch, remote: `${REMOTE}/${branch}`, needsUser: ASK_USER.has(state), ...extra });
  if (!ws.config.git.updateBase) return result('off');
  try {
    return fastForward(ws, branch, result);
  } catch (error) {
    return result('error', { reason: String(error.message).split('\n')[0].slice(0, 300) });
  }
}

function fastForward(ws, branch, result) {
  const repo = ws.mode === 'in-place' ? ws.workRepo : mainCheckout(ws);
  if (!existsSync(repo)) return result('no-repo');
  if (!tryGit(['remote', 'get-url', REMOTE], { cwd: repo })) return result('no-remote');
  // All branches: cw ticket context also looks for the key on the remote-tracking branches.
  const fetched = gitResult(['fetch', '--quiet', REMOTE], { cwd: repo, env: FETCH_ENV, timeoutMs: FETCH_TIMEOUT_MS });
  if (fetched.code !== 0) return result('fetch-failed', { reason: reasonOf(fetched) });
  const upstream = commitOf(repo, `refs/remotes/${REMOTE}/${branch}`);
  if (!upstream) return result('no-upstream');
  const local = commitOf(repo, `refs/heads/${branch}`);
  if (!local) return result('no-branch');
  if (local === upstream) return result('current', { commit: local });
  const behind = countCommits(repo, `${local}..${upstream}`);
  const ahead = countCommits(repo, `${upstream}..${local}`);
  if (!behind) return result('ahead', { commit: local, ahead });
  if (ahead) return result('diverged', { commit: local, ahead, behind });
  const checkout = checkoutOf(repo, branch);
  if (checkout && real(checkout) !== real(repo)) return result('elsewhere', { commit: local, behind, path: checkout });
  // Checked out here: the merge moves the files with the branch and refuses to overwrite local changes.
  // Not checked out: the ref moves alone, and only from the commit read above.
  const moved = checkout
    ? gitResult(['merge', '--ff-only', '--quiet', `${REMOTE}/${branch}`], { cwd: repo })
    : gitResult(['update-ref', '-m', `cw: fast-forward ${branch} to ${REMOTE}/${branch}`, `refs/heads/${branch}`, upstream, local], { cwd: repo });
  if (moved.code !== 0) return result('blocked', { commit: local, behind, reason: reasonOf(moved) });
  return result('updated', { from: local, commit: upstream, behind });
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const short = (sha) => String(sha ?? '').slice(0, 10);

// The line cw prints for an update, or null when there is nothing to say (off, no-repo).
export function baseUpdateLine(update) {
  const { branch, remote } = update;
  switch (update.state) {
    case 'updated': return `Base: ${branch} fast-forwarded by ${plural(update.behind, 'commit')} to ${remote} (${short(update.commit)}).`;
    case 'current': return `Base: ${branch} is up to date with ${remote} (${short(update.commit)}).`;
    case 'no-remote': return `Base: no remote ${REMOTE}; ${branch} stays as it is.`;
    case 'fetch-failed': return `Base: git fetch ${REMOTE} failed (${update.reason}); ${branch} may be behind ${remote}.`;
    case 'no-upstream': return `Base: ${remote} does not exist; ${branch} stays as it is.`;
    case 'no-branch': return `Base: there is no local branch ${branch}.`;
    case 'ahead': return `Base: ${branch} has ${plural(update.ahead, 'commit')} that ${remote} lacks; the task branch would carry them into the PR/MR.`;
    case 'diverged': return `Base: ${branch} and ${remote} have diverged (${update.ahead} local, ${update.behind} remote ${update.behind === 1 ? 'commit' : 'commits'}); cw leaves ${branch} as it is.`;
    case 'elsewhere': return `Base: ${branch} is ${plural(update.behind, 'commit')} behind ${remote} and checked out in ${update.path}; cw does not update it there.`;
    case 'blocked': return `Base: ${branch} is ${plural(update.behind, 'commit')} behind ${remote}, and the fast-forward failed: ${update.reason}`;
    case 'error': return `Base: cw could not update ${branch}: ${update.reason}`;
    default: return null;
  }
}

// Prints the update: a warning with what to do (hint) when it needs the user, a line otherwise.
export function printBaseUpdate(out, update, hint) {
  const line = baseUpdateLine(update);
  if (!line) return;
  if (update.needsUser) out.warn(`${line} ${hint}`);
  else out.print(line);
}
