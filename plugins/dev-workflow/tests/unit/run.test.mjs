import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { createTask, newTask } from '../../cli/lib/task.mjs';
import { loadWorkspace } from '../../cli/lib/workspace.mjs';
import { cw, gitIn, hermeticEnv, inPlaceConfig, makeInPlace, makeWorktreeRepo, pluginRoot, tempBase, worktreeConfig, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const script = (pack, name) => join(pluginRoot, 'packs', pack, 'scripts', `${name}.mjs`);

// Runs a pack script directly, from an unrelated cwd: it must read the work tree from CW_WORK_TREE.
function runScript(t, file, { workTree, env, args = [], base }) {
  const elsewhere = tempBase(t);
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: elsewhere,
    env: { ...env, CW_WORK_TREE: workTree, ...(base ? { CW_BASE: base } : {}) },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function repo(t, files) {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const dir = join(base, 'repo');
  mkdirSync(dir);
  const git = gitIn(dir, env);
  git('init', '-q', '-b', 'main');
  write(dir, files);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { dir, env, git, base: git('rev-parse', 'HEAD') };
}

// A branch from the base commit with the given files written (null deletes) and committed.
function branch(fx, name, files) {
  fx.git('switch', '-q', '-c', name, fx.base);
  for (const [file, content] of Object.entries(files)) {
    if (content === null) fx.git('rm', '-q', file);
    else write(fx.dir, { [file]: content });
  }
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', name);
}

test('check-discovery suggests test, typecheck and lint per package directory, in this order', (t) => {
  const fx = repo(t, {
    'package.json': { scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit', build: 'vite build' } },
    'api/package.json': { scripts: { 'type-check': 'tsc', test: 'node --test' } },
    'web/package.json': { scripts: { test: 'echo "Error: no test specified" && exit 1' } },
  });
  const result = runScript(t, script('node-npm', 'check-discovery'), { workTree: fx.dir, env: { ...fx.env, CW_PACKAGE_DIRS: '[".", "api", "web", "missing"]' } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `${JSON.stringify({
    '.': { test: 'npm test', typecheck: 'npm run typecheck', lint: 'npm run lint' },
    api: { test: 'npm test', typecheck: 'npm run type-check' },
  })}\n`);
  const bad = runScript(t, script('node-npm', 'check-discovery'), { workTree: fx.dir, env: { ...fx.env, CW_PACKAGE_DIRS: '"."' } });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /CW_PACKAGE_DIRS must be a JSON array/);
});

test('dependency-changes lists dependency and lockfile changes, also for a new package.json', (t) => {
  const fx = repo(t, {
    'package.json': { name: 'root', scripts: { test: 'x' }, dependencies: { express: '^5.1.0' } },
    'package-lock.json': { lockfileVersion: 3 },
    'old/package.json': { dependencies: { gone: '1.0.0' } },
  });
  const run = (args = []) => runScript(t, script('node-npm', 'dependency-changes'), { workTree: fx.dir, env: fx.env, base: fx.base, args });

  branch(fx, 'scripts-only', { 'package.json': { name: 'root', scripts: { test: 'y' }, dependencies: { express: '^5.1.0' } } });
  assert.deepEqual(run(), { code: 0, stdout: '', stderr: '' });

  branch(fx, 'added', { 'package.json': { name: 'root', scripts: { test: 'x' }, dependencies: { express: '^5.1.0', 'left-pad': '^1.0.0' } } });
  assert.deepEqual(run(), { code: 1, stdout: 'dependency changes (CORE-DEPENDENCIES):\npackage.json dependencies: left-pad — → ^1.0.0\n', stderr: '' });

  branch(fx, 'workspace', {
    'packages/api/package.json': { name: 'api', dependencies: { zod: '^3.0.0' }, devDependencies: { vitest: '^3.0.0' } },
    'package-lock.json': { lockfileVersion: 3, packages: {} },
    'old/package.json': null,
  });
  const workspace = run();
  assert.equal(workspace.code, 1, workspace.stderr);
  assert.equal(workspace.stdout, [
    'dependency changes (CORE-DEPENDENCIES):',
    'package-lock.json changed',
    'old/package.json dependencies: gone 1.0.0 → —',
    'packages/api/package.json dependencies: zod — → ^3.0.0',
    'packages/api/package.json devDependencies: vitest — → ^3.0.0',
    '',
  ].join('\n'));

  branch(fx, 'broken', { 'package.json': '{ "name": \n' });
  assert.match(run().stdout, /package\.json: not valid JSON at HEAD; check its dependencies by hand/);

  assert.equal(run(['--base', 'HEAD']).code, 0, 'an explicit --base wins over CW_BASE');
  const noBase = runScript(t, script('node-npm', 'dependency-changes'), { workTree: fx.dir, env: fx.env });
  assert.equal(noBase.code, 2);
  assert.match(noBase.stderr, /^usage: dependency-changes --base <sha>/);
  const badBase = run(['--base', 'no-such-ref']);
  assert.equal(badBase.code, 2);
  assert.match(badBase.stderr, /git diff no-such-ref\.\.\.HEAD failed/);
});

test('no-focus reports added focused, skipped and todo tests in test files only', (t) => {
  const fx = repo(t, {
    'src/old.test.ts': "it.only('old', () => {});\n",
    'src/a.ts': 'export const a = 1;\n',
  });
  branch(fx, 'focus', {
    'src/old.test.ts': "it.only('old', () => {});\nit('new', () => {});\n",
    'src/deep/a.test.ts': [
      "it.only('x', () => {});",
      "describe.skip('y', () => {});",
      "test.todo('z');",
      "it.only.each([1])('e', () => {});",
      "it.concurrent.only('c', () => {});",
      "it('fine', () => {});",
      'const notATest = { only: true };',
      '',
    ].join('\n'),
    'd e/b c.spec.ts': "test.only('spaced', () => {});\n",
    'src/a.ts': "export const a = 1; // it.only( in a comment of a source file\n",
  });
  const expected = [
    'focused/skipped tests (VITEST-NO-FOCUS):',
    "d e/b c.spec.ts: test.only('spaced', () => {});",
    "src/deep/a.test.ts: it.only('x', () => {});",
    "src/deep/a.test.ts: describe.skip('y', () => {});",
    "src/deep/a.test.ts: test.todo('z');",
    "src/deep/a.test.ts: it.only.each([1])('e', () => {});",
    "src/deep/a.test.ts: it.concurrent.only('c', () => {});",
    '',
  ].join('\n');
  const run = (args) => runScript(t, script('vitest', 'no-focus'), { workTree: fx.dir, env: fx.env, base: fx.base, args });
  assert.deepEqual(run(), { code: 1, stdout: expected, stderr: '' });
  fx.git('config', 'diff.noprefix', 'true');
  assert.equal(run().stdout, expected, 'diff.noprefix does not change the paths');
  assert.deepEqual(run(['--base', 'HEAD']), { code: 0, stdout: '', stderr: '' });
  const noBase = runScript(t, script('vitest', 'no-focus'), { workTree: fx.dir, env: fx.env });
  assert.equal(noBase.code, 2);
  assert.match(noBase.stderr, /^usage: no-focus --base <sha>/);
});

// In-place fixture with the vitest and node-npm packs and a project-local probe pack.
function inPlaceWithTask(t) {
  const fx = makeInPlace(t, { config: inPlaceConfig({ packs: ['node-npm', 'vitest', 'probe'] }) });
  write(fx.root, {
    '.claude/dev-workflow/packs/probe/pack.json': { id: 'probe', version: '0.1.0', title: 'Probe', scripts: { env: 'scripts/env.mjs' } },
    '.claude/dev-workflow/packs/probe/scripts/env.mjs':
      "const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('CW_')));\nconsole.log(JSON.stringify({ cwd: process.cwd(), env }));\nconsole.error('probe stderr');\nprocess.exitCode = 7;\n",
  });
  const git = gitIn(fx.app, fx.env);
  const baseCommit = git('rev-parse', 'HEAD');
  const ws = loadWorkspace({ cwd: fx.root });
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Run', type: 'feature', slug: 'run-check', branch: 'NO-TICKET/feature/run-check', ownerSession: 'test-session', base: { branch: 'main', commit: baseCommit } }));
  git('switch', '-q', '-c', 'NO-TICKET/feature/run-check');
  write(fx.app, { 'src/a.test.ts': "it.only('focus', () => {});\n" });
  git('add', '-A');
  git('commit', '-q', '-m', 'focus');
  return { ...fx, git, baseCommit, id: task.id };
}

test('cw run runs a pack script in the task work tree from any cwd, passing arguments and exit codes', (t) => {
  const fx = inPlaceWithTask(t);
  const fromRoot = cw(fx.root, ['run', 'vitest:no-focus', '--task', fx.id], { env: fx.env });
  assert.equal(fromRoot.code, 1, fromRoot.stderr);
  assert.equal(fromRoot.stdout, "focused/skipped tests (VITEST-NO-FOCUS):\nsrc/a.test.ts: it.only('focus', () => {});\n");
  const fromApp = cw(join(fx.app, 'src'), ['run', 'vitest:no-focus', '--task', fx.id], { env: fx.env });
  assert.deepEqual([fromApp.code, fromApp.stdout], [fromRoot.code, fromRoot.stdout]);

  assert.equal(cw(fx.root, ['run', 'vitest:no-focus', '--task', fx.id, '--', '--base', 'HEAD'], { env: fx.env }).code, 0);
  assert.equal(cw(fx.root, ['run', 'vitest:no-focus', '--task', fx.id, '--base', 'HEAD'], { env: fx.env }).code, 0);
  assert.equal(cw(fx.root, ['run', 'vitest:no-focus', '--base', 'main'], { env: fx.env }).code, 1);
  const badBase = cw(fx.root, ['run', 'vitest:no-focus', '--base', 'nope'], { env: fx.env });
  assert.equal(badBase.code, 2);
  assert.match(badBase.stderr, /--base nope names no commit/);

  assert.equal(cw(fx.root, ['run', 'node-npm:dependency-changes', '--task', fx.id], { env: fx.env }).code, 0);
  write(fx.app, { 'package.json': { name: 'fixture-app', private: true, scripts: { test: 'node --test' }, dependencies: { 'left-pad': '^1.0.0' } } });
  fx.git('commit', '-q', '-am', 'dependency');
  const deps = cw(fx.app, ['run', 'node-npm:dependency-changes', '--task', fx.id], { env: fx.env });
  assert.equal(deps.code, 1);
  assert.match(deps.stdout, /package\.json dependencies: left-pad — → \^1\.0\.0/);

  const discovery = cw(fx.root, ['run', 'node-npm:check-discovery'], { env: fx.env });
  assert.equal(discovery.code, 0, discovery.stderr);
  assert.deepEqual(JSON.parse(discovery.stdout), { '.': { test: 'npm test' } });

  const probe = cw(fx.root, ['run', 'probe:env', '--task', fx.id], { env: fx.env });
  assert.equal(probe.code, 7);
  assert.equal(probe.stderr, 'probe stderr\n');
  const seen = JSON.parse(probe.stdout);
  const app = realpathSync(fx.app);
  assert.equal(seen.cwd, app);
  assert.deepEqual(seen.env, {
    CW_WORK_TREE: app,
    CW_CONFIG_ROOT: realpathSync(fx.root),
    CW_PACK_OPTIONS: '{}',
    CW_TASK: fx.id,
    CW_TASK_DIR: join(realpathSync(fx.root), '.git', 'dev-workflow', 'tasks', fx.id),
    CW_BASE: fx.baseCommit,
    CW_DEFAULT_BASE: 'main',
    CW_PACKAGE_DIRS: '["."]',
  });
});

test('cw run refuses bad references, extra arguments and a missing work tree', (t) => {
  const fx = inPlaceWithTask(t);
  const cases = [
    [['run'], 2, /cw run needs <pack>:<script>/],
    [['run', 'vitest'], 2, /"vitest" is not a pack script reference\nFix: Use <pack>:<script>/],
    [['run', 'docker:image-pins'], 2, /pack docker is not active in this project\nFix: Use a script of an active pack \(core, node-npm, vitest, probe\)/],
    [['run', 'vitest:nope'], 2, /pack vitest has no script nope\nFix: Its scripts: vitest:no-focus\./],
    [['run', 'vitest:no-focus', 'extra'], 2, /unexpected argument extra/],
    [['run', 'vitest:no-focus', '--task', 'nope'], 3, /No task nope/],
  ];
  for (const [args, code, pattern] of cases) {
    const result = cw(fx.root, args, { env: fx.env });
    assert.equal(result.code, code, args.join(' '));
    assert.match(result.stderr, pattern, args.join(' '));
  }
  const outside = cw(fx.base, ['run', 'vitest:no-focus'], { env: fx.env });
  assert.equal(outside.code, 3);

  const wt = makeWorktreeRepo(t, { config: worktreeConfig({ packs: ['vitest'] }) });
  const ws = loadWorkspace({ cwd: wt.root });
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'X', type: 'feature', slug: 'no-tree', branch: 'NO-TICKET/feature/no-tree', ownerSession: 's' }));
  const missing = cw(wt.root, ['run', 'vitest:no-focus', '--task', task.id], { env: wt.env });
  assert.equal(missing.code, 3);
  assert.match(missing.stderr, /work tree \(not set up yet\) is missing\nFix: Run cw ws setup --task NO-TICKET__feature__no-tree/);
});
