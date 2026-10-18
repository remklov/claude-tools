// Evidence that tests cover a change: prove (test fails without the change) and mutate (test fails
// when covered lines are removed). Both work in scratch copies, never in the agent's worktree.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tryGit } from './git.mjs';
import { CwError } from './out.mjs';
import { packageById } from './profile.mjs';
import { testRunnerTemplate } from './packs.mjs';
import { shell } from './proc.mjs';
import { readJson, removeDir, scratchCopy, writeJson } from './fsx.mjs';

const FAILURE_LINE = /(AssertionError|Expected|expected|FAIL|✗|×|Error:|not ok)/;

// --test <pkg>:<file>[::<name>] → { pkg, file (relative to the package), name }
export function parseTestSpec(profile, spec) {
  const match = /^([a-z0-9-]+):(.+?)(?:::(.+))?$/.exec(spec);
  if (!match) throw new CwError(`--test must be <package>:<file>[::<test name>], got ${spec}`);
  const pkg = packageById(profile, match[1]);
  if (!pkg) throw new CwError(`Unknown package ${match[1]}`);
  let file = match[2];
  const root = pkg.paths[0] === '.' ? '' : `${pkg.paths[0]}/`;
  if (root && file.startsWith(root)) file = file.slice(root.length);
  return { pkg, file, name: match[3] ?? null };
}

export function singleTestCommand(profile, packs, { pkg, file, name }) {
  const runner = pkg.test?.single ? pkg.test : testRunnerTemplate(packs);
  if (!runner?.single) throw new CwError(`No single-test command: set packages[${pkg.id}].test.single or activate a test-runner pack.`);
  const command = runner.single.replace('{file}', file);
  if (!name) return command;
  if (!runner.nameFlag) throw new CwError('This test runner cannot select a test by name; pass the file only.');
  return `${command} ${runner.nameFlag} "${name.replace(/"/g, '\\"')}"`;
}

async function runTest(dir, pkg, command) {
  const cwd = join(dir, pkg.paths[0]);
  const outcome = await shell(command, { cwd, env: pkg.env, timeoutMs: 10 * 60_000, tailLines: 80 });
  const failureLine = outcome.output.split('\n').find((line) => FAILURE_LINE.test(line))?.trim() ?? null;
  return { code: outcome.code, failureLine, tail: outcome.tail };
}

export async function prove(ctx, profile, packs, task, { test, change }) {
  const target = parseTestSpec(profile, test);
  const command = singleTestCommand(profile, packs, target);
  const source = ctx.repoRoot;
  const scratch = scratchCopy(source);
  try {
    for (const file of change) {
      const rel = file.startsWith('/') ? relative(source, file) : file;
      const original = tryGit(['show', `${task.base.commit}:${rel}`], { cwd: source });
      const path = join(scratch, rel);
      if (original === null) rmSync(path, { force: true });
      else writeFileSync(path, `${original}\n`);
    }
    const without = await runTest(scratch, target.pkg, command);
    const withChange = await runTest(source, target.pkg, command);
    const proof = {
      test, command, change,
      failedWithout: without.code !== 0,
      failureLine: without.failureLine,
      passesWith: withChange.code === 0,
      at: new Date().toISOString(),
    };
    if (!proof.passesWith) proof.tailWith = withChange.tail;
    if (!proof.failedWithout) proof.tailWithout = without.tail;
    const file = join(ctx.stateDir, 'tasks', task.id, 'proofs.json');
    writeJson(file, [...readJson(file, []), proof]);
    return proof;
  } finally {
    removeDir(scratch);
  }
}

export async function mutate(ctx, profile, packs, task, { test, remove, replace }) {
  const target = parseTestSpec(profile, test);
  const command = singleTestCommand(profile, packs, target);
  const match = /^(.+):(\d+)-(\d+)$/.exec(remove ?? '');
  if (!match) throw new CwError('--remove must be <file>:<start>-<end>');
  const [, rel, startText, endText] = match;
  const scratch = scratchCopy(ctx.repoRoot);
  try {
    const path = join(scratch, rel);
    if (!existsSync(path)) throw new CwError(`${rel} does not exist`);
    const lines = readFileSync(path, 'utf8').split('\n');
    const start = Number(startText);
    const end = Number(endText);
    lines.splice(start - 1, end - start + 1, ...(replace !== undefined && replace !== true ? [String(replace)] : []));
    writeFileSync(path, lines.join('\n'));
    const outcome = await runTest(scratch, target.pkg, command);
    const mutation = { test, command, removed: remove, replacedWith: replace ?? null, killed: outcome.code !== 0, failureLine: outcome.failureLine, at: new Date().toISOString() };
    const file = join(ctx.stateDir, 'tasks', task.id, `mutations-${task.round}.json`);
    writeJson(file, [...readJson(file, []), mutation]);
    return mutation;
  } finally {
    removeDir(scratch);
  }
}
