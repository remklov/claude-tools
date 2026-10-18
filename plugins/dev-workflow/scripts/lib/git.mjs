// Thin git wrapper. `git()` throws on failure; `tryGit()` returns null instead.
import { run } from './proc.mjs';
import { CwError } from './out.mjs';

export function git(args, { cwd, input, env, timeoutMs } = {}) {
  const result = run('git', args, { cwd, input, env, timeoutMs });
  if (result.code !== 0) {
    throw new CwError(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`, { details: result });
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
  return run('git', args, { cwd, input, env, timeoutMs });
}

export const lines = (text) => (text ? text.split('\n').filter(Boolean) : []);

// Files changed between base and HEAD plus uncommitted and untracked files (repo-relative).
export function changedFiles(cwd, base) {
  const files = new Set();
  if (base) for (const file of lines(tryGit(['diff', '--name-only', `${base}...HEAD`], { cwd }) ?? '')) files.add(file);
  for (const entry of lines(tryGit(['status', '--porcelain', '--untracked-files=all'], { cwd }) ?? '')) {
    const path = entry.slice(3);
    files.add(path.includes(' -> ') ? path.split(' -> ')[1] : path);
  }
  return [...files].map((file) => file.replace(/^"|"$/g, '')).sort();
}

export function isClean(cwd) {
  return (tryGit(['status', '--porcelain'], { cwd }) ?? 'x') === '';
}

export function currentBranch(cwd) {
  return tryGit(['branch', '--show-current'], { cwd }) ?? '';
}

export function headCommit(cwd) {
  return git(['rev-parse', 'HEAD'], { cwd });
}

export function remoteUrl(cwd, remote = 'origin') {
  return tryGit(['remote', 'get-url', remote], { cwd });
}

export function gitVersion() {
  const out = run('git', ['--version']).stdout;
  const match = /(\d+)\.(\d+)/.exec(out);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}
