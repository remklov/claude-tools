import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import { currentProofs, heldProofs, normalizeChange, parseTestSpec, proofsAtHead, singleTestTemplate } from '../../cli/lib/prove.mjs';
import { loadWorkspace } from '../../cli/lib/workspace.mjs';
import { gitIn, inPlaceConfig, makeInPlace, tempBase, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const config = withDefaults(inPlaceConfig({
  packages: [
    { id: 'app', path: '.', areas: ['backend'] },
    { id: 'web', path: 'packages/web', areas: ['frontend'], testSingle: 'node --test {file}' },
  ],
}));

test('parseTestSpec: package-relative and work-repo-relative files give the same paths; bad input is exit 2', () => {
  const relative = parseTestSpec(config, 'web:src/a.test.mjs');
  const repo = parseTestSpec(config, 'web:packages/web/src/a.test.mjs::adds two');
  assert.deepEqual([relative.testPath, relative.testFile, relative.name], ['packages/web/src/a.test.mjs', 'src/a.test.mjs', null]);
  assert.deepEqual([repo.testPath, repo.testFile, repo.name], ['packages/web/src/a.test.mjs', 'src/a.test.mjs', 'adds two']);
  assert.equal(parseTestSpec(config, 'app:./src/sum.test.mjs').testPath, 'src/sum.test.mjs');
  for (const spec of ['nope:a.test.mjs', 'src/a.test.mjs', 'web:../a.test.mjs']) {
    assert.throws(() => parseTestSpec(config, spec), (error) => error.exitCode === 2, spec);
  }
});

test('normalizeChange: work-tree-relative paths, absolute paths inside are relativised, outside is exit 2', (t) => {
  const base = tempBase(t);
  const workTree = join(base, 'app');
  assert.deepEqual(normalizeChange(workTree, ['src/a.mjs', './src/a.mjs', join(workTree, 'src', 'b.mjs')]), ['src/a.mjs', 'src/b.mjs']);
  assert.throws(() => normalizeChange(workTree, ['../outside.mjs']), (error) => error.exitCode === 2);
  assert.throws(() => normalizeChange(workTree, [join(base, 'elsewhere.mjs')]), (error) => error.exitCode === 2 && /outside the work tree/.test(error.message));
});

test('singleTestTemplate: packages[].testSingle wins over a project-local pack testRunner; none is null', (t) => {
  const fx = makeInPlace(t, {
    config: inPlaceConfig({
      packs: ['local-runner'],
      packages: [{ id: 'app', path: '.', areas: ['backend'] }, { id: 'tool', path: 'tool', areas: ['infra'], testSingle: 'node --test {file}' }],
    }),
  });
  write(fx.root, { '.claude/dev-workflow/packs/local-runner/pack.json': { id: 'local-runner', version: '0.1.0', title: 'Local runner', testRunner: { single: 'node --test {file} [--test-name-pattern={name}]' } } });
  const ws = loadWorkspace({ cwd: fx.root });
  assert.deepEqual(singleTestTemplate(ws, ws.config.packages[0]), { template: 'node --test {file} [--test-name-pattern={name}]', source: 'pack local-runner' });
  assert.equal(singleTestTemplate(ws, ws.config.packages[1]).source, 'packages.tool.testSingle');
  assert.equal(singleTestTemplate(ws, ws.config.packages[0], []), null);
});

test('currentProofs keeps the latest proof per test and change set', () => {
  const proofs = [
    { id: 'P1', test: 'app:a.test.mjs', change: ['b.mjs', 'a.mjs'] },
    { id: 'P2', test: 'app:a.test.mjs', change: ['c.mjs'] },
    { id: 'P3', test: 'app:a.test.mjs', change: ['a.mjs', 'b.mjs'] },
  ];
  assert.deepEqual(currentProofs(proofs).map((proof) => proof.id), ['P3', 'P2']);
});

test('heldProofs: of the current proofs only those that held; a later failing run of the same proof wins', () => {
  const proofs = [
    { id: 'P1', test: 'app:a.test.mjs', change: ['a.mjs'], holds: true },
    { id: 'P2', test: 'app:a.test.mjs', change: ['b.mjs'], holds: false },
    { id: 'P3', test: 'app:b.test.mjs', change: ['a.mjs'], holds: true },
    { id: 'P4', test: 'app:b.test.mjs', change: ['a.mjs'], holds: false },
  ];
  assert.deepEqual(heldProofs(proofs).map((proof) => proof.id), ['P1']);
});

test('proofsAtHead: a held proof whose test, or a --change file it had, is gone at HEAD is stale', (t) => {
  const fx = makeInPlace(t, { appFiles: { 'src/old.mjs': 'export const old = 1;\n', 'src/gone.mjs': 'export const gone = 1;\n' } });
  const app = gitIn(fx.app, fx.env);
  const base = app('rev-parse', 'HEAD');
  write(fx.app, { 'src/new.mjs': 'export const x = 1;\n', 'src/new.test.mjs': '// test\n' });
  app('rm', '-q', 'src/gone.mjs');
  app('add', '-A');
  app('commit', '-qm', 'the fix, which deletes gone.mjs');
  const head = app('rev-parse', 'HEAD');
  app('mv', 'src/old.mjs', 'src/older.mjs');
  app('rm', '-q', 'src/new.mjs');
  app('commit', '-qm', 'later');
  const proof = (id, testPath, change, extra = {}) => ({ id, test: `app:${testPath}`, testPath, change, head, holds: true, ...extra });
  const { held, stale } = proofsAtHead(fx.app, base, [
    proof('P1', 'src/new.test.mjs', ['src/new.mjs']),
    proof('P2', 'src/sum.test.mjs', ['src/gone.mjs']),
    proof('P3', 'src/sum.test.mjs', ['src/old.mjs']),
    proof('P4', 'src/missing.test.mjs', ['src/sum.mjs']),
    proof('P5', 'src/new.test.mjs', ['src/sum.mjs'], { head: 'f'.repeat(40) }),
    proof('P6', 'src/new.test.mjs', ['src/nowhere.mjs'], { head: 'f'.repeat(40) }),
    proof('P7', 'src/sum.test.mjs', ['src/sum.mjs'], { holds: false }),
  ]);
  assert.deepEqual(held.map((p) => p.id), ['P2', 'P5'], 'a file the fix deleted is no stale proof');
  assert.deepEqual(stale, [
    { id: 'P1', test: 'app:src/new.test.mjs', reason: 'src/new.mjs no longer exists at HEAD' },
    { id: 'P3', test: 'app:src/sum.test.mjs', reason: 'src/old.mjs no longer exists at HEAD' },
    { id: 'P4', test: 'app:src/missing.test.mjs', reason: 'the test file src/missing.test.mjs no longer exists at HEAD' },
    { id: 'P6', test: 'app:src/new.test.mjs', reason: 'src/nowhere.mjs no longer exists at HEAD' },
  ]);
  assert.deepEqual(proofsAtHead(null, base, [proof('P1', 'src/new.test.mjs', ['src/new.mjs'])]), { held: [proof('P1', 'src/new.test.mjs', ['src/new.mjs'])], stale: [] });
});
