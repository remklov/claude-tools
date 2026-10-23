import assert from 'node:assert/strict';
import { pbkdf2 } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { checksExitCode, listChecks, runChecks, selectPackages, workTreeId } from '../../cli/lib/checks.mjs';
import { withDefaults } from '../../cli/lib/config.mjs';
import { createTask, newTask } from '../../cli/lib/task.mjs';
import { loadWorkspace, taskDir } from '../../cli/lib/workspace.mjs';
import { gitIn, inPlaceConfig, makeInPlace, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const pkg = (id, path, checks = {}, extra = {}) => ({ id, path, areas: ['backend'], checks, ...extra });

function setup(t, packages) {
  const fx = makeInPlace(t, { config: inPlaceConfig({ packages }) });
  const ws = loadWorkspace({ cwd: fx.root });
  const base = gitIn(fx.app, fx.env)('rev-parse', 'HEAD');
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'x', type: 'feature', slug: 'x-y', branch: 'NO-TICKET/feature/x-y' }));
  return { fx, ws, task, base, workTree: ws.workRepo };
}

test('workTreeId: HEAD^{tree} when clean, follows edits and untracked files, ignores ignored ones, keeps the index', (t) => {
  const { fx, workTree } = setup(t, [pkg('app', '.')]);
  const app = gitIn(fx.app, fx.env);
  const clean = workTreeId(workTree);
  assert.equal(clean, app('rev-parse', 'HEAD^{tree}'));
  write(fx.app, { 'node_modules/x.js': 'ignored\n' });
  assert.equal(workTreeId(workTree), clean);
  write(fx.app, { 'src/sum.mjs': 'export const sum = (a, b) => b + a;\n' });
  const edited = workTreeId(workTree);
  assert.notEqual(edited, clean);
  write(fx.app, { 'notes/new.txt': 'new\n' });
  assert.notEqual(workTreeId(workTree), edited);
  assert.equal(app('diff', '--cached', '--name-only'), '', 'nothing was staged');
  assert.match(app('status', '--porcelain', '--untracked-files=all'), /\?\? notes\/new\.txt/, 'still untracked');
});

test('workTreeId: an edit that keeps the size and the second of a racily clean file still counts', (t) => {
  const { fx, workTree } = setup(t, [pkg('app', '.')]);
  const app = gitIn(fx.app, fx.env);
  // Entry, file and index share one second, so only the index mtime makes git compare the content
  // (racy git). The ctime cannot be set, so the stat check leaves it out.
  app('config', 'core.trustctime', 'false');
  const file = join(fx.app, 'src/sum.mjs');
  const second = 1_700_000_000;
  utimesSync(file, second, second);
  app('update-index', '--refresh');
  const clean = workTreeId(workTree);
  write(fx.app, { 'src/sum.mjs': 'export const sum = (a, b) => b + a;\n' });
  utimesSync(file, second, second);
  utimesSync(resolve(fx.app, app('rev-parse', '--git-path', 'index')), second, second);
  assert.notEqual(workTreeId(workTree), clean);
});

test('selectPackages: --package wins, unknown ids are usage errors, the longest path owns a file', () => {
  const config = withDefaults(inPlaceConfig({ packages: [pkg('root', '.'), pkg('api', 'packages/api'), pkg('api-gw', 'packages/api-gateway')] }));
  const files = ['packages/api-gateway/x.ts', 'packages/api/y.ts'];
  assert.deepEqual(selectPackages(config, { files, changed: true }).packages.map((p) => p.id), ['api', 'api-gw']);
  assert.deepEqual(selectPackages(config, { files, packageIds: ['root'] }).packages.map((p) => p.id), ['root']);
  assert.equal(selectPackages(config, { files }).selection, 'all');
  assert.throws(() => selectPackages(config, { files, packageIds: ['nope'] }), (error) => error.exitCode === 2 && /root, api, api-gw/.test(error.fix));
});

test('runChecks: pass and fail are recorded with logs, tails and the tree; a failure does not stop the rest', async (t) => {
  const { fx, ws, task, base, workTree } = setup(t, [pkg('app', '.', { bad: 'echo broken; exit 3', good: 'echo fine' })]);
  write(fx.app, { 'src/mul.mjs': 'export const mul = (a, b) => a * b;\n' });
  const result = await runChecks({ ws, task, workTree, base, changed: true });
  assert.equal(result.overall, 'fail');
  assert.equal(checksExitCode(result), 1);
  assert.deepEqual(result.packages[0].checks.map((c) => [c.name, c.result, c.exit]), [['bad', 'fail', 3], ['good', 'pass', 0]]);
  assert.equal(readFileSync(result.packages[0].checks[0].log, 'utf8'), 'broken\n');
  assert.equal(result.packages[0].checks[0].tail.trim(), 'broken');
  assert.equal(result.tree, workTreeId(workTree));
  assert.deepEqual(result.changedFiles, ['src/mul.mjs']);
  assert.ok(existsSync(result.file));
  assert.equal(listChecks(ws, task)[0].file, result.file);

  const only = await runChecks({ ws, task, workTree, base, changed: true, only: ['good'] });
  assert.equal(only.overall, 'pass');
  assert.equal(checksExitCode(only), 0);
  assert.notEqual(only.file, result.file, 'two runs in the same second get two files');
  await assert.rejects(runChecks({ ws, task, workTree, base, changed: true, only: ['lint'] }), (error) => error.exitCode === 2 && /good/.test(error.fix));
});

