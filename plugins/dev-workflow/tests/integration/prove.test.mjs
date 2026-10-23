// cw prove as a process (§8): a temporary worktree with the change reverted, the single test there and in
// the work tree, the record in proofs.json, and the cleanup whatever happens.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { readJson } from '../../cli/lib/fsx.mjs';
import { createTask, newTask, readTask, updateTask } from '../../cli/lib/task.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, cw, gitIn, inPlaceConfig, makeInPlace, makeWorktreeRepo, tempBase, worktreeConfig, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const testFile = (name, body) => `import test from 'node:test';\nimport assert from 'node:assert/strict';\n${body}\n`;
const FIX = {
  'src/sum.mjs': 'export const sum = (a, b) => a + b;\nexport const sum3 = (a, b, c) => a + b + c;\n',
  'src/sum3.test.mjs': testFile('sum3', "import { sum3 } from './sum.mjs';\n\ntest('adds three', () => assert.equal(sum3(1, 2, 3), 6));"),
};
const packages = (extra = []) => [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' }, testSingle: 'node --test {file}' }, ...extra];

function startTask(fx) {
  const ws = loadWorkspace({ cwd: fx.root });
  const { id } = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Sum3', type: 'feature', slug: 'sum-three', branch: 'NO-TICKET/feature/sum-three' }));
  const commit = gitIn(ws.mode === 'in-place' ? fx.app : fx.root, fx.env)('rev-parse', 'HEAD');
  updateTask(ws, id, (task) => {
    task.phase = 'implement';
    task.round = 1;
    task.base = { branch: 'main', commit };
  });
  return { ws, id };
}

// An in-place task set up with ws setup and the fix committed in app/ (appFiles are at the base).
function committedFix(t, { config = inPlaceConfig({ packages: packages() }), files = FIX, appFiles = {} } = {}) {
  const fx = makeInPlace(t, { config, appFiles });
  const { ws, id } = startTask(fx);
  assert.equal(cw(fx.root, ['ws', 'setup', '--task', id], { env: fx.env }).code, 0);
  const app = gitIn(fx.app, fx.env);
  write(fx.app, files);
  app('add', '-A');
  app('commit', '-q', '-m', '[FEATURE] Add sum3');
  const prove = (cwd, args) => cw(cwd, ['prove', '--task', id, ...args], { env: fx.env });
  return { fx, ws, id, app, prove };
}

test('a holding proof is recorded, marks step 7 and leaves no temporary worktree; cwd does not matter', (t) => {
  const { fx, ws, id, app, prove } = committedFix(t);
  const worktrees = app('worktree', 'list', '--porcelain');
  const result = prove(join(fx.app, 'src'), ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const proof = result.json();
  assert.deepEqual([proof.id, proof.holds, proof.failedWithout, proof.passesWith, proof.crossPackage], ['P1', true, true, true, false]);
  assert.equal(proof.command, 'node --test src/sum3.test.mjs');
  assert.deepEqual(proof.restored, [{ path: 'src/sum.mjs', action: 'restored' }]);
  assert.match(proof.failureLine, /SyntaxError: .*sum3/, 'the error line, not the TAP marker');
  assert.equal(proof.head, app('rev-parse', 'HEAD'));
  assert.deepEqual(readJson(taskPath(ws, id, 'proofs.json')).proofs.map((p) => p.id), ['P1']);
  assert.equal(readTask(ws, id).steps.done, 7);
  assert.equal(app('worktree', 'list', '--porcelain'), worktrees);

  const human = prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']);
  assert.match(human.stdout, /P2 proved: fails without the change/);
});

test('refusals: the test file in --change (2), uncommitted changes (3), an unreadable base (3) record nothing', (t) => {
  const { fx, ws, id, app, prove } = committedFix(t);
  const worktrees = app('worktree', 'list', '--porcelain');
  const self = prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs,src/sum3.test.mjs']);
  assert.equal(self.code, 2);
  assert.match(self.stderr, /the test file src\/sum3\.test\.mjs itself is in --change/i);

  write(fx.app, { 'src/sum.mjs': `${FIX['src/sum.mjs']}// draft\n` });
  const dirty = prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']);
  assert.equal(dirty.code, 3);
  assert.match(dirty.stderr, /uncommitted changes \(src\/sum\.mjs\)\.\nFix: Commit first/);
  app('checkout', '--', 'src/sum.mjs');

  updateTask(ws, id, (task) => {
    task.base.commit = 'f'.repeat(40);
  });
  const broken = prove(fx.app, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']);
  assert.equal(broken.code, 3);
  assert.match(broken.stderr, /cannot be read in .+ Nothing was recorded/);
  assert.equal(existsSync(taskPath(ws, id, 'proofs.json')), false);
  assert.equal(app('worktree', 'list', '--porcelain'), worktrees);

  updateTask(ws, id, (task) => {
    task.base.commit = app('rev-parse', 'HEAD~1');
  });
  const missing = prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/nope.mjs']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /src\/nope\.mjs exists neither at the base commit nor at HEAD/);
  assert.equal(existsSync(taskPath(ws, id, 'proofs.json')), false);
});

test('not proved: a test that passes without the change is exit 1 and recorded as not holding', (t) => {
  const { fx, ws, id, prove } = committedFix(t);
  const result = prove(fx.root, ['--test', 'app:src/sum.test.mjs', '--change', 'src/sum.mjs']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /P1 not proved: the test passes without the change[\s\S]*Fix: make the test fail when the change is reverted/);
  const [proof] = readJson(taskPath(ws, id, 'proofs.json')).proofs;
  assert.equal(proof.holds, false);
  assert.ok(proof.tailWithout.length > 0);
  assert.equal(readTask(ws, id).steps.done, 1, 'no step 7');
  const json = prove(fx.root, ['--test', 'app:src/sum.test.mjs', '--change', 'src/sum.mjs', '--json']);
  assert.equal(json.code, 1);
  assert.equal(json.json().fix, 'make the test fail when the change is reverted, then run cw prove again.', 'a failing JSON result names its fix');
});

test('a test that fails in a clean checkout at HEAD is refused before anything is reverted; nothing is recorded', (t) => {
  // The test reads an ignored file the temporary tree lacks: without the control run it would "prove"
  // any --change (VALIDATION-2).
  const files = {
    '.gitignore': 'node_modules\n.env.json\n',
    'src/config.test.mjs': testFile('config', "import { readFileSync } from 'node:fs';\n\ntest('reads config', () => assert.equal(JSON.parse(readFileSync(new URL('../.env.json', import.meta.url))).mode, 'dev'));"),
    'src/other.mjs': 'export const other = 1;\n',
  };
  const { fx, ws, id, app, prove } = committedFix(t, { files });
  write(fx.app, { '.env.json': { mode: 'dev' } });
  const worktrees = app('worktree', 'list', '--porcelain');
  const result = prove(fx.root, ['--test', 'app:src/config.test.mjs', '--change', 'src/other.mjs']);
  assert.equal(result.code, 3, result.stdout);
  assert.match(result.stderr, /The test src\/config\.test\.mjs passes in the work tree but fails at HEAD in a clean checkout \(exit 1\), before anything is reverted, so its failure without the change would prove nothing\. Nothing was recorded\./);
  assert.match(result.stderr, /ENOENT/);
  assert.match(result.stderr, /Fix: Make the test pass in a clean checkout of HEAD: it must not need ignored or untracked files/);
  assert.equal(existsSync(taskPath(ws, id, 'proofs.json')), false);
  assert.equal(app('worktree', 'list', '--porcelain'), worktrees);
});

test('--recheck: a proof whose test now passes only in the work tree does not hold', (t) => {
  const { fx, ws, id, app, prove } = committedFix(t);
  assert.equal(prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']).code, 0);
  write(fx.app, {
    '.gitignore': 'node_modules\n.env.json\n',
    '.env.json': { n: 6 },
    'src/sum3.test.mjs': testFile('sum3', "import { readFileSync } from 'node:fs';\nimport { sum3 } from './sum.mjs';\n\ntest('adds three', () => assert.equal(sum3(1, 2, 3), JSON.parse(readFileSync(new URL('../.env.json', import.meta.url))).n));"),
  });
  app('add', '-A');
  app('commit', '-qm', '[TASK] Read the expected sum from .env.json');
  updateTask(ws, id, (task) => {
    task.phase = 'review';
  });
  const recheck = prove(fx.root, ['--recheck', '--json']);
  assert.equal(recheck.code, 1, recheck.stderr);
  assert.deepEqual(recheck.json().results.map((r) => [r.proof, r.holds, r.failedControl]), [['P1', false, true]]);
  assert.match(prove(fx.root, ['--recheck']).stdout, /^P1 app:src\/sum3\.test\.mjs: does not hold \(passes in the work tree, fails at HEAD in a clean checkout: .+\)\nFix: a proof that no longer holds/);
});

test('a base blob git cannot read is exit 3, never a deletion; nothing is recorded', (t) => {
  const { fx, ws, id, app, prove } = committedFix(t);
  const worktrees = app('worktree', 'list', '--porcelain');
  const blob = app('rev-parse', 'HEAD~1:src/sum.mjs');
  rmSync(join(fx.app, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  const result = prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']);
  assert.equal(result.code, 3, result.stdout);
  assert.match(result.stderr, /Restoring src\/sum\.mjs from \w{10} failed: .+\. Nothing was recorded\./);
  // The path is right; the object store is damaged (R2-A3).
  assert.ok(result.stderr.includes('\nFix: Check the repository (git -C app fsck), then run cw prove again.\n'), result.stderr);
  assert.equal(existsSync(taskPath(ws, id, 'proofs.json')), false);
  assert.equal(app('worktree', 'list', '--porcelain'), worktrees);
});

test('the restore checkout runs no post-checkout hook in the temporary tree', (t) => {
  const { fx, prove } = committedFix(t);
  const marker = join(fx.base, 'hook-ran.txt');
  write(fx.app, { '.git/hooks/post-checkout': `#!/bin/sh\necho "$PWD $*" >> '${marker}'\n` });
  chmodSync(join(fx.app, '.git', 'hooks', 'post-checkout'), 0o755);
  const result = prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.json().restored, [{ path: 'src/sum.mjs', action: 'restored' }]);
  assert.equal(existsSync(marker) ? readFileSync(marker, 'utf8') : '', '', 'the hook did not run');
});

test('fix texts name git -C <appRoot> relative to the project root, also below a path with a space', (t) => {
  const spaced = join(tempBase(t), 'with space');
  mkdirSync(spaced);
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = spaced;
  let fix;
  try {
    fix = committedFix(t);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  updateTask(fix.ws, fix.id, (task) => {
    task.base.commit = 'f'.repeat(40);
  });
  const broken = fix.prove(fix.fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']);
  assert.equal(broken.code, 3);
  assert.match(fix.fx.app, / /);
  assert.match(broken.stderr, /Fix: Check base\.commit in task\.json \(git -C app cat-file -t f{40}\)/);

  updateTask(fix.ws, fix.id, (task) => {
    task.base.commit = fix.app('rev-parse', 'HEAD~1');
  });
  const blob = fix.app('rev-parse', 'HEAD~1:src/sum.mjs');
  rmSync(join(fix.fx.app, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  const unreadable = fix.prove(fix.fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']);
  assert.equal(unreadable.code, 3, unreadable.stdout);
  assert.match(unreadable.stderr, /Fix: Check the repository \(git -C app fsck\), then run cw prove again\./);
});

test('a file new since the base is deleted in the temporary tree; positional files join --change', (t) => {
  const files = {
    'src/mul.mjs': 'export const mul = (a, b) => a * b;\n',
    'src/fmt.mjs': 'export const fmt = (n) => `#${n}`;\n',
    'src/mul.test.mjs': testFile('mul', "import { mul } from './mul.mjs';\nimport { fmt } from './fmt.mjs';\n\ntest('multiplies', () => assert.equal(fmt(mul(2, 3)), '#6'));"),
  };
  const { fx, prove } = committedFix(t, { files });
  const result = prove(fx.root, ['--test', 'app:src/mul.test.mjs::multiplies', '--change', 'src/mul.mjs', 'src/fmt.mjs', '--json']);
  assert.equal(result.code, 2, 'node --test {file} has no {name}');
  const ok = prove(fx.root, ['--test', 'app:src/mul.test.mjs', '--change', 'src/mul.mjs', 'src/fmt.mjs', '--json']);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(ok.json().restored, [{ path: 'src/mul.mjs', action: 'deleted' }, { path: 'src/fmt.mjs', action: 'deleted' }]);
});

test('node_modules is linked into the temporary tree and survives its removal', (t) => {
  const files = {
    'src/dep.test.mjs': testFile('dep', "import { answer } from 'fixture-dep';\n\ntest('uses the dependency', () => assert.equal(answer, 42));"),
    'src/other.mjs': 'export const other = 1;\n',
  };
  const fx0 = { files };
  const { fx, prove } = committedFix(t, fx0);
  write(fx.app, { 'node_modules/fixture-dep/package.json': { name: 'fixture-dep', type: 'module', main: 'index.js' }, 'node_modules/fixture-dep/index.js': 'export const answer = 42;\n' });
  // other.mjs does not matter to the test: with node_modules linked the test passes without the
  // change, so the proof correctly does not hold (without the link it would fail and "prove" falsely).
  const result = prove(fx.root, ['--test', 'app:src/dep.test.mjs', '--change', 'src/other.mjs', '--json']);
  assert.equal(result.code, 1, result.stdout);
  assert.equal(result.json().failedWithout, false);
  assert.equal(readFileSync(join(fx.app, 'node_modules', 'fixture-dep', 'index.js'), 'utf8'), 'export const answer = 42;\n');
});

test('a change in another package is flagged as a cross-package proof', (t) => {
  const config = inPlaceConfig({ packages: packages([{ id: 'lib', path: 'lib', areas: ['backend'] }]) });
  const files = {
    'lib/twice.mjs': 'export const twice = (n) => n * 2;\n',
    'src/twice.test.mjs': testFile('twice', "import { twice } from '../lib/twice.mjs';\n\ntest('doubles', () => assert.equal(twice(2), 4));"),
  };
  const { fx, prove } = committedFix(t, { config, files });
  const result = prove(fx.root, ['--test', 'app:src/twice.test.mjs', '--change', 'lib/twice.mjs', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json().crossPackage, true);
  assert.match(result.stderr, /P1 reverts files outside the package of its test/);
});

test('npm workspaces under one package: a change reached through a node_modules link is flagged, and the fix says why', (t) => {
  // §5's layout: one config package at '.', npm workspaces inside it. The import of @x/shared resolves
  // through node_modules to the work tree's packages/shared, which prove does not revert (§8).
  const appFiles = {
    'package.json': { name: 'fixture-app', private: true, workspaces: ['packages/*'], scripts: { test: 'node --test' } },
    'packages/shared/package.json': { name: '@x/shared', type: 'module', exports: './index.mjs' },
    'packages/shared/index.mjs': 'export const double = (n) => n * 3;\n',
    'packages/web/package.json': { name: '@x/web', type: 'module' },
  };
  const files = {
    'packages/shared/index.mjs': 'export const double = (n) => n * 2;\n',
    'packages/web/double.test.mjs': testFile('double', "import { double } from '@x/shared';\n\ntest('doubles', () => assert.equal(double(2), 4));"),
  };
  const { fx, prove } = committedFix(t, { appFiles, files });
  mkdirSync(join(fx.app, 'node_modules', '@x'), { recursive: true });
  symlinkSync('../../packages/shared', join(fx.app, 'node_modules', '@x', 'shared'));
  const result = prove(fx.root, ['--test', 'app:packages/web/double.test.mjs', '--change', 'packages/shared/index.mjs', '--json']);
  assert.equal(result.code, 1, result.stderr);
  const proof = result.json();
  assert.deepEqual([proof.holds, proof.failedWithout, proof.crossPackage], [false, false, true]);
  assert.match(proof.fix, /^the test passes with the change reverted\. If it reaches packages\/shared\/index\.mjs through node_modules \(another workspace package\), it loads the work tree's copy, which prove does not revert \(§8\): prove the change with a test inside that package\. Otherwise make the test fail when the change is reverted\. Then run cw prove again\.$/);
  const human = prove(fx.root, ['--test', 'app:packages/web/double.test.mjs', '--change', 'packages/shared/index.mjs']);
  assert.match(human.stdout, /P2 not proved: the test passes without the change\n[\s\S]*\nFix: the test passes with the change reverted\. If it reaches packages\/shared\/index\.mjs through node_modules/);
});

test('--recheck re-runs the recorded proofs: they hold, then fail after the fix is removed', (t) => {
  const { fx, ws, id, app, prove } = committedFix(t);
  assert.equal(prove(fx.root, ['--recheck']).stdout, 'no holding proofs to recheck\n');
  assert.equal(prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']).code, 0);
  updateTask(ws, id, (task) => {
    task.phase = 'review';
  });
  const holds = prove(fx.app, ['--recheck', '--json']);
  assert.equal(holds.code, 0, holds.stderr);
  assert.equal(holds.json().allHold, true);
  assert.equal(holds.json().fix, undefined);

  write(fx.app, { 'src/sum.mjs': 'export const sum = (a, b) => a + b;\nexport const sum3 = (a, b) => a + b;\n' });
  app('commit', '-qam', '[TASK] Simplify sum3');
  const broken = prove(fx.root, ['--recheck', '--json']);
  assert.equal(broken.code, 1);
  assert.deepEqual(broken.json().results.map((r) => [r.proof, r.holds, r.passesWith]), [['P1', false, false]]);
  assert.equal(broken.json().fix, 'a proof that no longer holds is a blocking CORE-TEST-SPEC finding.');
  const store = readJson(taskPath(ws, id, 'proofs.json'));
  assert.deepEqual(store.rechecks.map((entry) => entry.allHold), [true, false]);
  assert.equal(store.proofs.length, 1, 'a recheck adds no proofs');
  assert.equal(prove(fx.root, ['--recheck', '--test', 'app:x']).code, 2);
});

test('--recheck names the rule spec, not CORE-TEST-SPEC, when the project disabled CORE-TEST-SPEC', (t) => {
  // review save refuses a finding that cites a rule outside rulesChecked (R2-A4).
  const config = inPlaceConfig({ packages: packages(), rules: { disable: [{ id: 'CORE-TEST-SPEC', reason: 'the team proves tests in CI' }] } });
  const { fx, ws, id, app, prove } = committedFix(t, { config });
  assert.equal(prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']).code, 0);
  updateTask(ws, id, (task) => {
    task.phase = 'review';
  });
  write(fx.app, { 'src/sum.mjs': 'export const sum = (a, b) => a + b;\nexport const sum3 = (a, b) => a + b;\n' });
  app('commit', '-qam', '[TASK] Simplify sum3');
  const fix = 'a proof that no longer holds is a blocking finding with rule spec (CORE-TEST-SPEC is disabled in this project).';
  const broken = prove(fx.root, ['--recheck', '--json']);
  assert.equal(broken.code, 1);
  assert.equal(broken.json().fix, fix);
  assert.ok(prove(fx.root, ['--recheck']).stdout.endsWith(`\nFix: ${fix}\n`));
});

test('--recheck re-runs only the current proofs that held: a failed first try does not count', (t) => {
  const { fx, ws, id, prove } = committedFix(t);
  // package.json is unchanged since the base, so this first try does not hold (P1); P2 does.
  assert.equal(prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'package.json']).code, 1);
  assert.equal(prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']).code, 0);
  updateTask(ws, id, (task) => {
    task.phase = 'review';
  });
  const recheck = prove(fx.root, ['--recheck', '--json']);
  assert.equal(recheck.code, 0, recheck.stdout);
  assert.deepEqual(recheck.json().results.map((r) => [r.proof, r.holds]), [['P2', true]]);
});

test('--recheck shows a proof whose test is gone at HEAD as stale, does not count it and does not fail on it', (t) => {
  const { fx, ws, id, app, prove } = committedFix(t);
  assert.equal(prove(fx.root, ['--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']).code, 0);
  app('mv', 'src/sum3.test.mjs', 'src/sum-three.test.mjs');
  app('commit', '-qm', '[TASK] Rename the sum3 test');
  assert.equal(prove(fx.root, ['--test', 'app:src/sum-three.test.mjs', '--change', 'src/sum.mjs']).code, 0);
  updateTask(ws, id, (task) => {
    task.phase = 'review';
  });
  const recheck = prove(fx.root, ['--recheck', '--json']);
  assert.equal(recheck.code, 0, recheck.stderr);
  assert.equal(recheck.json().allHold, true);
  assert.deepEqual(recheck.json().results.map((r) => [r.proof, r.holds, r.stale]), [
    ['P1', undefined, 'the test file src/sum3.test.mjs no longer exists at HEAD'],
    ['P2', true, undefined],
  ]);
  const human = prove(fx.root, ['--recheck']);
  assert.equal(human.stdout, 'P1 app:src/sum3.test.mjs: stale (the test file src/sum3.test.mjs no longer exists at HEAD); not counted\nP2 app:src/sum-three.test.mjs: holds\n');
});

test('worktree mode: the proof runs in the agent worktree, from the main checkout', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig({ packages: packages() }) });
  const { ws, id } = startTask(fx);
  const wt = addAgentWorktree(fx.root, fx.env, 'p1');
  assert.equal(cw(wt, ['ws', 'setup', '--task', id], { env: fx.env }).code, 0);
  const inWt = gitIn(wt, fx.env);
  write(wt, FIX);
  inWt('add', '-A');
  inWt('commit', '-q', '-m', '[FEATURE] Add sum3');
  const worktrees = inWt('worktree', 'list', '--porcelain');
  const result = cw(fx.root, ['prove', '--task', id, '--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs', '--json'], { env: fx.env });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json().head, inWt('rev-parse', 'HEAD'));
  assert.equal(inWt('worktree', 'list', '--porcelain'), worktrees);
  assert.equal(readTask(ws, id).steps.done, 7);
  writeFileSync(join(wt, 'scratch.txt'), 'x');
  assert.equal(cw(fx.root, ['prove', '--task', id, '--recheck'], { env: fx.env }).code, 3, 'a dirty work tree is refused');
  rmSync(join(wt, 'scratch.txt'));
  updateTask(ws, id, (task) => {
    task.base.commit = 'f'.repeat(40);
  });
  const broken = cw(wt, ['prove', '--task', id, '--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs'], { env: fx.env });
  assert.equal(broken.code, 3);
  assert.match(broken.stderr, /Fix: Check base\.commit in task\.json \(git cat-file -t f{40}\)/, 'plain git inside the worktree (D5)');
});
