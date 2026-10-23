// The reviewer commands as processes in both workspace modes: a task taken through the implementer steps
// (ws setup, commit, checks, prove, report save) into phase review, then review scope and review save
// from a cwd that is not the work tree (D5), with every refusal of review save.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { readJson } from '../../cli/lib/fsx.mjs';
import { validateSavedReview } from '../../cli/lib/review.mjs';
import { createTask, newTask, readTask, updateTask } from '../../cli/lib/task.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, cw, gitIn, inPlaceConfig, makeInPlace, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const SPEC = `## Task: Sum3

### Acceptance criteria
- [ ] AC1 sum3 adds three numbers

### Non-goals
- Touching the test helpers
- Rounding of the results
`;
const FIX = {
  'src/sum.mjs': 'export const sum = (a, b) => a + b;\nexport const sum3 = (a, b, c) => a + b + c;\n',
  'src/sum3.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum3 } from './sum.mjs';\n\ntest('adds three', () => assert.equal(sum3(1, 2, 3), 6));\n",
};
const REPORT = { status: 'done', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'src/sum3.test.mjs › adds three' }] };
const PACKAGES = [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' }, testSingle: 'node --test {file}' }];

// A feature task that went through the implementer steps and is now in review round 1, as the
// orchestrator's cw task review leaves it.
function reviewedTask(t, layout, { packs = [], packages = PACKAGES, proof = true, rules = null } = {}) {
  const overrides = { packs, packages, ...(rules ? { rules } : {}) };
  const fx = layout === 'in-place'
    ? makeInPlace(t, { config: inPlaceConfig(overrides) })
    : makeWorktreeRepo(t, { config: worktreeConfig(overrides) });
  const ws = loadWorkspace({ cwd: fx.root });
  const branch = 'NO-TICKET/feature/sum-three';
  const { id } = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Sum3', type: 'feature', slug: 'sum-three', branch, ownerSession: 'test-session' }));
  const repo = layout === 'in-place' ? fx.app : fx.root;
  const base = gitIn(repo, fx.env)('rev-parse', 'HEAD');
  updateTask(ws, id, (task) => {
    Object.assign(task, { phase: 'implement', round: 1, packages: ['app'], areas: ['backend'], base: { branch: 'main', commit: base } });
  });
  writeFileSync(taskPath(ws, id, 'spec.md'), SPEC);
  const workTree = realpathSync(layout === 'in-place' ? fx.app : addAgentWorktree(fx.root, fx.env, 'r1'));
  const run = (cwd, args, options) => cw(cwd, [...args, '--task', id], { env: fx.env, ...options });
  assert.equal(run(workTree, ['ws', 'setup']).code, 0);
  const git = gitIn(workTree, fx.env);
  write(workTree, FIX);
  git('add', '-A');
  git('commit', '-q', '-m', '[FEATURE] Add sum3');
  assert.equal(run(workTree, ['checks', '--changed']).code, 0);
  if (proof) assert.equal(run(workTree, ['prove', '--test', 'app:src/sum3.test.mjs', '--change', 'src/sum.mjs']).code, 0);
  const report = run(workTree, ['report', 'save'], { input: JSON.stringify(REPORT) });
  assert.equal(report.code, 0, report.stderr);
  updateTask(ws, id, (task) => {
    task.phase = 'review';
    task.reviewRound = 1;
  });
  const configs = [...new Set([repo, fx.root])].map((dir) => join(dir, '.git', 'config'));
  return { fx, ws, id, branch, base, workTree, git, run, configs };
}

const rulesOf = (s) => s.run(s.fx.root, ['rules', 'applicable', '--json']).json().rules.map((rule) => rule.id);
const approval = (rulesChecked) => ({
  status: 'approved',
  acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'P1 holds: src/sum3.test.mjs fails without src/sum.mjs' }],
  rulesChecked,
  findings: [],
  summary: 'Small change, tested and proved.',
});

for (const layout of ['in-place', 'worktree']) {
  test(`${layout}: review scope and review save run in the task's work tree from outside it`, (t) => {
    const s = reviewedTask(t, layout, { packs: ['vitest'] });
    const outside = s.fx.root;
    const configs = s.configs.map((file) => readFileSync(file));

    const scope = s.run(outside, ['review', 'scope', '--json']);
    assert.equal(scope.code, 0, scope.stderr);
    const value = scope.json();
    assert.deepEqual([value.workTree, value.base, value.head], [s.workTree, s.base, s.git('rev-parse', 'HEAD')]);
    assert.deepEqual(value.changedFiles, ['src/sum.mjs', 'src/sum3.test.mjs']);
    assert.deepEqual(value.diffStat, {
      files: [{ path: 'src/sum.mjs', added: 1, deleted: 0, binary: false }, { path: 'src/sum3.test.mjs', added: 5, deleted: 0, binary: false }],
      added: 6,
      deleted: 0,
    });
    assert.deepEqual([value.commits, value.unowned, value.foreignCommits, value.blocking, value.failingScripts], [1, [], [], [], []]);
    assert.deepEqual(value.nonGoalHints, [{ nonGoal: 'Touching the test helpers', words: ['test'], files: ['src/sum3.test.mjs'] }]);
    assert.deepEqual(value.scripts, [{ script: 'vitest:no-focus', code: 0, passed: true, timedOut: false, tail: '' }]);
    const human = s.run(join(outside, '.claude'), ['review', 'scope']);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /src\/sum3\.test\.mjs\s+\+5\s+-0\ntotal \+6 -0\n/);
    assert.match(human.stdout, /Non-goal hint: "Touching the test helpers" \(test\): src\/sum3\.test\.mjs\nScript vitest:no-focus: pass\nNo blocking scope problems\.\n$/);

    const rules = rulesOf(s);
    assert.ok(rules.includes('VITEST-NO-FOCUS') && !rules.includes('CORE-REPRODUCIBLE-BUILDS'), rules.join(', '));
    const save = (review, args = []) => s.run(outside, ['review', 'save', ...args], { input: JSON.stringify(review) });
    const refused = (review, pattern) => {
      const result = save(review);
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, pattern);
      assert.match(result.stderr, /Fix: Fix each point, then pipe the review to cw review save --task \S+ again\./);
      return result;
    };

    refused(approval(rules), /the proofs were not rechecked since the implementer's report: run cw prove --task \S+ --recheck/);
    const recheck = s.run(outside, ['prove', '--recheck']);
    assert.equal(recheck.code, 0, recheck.stderr);

    refused(approval(rules.slice(1)), /rulesChecked misses CORE-SCOPE: check every rule/);
    refused(approval([...rules, 'CORE-REPRODUCIBLE-BUILDS']), /rulesChecked lists CORE-REPRODUCIBLE-BUILDS, which do not apply to this task/);
    const unknownAc = approval(rules);
    unknownAc.acceptanceCriteria.push({ id: 'AC2', met: true, evidence: 'made up' });
    refused(unknownAc, /AC2 is not an acceptance criterion of the spec \(AC1\): remove it/);

    write(s.workTree, { 'src/extra.mjs': 'export const extra = 1;\n' });
    const stale = save(approval(rules), ['--json']);
    assert.equal(stale.code, 1);
    const { errors } = stale.json().details;
    assert.match(errors.join('\n'), /checks ran on an older state \(tree \w{10}, now \w{10}\): run cw checks --changed --task \S+ again/);
    assert.match(errors.join('\n'), /has uncommitted changes \(src\/extra\.mjs\), which cannot be approved/);
    rmSync(join(s.workTree, 'src', 'extra.mjs'));
    assert.equal(existsSync(taskPath(s.ws, s.id, 'review-1.json')), false, 'nothing was saved');

    const saved = s.run(join(outside, '.claude'), ['review', 'save'], { input: `My review:\n\`\`\`json\n${JSON.stringify(approval(rules))}\n\`\`\`\n` });
    assert.equal(saved.code, 0, saved.stderr);
    assert.match(saved.stdout, /^```json\n[\s\S]*\n```\n$/);
    const review = readJson(taskPath(s.ws, s.id, 'review-1.json'));
    assert.deepEqual(Object.keys(review), [
      'kind', 'version', 'task', 'round', 'reviewRound', 'savedAt', 'status', 'acceptanceCriteria', 'rulesChecked', 'findings', 'summary',
      'head', 'checks', 'proofRecheck', 'rulesApplicable',
    ]);
    assert.deepEqual([review.kind, review.task, review.round, review.reviewRound, review.status], ['review', s.id, 1, 1, 'approved']);
    assert.equal(review.head, s.git('rev-parse', `refs/heads/${s.branch}`));
    assert.deepEqual([review.checks.overall, review.checks.file.startsWith('checks-'), review.proofRecheck.allHold], ['pass', true, true]);
    assert.ok(review.savedAt > review.proofRecheck.at);
    assert.deepEqual(review.rulesApplicable, rules);
    assert.deepEqual(validateSavedReview(review), []);
    assert.equal(readTask(s.ws, s.id).phase, 'review', 'the orchestrator moves the task, not review save');
    assert.deepEqual(s.configs.map((file) => readFileSync(file)), configs, '.git/config is unchanged');

    updateTask(s.ws, s.id, (task) => {
      task.phase = 'deliver';
    });
    const late = save(approval(rules));
    assert.equal(late.code, 3);
    assert.match(late.stderr, /cw review save needs phase review; task \S+ is in deliver\.\nFix: The orchestrator moved the task on; end your turn and say so in one line\./);
    assert.equal(s.run(outside, ['review', 'scope']).code, 3);
  });
}

