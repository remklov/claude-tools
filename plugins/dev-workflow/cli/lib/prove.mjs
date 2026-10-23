// cw prove (§8): evidence that a test covers the change. In a temporary detached worktree at HEAD the
// single test must first pass (the control run); then the --change files are reverted to the base commit
// and it must fail; in the work tree it must pass. --recheck re-runs the recorded proofs that held
// against the current HEAD (§6 R3). The temporary worktree is always removed, and nothing is recorded
// when git fails.
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative } from 'node:path';
import { normalizePackagePath, packageById, packageOf, secretValues } from './config.mjs';
import { readJson, withLock, writeJson } from './fsx.mjs';
import { git, gitResult, headCommit, statusEntries } from './git.mjs';
import { maskSecrets, preconditionError, usageError } from './out.mjs';
import { resolvePacks, singleTestCommand, testRunnerOf } from './packs.mjs';
import { shell } from './proc.mjs';
import { markStep } from './task.mjs';
import { gitForm, taskPath } from './workspace.mjs';
import { listFiles, requireWorkTree } from './ws.mjs';

// The first assertion or error line, else the first failure marker: what the reviewer sees of the run.
// "Error [ERR_MODULE_NOT_FOUND]: …" is how node reports a missing import (observed, Node 20.19.5).
const ERROR_LINE = /(AssertionError|Error(?: \[[A-Z_]+\])?:|Expected|expected)/;
const FAIL_LINE = /(FAIL|✗|×|not ok)/;
const failureLineOf = (output) => {
  const lines = output.split('\n');
  return (lines.find((line) => ERROR_LINE.test(line)) ?? lines.find((line) => FAIL_LINE.test(line)))?.trim().replace(/^#\s*/, '') ?? null;
};
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Paths in the temporary tree mean nothing after its removal: they become work-tree-relative.
const relativeTo = (root) => {
  if (!root) return (text) => text;
  const prefixes = [...new Set([root, realpathSync(root)])].map(escapeRegExp).join('|');
  const pattern = new RegExp(`(?:file://)?(?:${prefixes})/?`, 'g');
  return (text) => text.replace(pattern, '');
};
const lexists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

// --test <package>:<file>[::<test name>]; the file may be package-relative or work-repo-relative.
export function parseTestSpec(config, spec) {
  const match = /^([a-z0-9][a-z0-9-]*):(.+?)(?:::(.+))?$/.exec(String(spec ?? ''));
  if (!match) throw usageError(`--test ${spec ?? ''} is not <package>:<file>[::<test name>]`, 'Pass e.g. --test app:src/sum.test.mjs or --test app:src/sum.test.mjs::adds.');
  const pkg = packageById(config, match[1]);
  if (!pkg) throw usageError(`--test names the unknown package ${match[1]}`, `Use one of ${config.packages.map((p) => p.id).join(', ')}.`);
  const file = normalizePackagePath(match[2]);
  if (file === '.' || file === '..' || file.startsWith('../') || file.startsWith('/')) {
    throw usageError(`--test ${spec}: the file must be relative to the package or the work tree`, 'Pass e.g. --test app:src/sum.test.mjs.');
  }
  const prefix = pkg.path === '.' ? '' : `${pkg.path}/`;
  const testPath = prefix && !file.startsWith(prefix) ? `${prefix}${file}` : file;
  return { pkg, testPath, testFile: testPath.slice(prefix.length), name: match[3] ?? null };
}

// The package's single-test command template: packages[].testSingle, else the last active pack with
// testRunner.single (§5, §7).
export function singleTestTemplate(ws, pkg, packs = resolvePacks(ws)) {
  if (pkg.testSingle) return { template: pkg.testSingle, source: `packages.${pkg.id}.testSingle` };
  const runner = testRunnerOf(packs);
  return runner ? { template: runner.single, source: `pack ${runner.pack}` } : null;
}

function singleCommand(ws, target) {
  const runner = singleTestTemplate(ws, target.pkg);
  if (!runner) {
    throw preconditionError(
      `No single-test command for package ${target.pkg.id}: no active pack defines testRunner.single.`,
      `Set packages[].testSingle (e.g. "node --test {file}") in ${ws.configPath}, or activate a test-runner pack (vitest).`,
    );
  }
  return singleTestCommand(runner.template, { file: target.testFile, name: target.name });
}

// --change values as work-tree-relative paths; relative values are relative to the work tree.
export function normalizeChange(workTree, values) {
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const files = values.map((value) => {
    const path = normalizePackagePath(isAbsolute(value) ? relative(workTree, real(value)) : value);
    if (path === '.' || path === '..' || path.startsWith('../') || isAbsolute(path)) {
      throw usageError(`--change ${value} is outside the work tree ${workTree}`, 'Pass the changed files relative to the work tree, e.g. --change src/sum.mjs.');
    }
    return path;
  });
  return [...new Set(files)];
}

// path's entry in rev's tree: { type: 'blob' | 'tree' | … | null (no entry), error: git's message | null }.
// ls-tree reads only trees, so a blob git cannot read is still an entry: a git failure is never taken
// for an absent file (§8: "a failing git show is an error, not a deletion").
function treeEntry(workTree, rev, path) {
  const result = gitResult(['ls-tree', '-z', rev, '--', path], { cwd: workTree });
  if (result.code !== 0) return { type: null, error: result.stderr.trim() || `exit ${result.code}` };
  const entry = result.stdout.split('\0')[0];
  return { type: entry ? entry.split('\t')[0].split(' ')[1] : null, error: null };
}

// The fix when git cannot read an object the paths point at: the repository is damaged, not the path.
const fsckFix = (ws) => `Check the repository (${gitForm(ws)} fsck), then run cw prove again.`;

function entryTypeAt(ws, workTree, rev, path) {
  const { type, error } = treeEntry(workTree, rev, path);
  if (error) {
    throw preconditionError(
      `Reading ${path} at ${rev.slice(0, 10)} failed in ${workTree}: ${error}. Nothing was recorded.`,
      fsckFix(ws),
    );
  }
  return type;
}

// restored: the file exists at the base commit; deleted: it is new since the base.
function planRestore(ws, workTree, base, path) {
  const kind = entryTypeAt(ws, workTree, base, path);
  if (kind) {
    if (kind !== 'blob') throw usageError(`--change ${path} is a ${kind === 'tree' ? 'directory' : kind} at the base commit`, 'Pass the changed files one by one.');
    return { path, action: 'restored' };
  }
  if (!entryTypeAt(ws, workTree, 'HEAD', path)) {
    throw usageError(`${path} exists neither at the base commit nor at HEAD.`, 'Pass files the task changed, relative to the work tree.');
  }
  return { path, action: 'deleted' };
}

// Why a recorded proof can no longer run at HEAD, or null: its test file is gone, or a --change file
// that existed when it was recorded (or at neither the base nor then) is gone since, e.g. renamed. A file
// the change itself deleted is still restored from the base. A tree git cannot read counts as gone.
function staleReason(workTree, base, proof) {
  const exists = (rev, path) => Boolean(rev) && treeEntry(workTree, rev, path).type !== null;
  if (!exists('HEAD', proof.testPath)) return `the test file ${proof.testPath} no longer exists at HEAD`;
  const gone = proof.change.filter((path) => !exists('HEAD', path) && (exists(proof.head, path) || !exists(base, path)));
  return gone.length ? `${listFiles(gone)} no longer ${gone.length === 1 ? 'exists' : 'exist'} at HEAD` : null;
}

// node_modules of the work tree root, of every package and of the test file's parent directories.
function linkNodeModules(config, workTree, tree, testPath) {
  const dirs = new Set(['.', ...config.packages.map((pkg) => pkg.path)]);
  for (let dir = posix.dirname(testPath); dir !== '.' && dir !== '/'; dir = posix.dirname(dir)) dirs.add(dir);
  const links = [];
  for (const dir of dirs) {
    const source = join(workTree, dir, 'node_modules');
    const link = join(tree, dir, 'node_modules');
    if (!existsSync(source) || lexists(link) || !existsSync(dirname(link))) continue;
    symlinkSync(realpathSync(source), link, 'dir');
    links.push(link);
  }
  return links;
}

// Unlinks our symlinks first, so no removal can follow them into the work tree's node_modules.
function removeTemp(workTree, tree, tmp, links) {
  for (const link of links) {
    try {
      unlinkSync(link);
    } catch {
      // Already gone.
    }
  }
  const removed = existsSync(tree) && gitResult(['worktree', 'remove', '--force', tree], { cwd: workTree }).code === 0;
  rmSync(tmp, { recursive: true, force: true });
  if (!removed) gitResult(['worktree', 'prune'], { cwd: workTree });
}

async function runTest(cwd, command, pkg, timeoutMs, secrets, root = null) {
  const outcome = await shell(command, { cwd, env: pkg.env, timeoutMs, tailLines: 40, killGroup: true });
  const local = relativeTo(root);
  if (outcome.code === 126 || outcome.code === 127) {
    throw preconditionError(`The single-test command could not start (exit ${outcome.code}) in ${cwd}: ${command}\n${maskSecrets(outcome.tail, secrets)}`, 'Fix packages[].testSingle or the pack\'s testRunner.single, or install the test runner.');
  }
  const output = local(maskSecrets(outcome.output, secrets));
  return {
    exit: outcome.code,
    timedOut: outcome.timedOut,
    failureLine: failureLineOf(output),
    tail: local(maskSecrets(outcome.tail, secrets)),
  };
}

// One proof run: passes in the work tree, passes in the temp tree at HEAD (the control), fails there with
// the change reverted. A control that fails while the work tree passes ends the run early with { control }:
// the test needs files the temp tree lacks. A test that fails in both is an ordinary not-holding run.
async function runProof({ ws, task, workTree, target, files, command, timeoutMs }) {
  const dirty = statusEntries(workTree).map((entry) => entry.path);
  if (dirty.length) {
    throw preconditionError(`prove runs on committed state; ${workTree} has uncommitted changes (${listFiles(dirty)}).`, 'Commit first (step 6), then run cw prove again.');
  }
  if (gitResult(['cat-file', '-e', `HEAD:${target.testPath}`], { cwd: workTree }).code !== 0) {
    throw preconditionError(`The test file ${target.testPath} is not committed at HEAD of ${workTree}.`, 'Commit the test, then run cw prove again.');
  }
  const base = task.base?.commit;
  if (!base || gitResult(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: workTree }).code !== 0) {
    throw preconditionError(
      `The base commit ${base ?? '(none)'} of task ${task.id} cannot be read in ${workTree}. Nothing was recorded.`,
      `Check base.commit in task.json (${gitForm(ws)} cat-file -t ${base}); the orchestrator restarts the task if it is wrong.`,
    );
  }
  const plan = files.map((path) => planRestore(ws, workTree, base, path));
  const head = headCommit(workTree);
  const secrets = secretValues(ws.config);
  const limit = timeoutMs ?? ws.config.workflow.checkTimeoutMinutes * 60_000;
  const tmp = mkdtempSync(join(tmpdir(), 'cw-prove-'));
  const tree = join(tmp, 'wt');
  let links = [];
  try {
    // No hooks: a post-checkout hook must not run in the temporary tree (here or in the restore below).
    git(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--quiet', '--detach', tree, 'HEAD'], { cwd: workTree });
    links = linkNodeModules(ws.config, workTree, tree, target.testPath);
    const withChange = await runTest(join(workTree, target.pkg.path), command, target.pkg, limit, secrets);
    // The control: a test that fails here before anything is reverted, while it passes in the work tree,
    // needs ignored or untracked files the temporary tree lacks; its failure without the change would
    // prove nothing.
    const control = await runTest(join(tree, target.pkg.path), command, target.pkg, limit, secrets, tree);
    if (control.exit !== 0 && withChange.exit === 0) return { head, base, restored: plan, control };
    for (const step of plan) {
      if (step.action === 'deleted') {
        rmSync(join(tree, step.path), { force: true });
        continue;
      }
      const restore = gitResult(['-c', 'core.hooksPath=/dev/null', '--literal-pathspecs', 'checkout', base, '--', step.path], { cwd: tree });
      // planRestore found the entry at the base, so the path is right: a failing checkout points at the
      // repository, e.g. a blob git cannot read.
      if (restore.code !== 0) {
        throw preconditionError(`Restoring ${step.path} from ${base.slice(0, 10)} failed: ${restore.stderr.trim()}. Nothing was recorded.`, fsckFix(ws));
      }
    }
    const without = await runTest(join(tree, target.pkg.path), command, target.pkg, limit, secrets, tree);
    return { head, base, restored: plan, without, withChange };
  } finally {
    removeTemp(workTree, tree, tmp, links);
  }
}

const proofsFile = (ws, task) => taskPath(ws, task.id, 'proofs.json');

export const readProofs = (ws, task) => readJson(proofsFile(ws, task), { version: 1, proofs: [], rechecks: [] });

function appendProofs(ws, task, change) {
  withLock(taskPath(ws, task.id, 'proofs.lock'), () => {
    const store = readProofs(ws, task);
    change(store);
    writeJson(proofsFile(ws, task), store);
  });
}

// The latest proof per test and change set.
export function currentProofs(proofs) {
  const latest = new Map();
  for (const proof of proofs) latest.set(`${proof.test}\0${[...proof.change].sort().join('\0')}`, proof);
  return [...latest.values()];
}

// The proofs that count: the current ones that held when they were recorded. A first try that did not
// hold never blocks the proof that followed it; a later run of the same proof that fails replaces it.
export const heldProofs = (proofs) => currentProofs(proofs).filter((proof) => proof.holds);

// The held proofs split at HEAD of the work tree: held still can run, stale ones lost their test or a
// --change file ({ id, test, reason }: shown, not counted). Without a work tree nothing is stale.
export function proofsAtHead(workTree, base, proofs) {
  const held = [];
  const stale = [];
  for (const proof of heldProofs(proofs)) {
    const reason = workTree ? staleReason(workTree, base, proof) : null;
    if (reason) stale.push({ id: proof.id, test: proof.test, reason });
    else held.push(proof);
  }
  return { held, stale };
}

const verdict = (run) => {
  const failedWithout = run.without.exit !== 0 && !run.without.timedOut;
  const passesWith = run.withChange.exit === 0;
  return { failedWithout, passesWith, holds: failedWithout && passesWith };
};

// The directory of the package.json nearest to the test file in the work tree ('.' for the root), or null.
function nearestPackageDir(workTree, testPath) {
  for (let dir = posix.dirname(testPath); ; dir = posix.dirname(dir)) {
    if (existsSync(join(workTree, dir, 'package.json'))) return dir;
    if (dir === '.' || dir === '/') return null;
  }
}

// A --change file outside the test's package (config package or nearest package.json) may reach the test
// through a node_modules link, which resolves to the unreverted work tree (§8 known limitation).
function isCrossPackage(config, workTree, target, files) {
  const dir = nearestPackageDir(workTree, target.testPath);
  const outside = (file) => dir !== null && dir !== '.' && file !== dir && !file.startsWith(`${dir}/`);
  return files.some((file) => packageOf(config, file)?.id !== target.pkg.id || outside(file));
}

export async function prove({ ws, task, test, change, timeoutMs }) {
  const workTree = requireWorkTree(ws, task);
  const target = parseTestSpec(ws.config, test);
  const files = normalizeChange(workTree, change);
  if (!files.length) throw usageError('--change is required', 'Pass the source files the test covers: --change src/sum.mjs[,src/other.mjs].');
  if (files.includes(target.testPath)) {
    throw usageError(`The test file ${target.testPath} itself is in --change.`, 'Pass the source files the test covers; prove reverts them and keeps the test.');
  }
  const command = singleCommand(ws, target);
  const run = await runProof({ ws, task, workTree, target, files, command, timeoutMs });
  if (run.control) {
    const { exit, timedOut, tail } = run.control;
    throw preconditionError(
      `The test ${target.testPath} passes in the work tree but fails at HEAD in a clean checkout (exit ${exit}${timedOut ? ', timed out' : ''}), before anything is reverted, so its failure without the change would prove nothing. Nothing was recorded.\n${tail}`,
      'Make the test pass in a clean checkout of HEAD: it must not need ignored or untracked files (generated code, .env files, build output; only node_modules is linked into the temporary tree). Commit what it needs or let the test create it, then run cw prove again.',
    );
  }
  const result = verdict(run);
  const crossPackage = isCrossPackage(ws.config, workTree, target, files);
  const proof = {
    id: null,
    round: task.round,
    at: new Date().toISOString(),
    test: `${target.pkg.id}:${target.testPath}${target.name ? `::${target.name}` : ''}`,
    package: target.pkg.id,
    testPath: target.testPath,
    name: target.name,
    command,
    change: files,
    restored: run.restored,
    base: run.base,
    head: run.head,
    failedWithout: result.failedWithout,
    exitWithout: run.without.exit,
    failureLine: run.without.failureLine,
    passesWith: result.passesWith,
    exitWith: run.withChange.exit,
    holds: result.holds,
    crossPackage,
    ...(result.failedWithout ? {} : { tailWithout: run.without.tail }),
    ...(result.passesWith ? {} : { tailWith: run.withChange.tail }),
  };
  appendProofs(ws, task, (store) => {
    proof.id = `P${store.proofs.length + 1}`;
    store.proofs.push(proof);
  });
  if (proof.holds && task.phase === 'implement') markStep(ws, task.id, 7, 'prove');
  return proof;
}

// Re-runs every proof that held against HEAD and records the outcome; nothing to do without one. A stale
// proof is listed, not run and not counted. A failing control does not hold (the test fails at HEAD).
export async function recheck({ ws, task, timeoutMs }) {
  const workTree = requireWorkTree(ws, task);
  const proofs = heldProofs(readProofs(ws, task).proofs);
  const entry = { round: task.round, at: new Date().toISOString(), head: headCommit(workTree), results: [], allHold: true };
  if (!proofs.length) return { ...entry, empty: true };
  for (const proof of proofs) {
    const stale = staleReason(workTree, task.base?.commit, proof);
    if (stale) {
      entry.results.push({ proof: proof.id, test: proof.test, stale });
      continue;
    }
    const target = parseTestSpec(ws.config, proof.test);
    const run = await runProof({ ws, task, workTree, target, files: proof.change, command: proof.command, timeoutMs });
    if (run.control) {
      const { failureLine, tail } = run.control;
      entry.results.push({ proof: proof.id, test: proof.test, failedControl: true, holds: false, failureLine, tailControl: tail });
      continue;
    }
    const result = verdict(run);
    entry.results.push({
      proof: proof.id,
      test: proof.test,
      ...result,
      failureLine: run.without.failureLine,
      ...(result.failedWithout ? {} : { tailWithout: run.without.tail }),
      ...(result.passesWith ? {} : { tailWith: run.withChange.tail }),
    });
  }
  entry.allHold = entry.results.every((result) => result.stale || result.holds);
  appendProofs(ws, task, (store) => store.rechecks.push(entry));
  return entry;
}
