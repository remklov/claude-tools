// cw checks (§8): the work tree's changed files mapped to packages (longest path, §5), each selected
// package's checks run in order with a timeout and a log, and the content tree id of the work tree
// recorded, so report save can tell a current result from a stale one (Decided in P2).
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageById, packagesOf, secretValues } from './config.mjs';
import { readJson, writeJson } from './fsx.mjs';
import { changedFiles, git, headCommit } from './git.mjs';
import { failedError, maskSecrets, usageError } from './out.mjs';
import { shell } from './proc.mjs';
import { taskDir } from './workspace.mjs';
import { listFiles } from './ws.mjs';

const CHECKS_FILE = /^checks-\d{8}T\d{9}Z\.json$/;

// The tree id of the work tree's content: HEAD plus uncommitted and untracked, non-ignored files. Uses a
// copy of the index (for its stat cache), so the real index stays untouched. The copy keeps the index
// mtime: git trusts the stat cache only for entries older than the index, and a fresh mtime would hide
// an edit that keeps the size within the second of the last index write (racy git).
export function workTreeId(workTree) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-tree-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    try {
      const index = resolve(workTree, git(['rev-parse', '--git-path', 'index'], { cwd: workTree }));
      copyFileSync(index, env.GIT_INDEX_FILE);
      const { atime, mtime } = statSync(index);
      utimesSync(env.GIT_INDEX_FILE, atime, mtime);
    } catch {
      git(['read-tree', 'HEAD'], { cwd: workTree, env });
    }
    git(['add', '--all'], { cwd: workTree, env });
    return git(['write-tree'], { cwd: workTree, env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// { selection, packages, unowned }: --package ids win, then --changed, else every package.
export function selectPackages(config, { files, changed = false, packageIds = [] }) {
  const { packages: owners, unowned } = packagesOf(config, files);
  if (packageIds.length) {
    const unknown = packageIds.filter((id) => !packageById(config, id));
    if (unknown.length) throw usageError(`unknown package ${unknown.join(', ')}`, `Use one of ${config.packages.map((pkg) => pkg.id).join(', ')}.`);
    return { selection: 'package', packages: config.packages.filter((pkg) => packageIds.includes(pkg.id)), unowned };
  }
  if (changed) return { selection: 'changed', packages: owners, unowned };
  return { selection: 'all', packages: config.packages, unowned };
}

const stampOf = (date) => date.toISOString().replace(/[-:.]/g, '');

// Runs the checks and returns the result; with a task it is also written to checks-<stamp>.json.
// Changed files while no package is selected is exit 1 (§8), after the result is recorded.
export async function runChecks({ ws, task = null, workTree, base = null, changed = false, packageIds = [], only = [], timeoutMs, onProgress = () => {} }) {
  const config = ws.config;
  const files = changedFiles(workTree, base);
  const { selection, packages, unowned } = selectPackages(config, { files, changed, packageIds });
  const names = new Set(packages.flatMap((pkg) => Object.keys(pkg.checks)));
  const unknownOnly = only.filter((name) => !names.has(name));
  if (unknownOnly.length) {
    throw usageError(`--only ${unknownOnly.join(', ')} is not a check of ${packages.map((pkg) => pkg.id).join(', ') || 'the selected packages'}`, `Use one of: ${[...names].join(', ') || '(none configured)'}.`);
  }
  const startedAt = new Date();
  const stamp = stampOf(startedAt);
  const dir = task ? taskDir(ws, task.id) : join(ws.stateDir, 'checks');
  const result = {
    kind: 'checks',
    version: 1,
    task: task?.id ?? null,
    workTree,
    base,
    head: headCommit(workTree),
    tree: workTreeId(workTree),
    selection,
    only,
    changedFiles: files,
    unowned,
    packages: [],
    overall: 'pass',
    warnings: [],
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    file: task ? join(dir, `checks-${stamp}.json`) : null,
  };
  if (selection === 'changed' && files.length === 0) result.overall = 'none';
  else if (selection === 'changed' && packages.length === 0) result.overall = 'no-package';
  else if (unowned.length) result.warnings.push(`${unowned.length} changed files belong to no package: ${listFiles(unowned)}`);

  const secrets = secretValues(config);
  const limit = timeoutMs ?? config.workflow.checkTimeoutMinutes * 60_000;
  for (const pkg of result.overall === 'pass' ? packages : []) {
    const entry = { id: pkg.id, path: pkg.path, reason: selection, checks: [] };
    result.packages.push(entry);
    const checks = Object.entries(pkg.checks).filter(([name]) => !only.length || only.includes(name));
    if (!checks.length) result.warnings.push(`package ${pkg.id} has no checks${only.length ? ` named ${only.join(', ')}` : ''}`);
    for (const [name, command] of checks) {
      const log = join(dir, `checks-${stamp}`, `${pkg.id}-${name}.log`);
      onProgress(`${pkg.id}: ${name} → ${command}`);
      const outcome = await shell(command, { cwd: join(workTree, pkg.path), env: pkg.env, logFile: log, secrets, timeoutMs: limit, killGroup: true });
      const status = outcome.code === 0 ? 'pass' : outcome.timedOut ? 'timeout' : 'fail';
      if (status !== 'pass') result.overall = 'fail';
      entry.checks.push({ name, command, cwd: pkg.path, exit: outcome.code, durationMs: outcome.durationMs, result: status, log, tail: maskSecrets(outcome.tail, secrets) });
      onProgress(`${pkg.id}: ${name} ${status} (${Math.round(outcome.durationMs / 1000)} s)`);
    }
  }
  result.finishedAt = new Date().toISOString();
  if (result.file) writeJson(result.file, result);
  if (result.overall === 'no-package') {
    throw failedError(
      `${files.length} changed files belong to no package: ${listFiles(files)}`,
      `Add a package whose path covers them in ${ws.configPath} (packages[].path), or run cw checks --package <id>.`,
      result,
    );
  }
  return result;
}

export const checksExitCode = (result) => (result.overall === 'pass' || result.overall === 'none' ? 0 : 1);

// The task's checks results, newest first, as { file, data }.
export function listChecks(ws, task) {
  const dir = taskDir(ws, task.id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => CHECKS_FILE.test(name))
    .sort()
    .reverse()
    .map((name) => ({ file: join(dir, name), data: readJson(join(dir, name)) }));
}