test('a bug fix without a holding proof cannot be approved; changes_requested with CORE-TEST-SPEC is saved', (t) => {
  const s = reviewedTask(t, 'in-place', { proof: false });
  updateTask(s.ws, s.id, (task) => {
    task.type = 'bugfix';
  });
  const rules = rulesOf(s);
  const save = (review) => s.run(s.fx.root, ['review', 'save', '--json'], { input: JSON.stringify(review) });
  const approved = save(approval(rules));
  assert.equal(approved.code, 1);
  assert.deepEqual(approved.json().details.errors, ['a bugfix without a holding regression proof cannot be approved: save changes_requested with a blocking CORE-TEST-SPEC finding']);

  const finding = { id: 'F1', severity: 'blocking', rule: 'CORE-TEST-SPEC', file: 'src/sum3.test.mjs', issue: 'No regression test was proved to fail without the fix.', suggestion: 'Run cw prove for it.' };
  const result = save({ ...approval(rules), status: 'changes_requested', findings: [finding], summary: undefined });
  assert.equal(result.code, 0, result.stderr);
  const review = result.json();
  assert.deepEqual([review.status, review.findings, review.summary, review.proofRecheck], ['changes_requested', [finding], null, null]);
  assert.deepEqual(readJson(taskPath(s.ws, s.id, 'review-1.json')), review);
});

