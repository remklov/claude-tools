// Thin git wrapper. Every call names its cwd (the work repo, the config root or a task worktree);
// nothing defaults to the process cwd (§3). There is deliberately no helper for commands that
// rewrite .git/config (branch -m, --set-upstream-to, push -u, remote set-head): the sandbox refuses
// those writes (§8, S8).
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { CwError } from './out.mjs';
import { run } from './proc.mjs';

function needCwd(cwd, args) {
  if (!cwd) throw new CwError(`git ${args.join(' ')} called without a cwd`);
}

// stdout without the trailing newline; throws on a non-zero exit.
export function git(args, { cwd, input, env, timeoutMs } = {}) {
  needCwd(cwd, args);
  const result = run('git', args, { cwd, input, env, timeoutMs });
  if (result.code !== 0) {
    const reason = result.stderr.trim() || result.stdout.trim();
    throw new CwError(`git ${args.join(' ')} failed in ${cwd}: ${reason}`, { details: { args, cwd, stderr: result.stderr } });
  }
  return result.stdout.replace(/\n$/, '');
}

export function tryGit(args, options) {
  try {
    return git(args, options);
  } catch {
    return null;
  }
}

export function gitResult(args, { cwd, input, env, timeoutMs } = {}) {
  needCwd(cwd, args);
  return run('git', args, { cwd, input, env, timeoutMs });
}

export const lines = (text) => (text ? text.split('\n').filter(Boolean) : []);
const nulList = (text) => (text ? text.split('\0').filter(Boolean) : []);

export const isNodeModulesPath = (path) => /(^|\/)node_modules$/.test(path);

// A symlink called node_modules is untracked even under a "node_modules/" ignore pattern, which only
// matches directories; worktree.symlinkDirectories creates exactly that (S4).
const isLinkedNodeModules = (cwd, path) => {
  if (!isNodeModulesPath(path)) return false;
  try {
    return lstatSync(join(cwd, path)).isSymbolicLink();
  } catch {
    return false;
  }
};

// `git status` entries: { code: 'XY', path }; untracked included. A rename or copy gives an entry for
// its target and one for its source, so the file's old place counts as changed too.
export function statusEntries(cwd) {
  const parts = nulList(git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd }));
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const code = parts[i].slice(0, 2);
    const path = parts[i].slice(3);
    if (code === '??' && isLinkedNodeModules(cwd, path)) continue;
    entries.push({ code, path });
    if (code[0] === 'R' || code[0] === 'C') entries.push({ code, path: parts[(i += 1)] }); // the next part is the source path
  }
  return entries;
}

export const porcelain = (cwd) => statusEntries(cwd).map((entry) => entry.path);
export const isClean = (cwd) => statusEntries(cwd).length === 0;

export const currentBranch = (cwd) => tryGit(['branch', '--show-current'], { cwd }) ?? '';
export const headCommit = (cwd) => git(['rev-parse', 'HEAD'], { cwd });

export const branchExists = (cwd, branch) => gitResult(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd }).code === 0;

export function commitsBetween(cwd, from, to) {
  return lines(git(['log', '--format=%H%x09%s', `${from}..${to}`], { cwd })).map((line) => {
    const [sha, ...subject] = line.split('\t');
    return { sha, subject: subject.join('\t') };
  });
}

// Deletes a local branch. Under the sandbox git deletes the ref but cannot update .git/config and
// exits non-zero (S8); success is decided by the branch being gone.
export function deleteBranch(cwd, branch) {
  const result = gitResult(['branch', '-D', branch], { cwd });
  if (branchExists(cwd, branch)) {
    throw new CwError(`git branch -D ${branch} failed in ${cwd}: ${result.stderr.trim()}`, { details: { cwd, stderr: result.stderr } });
  }
  const warning = result.code === 0 ? null : result.stderr.trim();
  return { deleted: true, warning };
}

// Files changed between base and HEAD plus uncommitted and untracked files, repo-relative, sorted.
// Without rename detection: a moved file changes the package it left as well (as in review scope).
export function changedFiles(cwd, base) {
  const files = new Set();
  if (base) for (const file of nulList(git(['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`], { cwd }))) files.add(file);
  for (const entry of statusEntries(cwd)) files.add(entry.path);
  return [...files].sort();
}

export const remoteUrl = (cwd, remote = 'origin') => tryGit(['remote', 'get-url', remote], { cwd });

export function gitVersion() {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(run('git', ['--version']).stdout);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : [0, 0, 0];
}