test('runChecks: changed files no package owns are exit 1 naming the files and the config; nothing changed is none', async (t) => {
  const { fx, ws, task, base, workTree } = setup(t, [pkg('api', 'packages/api', { test: 'exit 0' })]);
  const none = await runChecks({ ws, task, workTree, base, changed: true });
  assert.equal(none.overall, 'none');
  assert.equal(checksExitCode(none), 0);

  write(fx.app, { 'README.md': '# x\n' });
  await assert.rejects(runChecks({ ws, task, workTree, base, changed: true }), (error) =>
    error.exitCode === 1 && /1 changed files belong to no package: README\.md/.test(error.message) && error.fix.includes(ws.configPath) && error.details.overall === 'no-package');
  assert.equal(listChecks(ws, task)[0].data.overall, 'no-package', 'the refusal is recorded');

  write(fx.app, { 'packages/api/a.js': 'x\n' });
  const partly = await runChecks({ ws, task, workTree, base, changed: true });
  assert.equal(partly.overall, 'pass');
  assert.match(partly.warnings[0], /belong to no package: README\.md/);
});

test('runChecks --changed: a renamed file selects the package it left too, staged and committed', async (t) => {
  const { fx, ws, task, workTree } = setup(t, [pkg('a', 'a', { test: 'echo a' }), pkg('b', 'b', { test: 'echo b' })]);
  const app = gitIn(fx.app, fx.env);
  write(fx.app, { 'a/x.mjs': 'export const x = 1;\n', 'b/y.mjs': 'export const y = 2;\n' });
  app('add', '-A');
  app('commit', '-qm', 'two packages');
  const base = app('rev-parse', 'HEAD');
  app('mv', 'a/x.mjs', 'b/x.mjs');
  const staged = await runChecks({ ws, task, workTree, base, changed: true });
  assert.deepEqual([staged.changedFiles, staged.packages.map((p) => p.id)], [['a/x.mjs', 'b/x.mjs'], ['a', 'b']]);
  app('commit', '-qm', 'move x');
  const committed = await runChecks({ ws, task, workTree, base, changed: true });
  assert.deepEqual([committed.changedFiles, committed.packages.map((p) => p.id)], [['a/x.mjs', 'b/x.mjs'], ['a', 'b']]);
});

test('runChecks: a timeout kills the whole process group; env values are masked in logs and tails', async (t) => {
  const { ws, task, base, workTree } = setup(t, [pkg('app', '.', { slow: 'echo start; sleep 30', env: 'echo token=$API_TOKEN' }, { env: { API_TOKEN: 'super-secret-value' } })]);
  const started = Date.now();
  const result = await runChecks({ ws, task, workTree, base, timeoutMs: 300 });
  assert.ok(Date.now() - started < 5000, 'returns at the timeout, not when sleep ends');
  const [slow, env] = result.packages[0].checks;
  assert.equal(slow.result, 'timeout');
  assert.equal(result.overall, 'fail');
  assert.equal(env.tail.trim(), 'token=***');
  assert.equal(readFileSync(env.log, 'utf8'), 'token=***\n');
  assert.ok(!readFileSync(result.file, 'utf8').includes('super-secret-value'));
});

test('runChecks: the log is complete and masked when it returns, even while the threadpool is busy', async (t) => {
  const { ws, task, base, workTree } = setup(t, [pkg('app', '.', { env: 'seq 1 20000; echo token=$API_TOKEN' }, { env: { API_TOKEN: 'super-secret-value' } })]);
  // Busy libuv threads, started just before the check, hold the log's file open and writes back until
  // after the check exits, as a slow disk does (observed on Linux CI, TESTS-1).
  let busy = null;
  const keepThreadsBusy = () => {
    busy ??= Promise.all(Array.from({ length: 16 }, () => new Promise((resolve) => pbkdf2('x', 'y', 200_000, 32, 'sha256', resolve))));
  };
  const result = await runChecks({ ws, task, workTree, base, onProgress: keepThreadsBusy });
  const { log } = result.packages[0].checks[0];
  const atReturn = existsSync(log) ? readFileSync(log, 'utf8') : '(missing)';
  await busy;
  assert.ok(atReturn.endsWith('19999\n20000\ntoken=***\n'), `log at return: …${atReturn.slice(-40)}`);
  assert.ok(!readFileSync(log, 'utf8').includes('super-secret-value'));
});

test('runChecks: env values are masked in the log while the check runs, also across output chunks', async (t) => {
  const command = "printf 'token=super-sec'; sleep 0.3; printf 'ret-value\\n'; sleep 1";
  const { ws, task, base, workTree } = setup(t, [pkg('app', '.', { env: command }, { env: { API_TOKEN: 'super-secret-value' } })]);
  const running = runChecks({ ws, task, workTree, base });
  const logOf = () => {
    const dir = readdirSync(taskDir(ws, task.id)).find((name) => /^checks-\d{8}T\d{9}Z$/.test(name));
    const file = dir && join(taskDir(ws, task.id), dir, 'app-env.log');
    return file && existsSync(file) ? readFileSync(file, 'utf8') : '';
  };
  let during = logOf();
  for (let i = 0; i < 100 && !during.includes('\n'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    during = logOf();
  }
  const result = await running;
  assert.equal(during, 'token=***\n', 'a cw killed now leaves no secret behind');
  assert.equal(readFileSync(result.packages[0].checks[0].log, 'utf8'), 'token=***\n');
});

test('runChecks without a task writes logs under the state dir and no result file', async (t) => {
  const { ws, workTree } = setup(t, [pkg('app', '.', { test: 'echo ok' })]);
  const result = await runChecks({ ws, workTree });
  assert.equal(result.file, null);
  assert.ok(result.packages[0].checks[0].log.startsWith(join(ws.stateDir, 'checks')));
});