test('review save refuses an approval while review scope lists a blocking problem; changes_requested is saved', (t) => {
  const s = reviewedTask(t, 'in-place', { packs: ['vitest'], proof: false });
  write(s.workTree, { 'src/focus.test.mjs': "import test from 'node:test';\n\ntest.only('focused', () => {});\n" });
  s.git('add', '-A');
  s.git('commit', '-q', '-m', '[FEATURE] Focus a test');
  assert.equal(s.run(s.workTree, ['checks', '--changed']).code, 0);
  const rules = rulesOf(s);
  const save = (review) => s.run(s.fx.root, ['review', 'save', '--json'], { input: JSON.stringify(review) });
  const approved = save(approval(rules));
  assert.equal(approved.code, 1, approved.stderr);
  const { errors } = approved.json().details;
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /^cw review scope lists a failing scope script: vitest:no-focus failed \(exit 1\): .+src\/focus\.test\.mjs.+; save changes_requested with a blocking finding, or, if the change is accepted \(for example the user approved the dependency\), add a non-blocking finding with rule scope whose issue names vitest:no-focus and says why it is accepted$/);
  const finding = { id: 'F1', severity: 'blocking', rule: 'VITEST-NO-FOCUS', file: 'src/focus.test.mjs', issue: 'test.only focuses the run.' };
  const requested = save({ ...approval(rules), status: 'changes_requested', findings: [finding] });
  assert.equal(requested.code, 0, requested.stderr);
});

test('a failing scope script blocks an approval until a finding with rule scope accepts it', (t) => {
  // dependency-changes fails on every dependency change, also on one the user approved after a blocked
  // report, and also with CORE-DEPENDENCIES disabled (R2-A2).
  const disable = [{ id: 'CORE-DEPENDENCIES', reason: 'the team reviews dependencies by hand' }];
  const s = reviewedTask(t, 'in-place', { packs: ['node-npm'], proof: false, rules: { disable } });
  const pkg = JSON.parse(readFileSync(join(s.workTree, 'package.json'), 'utf8'));
  write(s.workTree, { 'package.json': { ...pkg, dependencies: { 'left-pad': '1.3.0' } } });
  s.git('add', '-A');
  s.git('commit', '-q', '-m', '[FEATURE] Add left-pad');
  assert.equal(s.run(s.workTree, ['checks', '--changed']).code, 0);
  const rules = rulesOf(s);
  assert.ok(!rules.includes('CORE-DEPENDENCIES'), rules.join(', '));
  const save = (review) => s.run(s.fx.root, ['review', 'save', '--json'], { input: JSON.stringify(review) });
  const refused = save(approval(rules));
  assert.equal(refused.code, 1, refused.stderr);
  assert.deepEqual(refused.json().details.errors, [
    'cw review scope lists a failing scope script: node-npm:dependency-changes failed (exit 1): dependency changes (CORE-DEPENDENCIES): package.json dependencies: left-pad — → 1.3.0; save changes_requested with a blocking finding, or, if the change is accepted (for example the user approved the dependency), add a non-blocking finding with rule scope whose issue names node-npm:dependency-changes and says why it is accepted',
  ]);
  const finding = { id: 'F1', severity: 'non_blocking', rule: 'scope', file: 'package.json', issue: 'node-npm:dependency-changes lists left-pad 1.3.0: accepted, the user approved the dependency after the blocked report.' };
  const saved = save({ ...approval(rules), findings: [finding] });
  assert.equal(saved.code, 0, saved.stderr);
  assert.deepEqual([saved.json().status, saved.json().findings], ['approved', [finding]]);
});

test('review scope lists a committed node_modules path as blocking', (t) => {
  const s = reviewedTask(t, 'in-place', { proof: false });
  mkdirSync(join(s.fx.base, 'shared-modules'));
  symlinkSync(join(s.fx.base, 'shared-modules'), join(s.workTree, 'node_modules'));
  s.git('add', '-f', 'node_modules');
  s.git('commit', '-q', '-m', '[TASK] Commit the node_modules link');
  const scope = s.run(s.fx.root, ['review', 'scope', '--json']);
  assert.equal(scope.code, 0, scope.stderr);
  assert.deepEqual(scope.json().blocking, ["node_modules is added by the task's commits: node_modules is never committed"]);
});

test('review scope lists the blocking problems and still exits 0; missing preconditions are exit 3', (t) => {
  const packages = [{ ...PACKAGES[0], path: 'src' }];
  const s = reviewedTask(t, 'in-place', { packs: ['node-npm', 'vitest'], packages, proof: false });
  const scope = () => s.run(s.fx.root, ['review', 'scope', '--json']);
  // Another branch's commit under the task's own, then a dependency and a focused test.
  s.git('switch', '-q', '-c', 'other', s.base);
  write(s.workTree, { 'other.txt': 'other\n' });
  s.git('add', '-A');
  s.git('commit', '-q', '-m', '[TASK] Other work');
  s.git('switch', '-q', s.branch);
  s.git('rebase', '-q', 'other');
  const pkg = JSON.parse(readFileSync(join(s.workTree, 'package.json'), 'utf8'));
  write(s.workTree, {
    'package.json': { ...pkg, dependencies: { 'left-pad': '1.3.0' } },
    'src/focus.test.mjs': "import test from 'node:test';\n\ntest.only('focused', () => {});\n",
  });
  s.git('add', '-A');
  s.git('commit', '-q', '-m', '[FEATURE] Focus a test');
  write(s.workTree, { 'notes.txt': 'draft\n' });

  const result = scope();
  assert.equal(result.code, 0, result.stderr);
  const value = result.json();
  assert.deepEqual(value.unowned, ['other.txt', 'package.json']);
  assert.deepEqual(value.foreignCommits.map((commit) => [commit.subject, commit.alsoOn, commit.reasons]), [['[TASK] Other work', ['other'], ['other-branch']]]);
  assert.deepEqual(value.scripts.map((script) => [script.script, script.code, script.passed]), [['node-npm:dependency-changes', 1, false], ['vitest:no-focus', 1, false]]);
  assert.match(value.scripts[0].tail, /package\.json dependencies: left-pad — → 1\.3\.0/);
  assert.equal(value.blocking.length, 2, value.blocking.join('\n'));
  assert.match(value.blocking[0], /has uncommitted changes \(notes\.txt\); they cannot be approved/);
  assert.match(value.blocking[1], /^foreign commit \w{10} "\[TASK\] Other work" \(other-branch; also on other\): NO-TICKET\/feature\/sum-three must hold only this task's commits$/);
  // A failing script blocks an approval unless a finding with rule scope accepts it (R2-A2).
  assert.deepEqual(value.failingScripts, [
    'node-npm:dependency-changes failed (exit 1): dependency changes (CORE-DEPENDENCIES): package.json dependencies: left-pad — → 1.3.0',
    "vitest:no-focus failed (exit 1): focused/skipped tests (VITEST-NO-FOCUS): src/focus.test.mjs: test.only('focused', () => {});",
  ]);
  const human = s.run(s.fx.root, ['review', 'scope']);
  assert.match(human.stdout, /Script vitest:no-focus: fail \(exit 1\)\n {2}focused\/skipped tests \(VITEST-NO-FOCUS\):\n {2}src\/focus\.test\.mjs: test\.only/);
  assert.match(human.stdout, /Blocking scope problems \(each one is a blocking finding\):\n- .+notes\.txt.+\n- foreign commit .+\n/);
  assert.match(human.stdout, /\nFailing scope scripts \(each one is a blocking finding, unless the change is accepted, for example the user approved the dependency: then a non-blocking finding with rule scope names the script and says why\):\n- node-npm:dependency-changes failed \(exit 1\): .+\n- vitest:no-focus failed/);

  s.git('switch', '-q', 'main');
  assert.match(scope().json().blocking[0], /is on main, not on the task branch NO-TICKET\/feature\/sum-three$/);

  const precondition = (change, pattern) => {
    const before = readTask(s.ws, s.id);
    updateTask(s.ws, s.id, change);
    const refused = s.run(s.fx.root, ['review', 'scope']);
    assert.equal(refused.code, 3, refused.stderr);
    assert.match(refused.stderr, pattern);
    updateTask(s.ws, s.id, (task) => Object.assign(task, { phase: before.phase, base: before.base, workTree: before.workTree }));
  };
  precondition((task) => {
    task.base = null;
  }, /has no recorded base commit\.\nFix: End your turn and tell the orchestrator in one line/);
  precondition((task) => {
    task.workTree = join(s.fx.base, 'gone');
  }, /has no work tree: .+gone does not exist/);
  precondition((task) => {
    task.phase = 'implement';
  }, /cw review scope needs phase review; task \S+ is in implement/);
  s.git('branch', '-q', '-D', s.branch);
  const noBranch = s.run(s.fx.root, ['review', 'scope']);
  assert.equal(noBranch.code, 3);
  assert.match(noBranch.stderr, /The task branch NO-TICKET\/feature\/sum-three does not exist in /);
});

for (const layout of ['in-place', 'worktree']) {
  test(`${layout}: cw review diff, log and status read the task's work tree from the project root, options are refused`, (t) => {
    const s = reviewedTask(t, layout);
    const read = (args) => s.run(s.fx.root, ['review', ...args]);
    const diff = read(['diff']);
    assert.equal(diff.code, 0, diff.stderr);
    assert.match(diff.stdout, /^diff --git a\/src\/sum\.mjs b\/src\/sum\.mjs[^]*\+export const sum3/m);
    assert.match(read(['diff', '--stat']).stdout, /src\/sum3\.test\.mjs \| +\d+ \+/);
    assert.doesNotMatch(read(['diff', '--', 'src/sum.mjs']).stdout, /sum3\.test/);
    const log = read(['log']);
    assert.match(log.stdout, /^commit [0-9a-f]{40}\n[^]*\[FEATURE\] Add sum3/m);
    const head = s.git('rev-parse', 'HEAD');
    assert.match(read(['log', '--rev', head.slice(0, 10), '--stat']).stdout, /\[FEATURE\] Add sum3[^]*src\/sum\.mjs/);
    assert.match(read(['log', '--rev', `${head}:src/sum.mjs`]).stdout, /^export const sum3/m);
    assert.match(read(['status']).stdout, /^## /);
    for (const rev of ['--output=/tmp/x', '-c core.pager=evil', '$(id)']) {
      const refused = read(['log', '--rev', rev]);
      assert.notEqual(refused.code, 0, rev);
    }
    assert.equal(read(['status', '--', 'src']).code, 2, 'status takes no paths');
  });
}
