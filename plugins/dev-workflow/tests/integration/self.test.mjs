// A task the orchestrator implements itself (ADR 0019): no implementer agent, the implementer's commands
// run from the project root against the task's work tree, cw commits for it, and the reviewer stays an
// agent. In place and in worktree mode, where cw adds the work tree itself.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { gitIn, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';
import { DONE, MUL, PACKAGES, blocking, harness, inPlace, specified, taskJson, writeReview } from './cycle-fixture.mjs';

const SELF = { selfImplement: ['s'] };

// The implementer's steps 1 to 8, run by the orchestrator from the project root.
function implementYourself(fx, id, tree, { files = MUL, summary = 'Add the mul helper' } = {}) {
  const { ok } = harness(fx);
  ok(fx.root, ['ws', 'setup', '--task', id]);
  write(tree, files);
  const single = ok(fx.root, ['test', '--task', id, '--test', 'app:src/mul.test.mjs']);
  assert.equal(single.passed, true);
  const rulesChecked = ok(fx.root, ['rules', 'applicable', '--task', id]).rules.map((rule) => rule.id);
  ok(fx.root, ['checks', '--changed', '--task', id]);
  const committed = ok(fx.root, ['commit', 'msg', '--task', id, '--summary', summary, '--keyword', 'FEATURE', '--commit']);
  ok(fx.root, ['commit', 'lint', '--task', id]);
  return { committed, rulesChecked };
}

test('in place: the orchestrator implements an s task itself; the reviewer is an agent; findings come back to it', (t) => {
  const fx = inPlace(t, { workflow: SELF });
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id, branch } = specified(fx);
  const started = run(fx.root, ['task', 'start', '--task', id]);
  assert.equal(started.code, 0, started.stderr);
  assert.match(started.stdout, /^You implement this task yourself: complexity s is in workflow\.selfImplement \(ADR 0019\)\. Follow cw playbook read steps\/o6-self\.md; the brief is \S+brief-implementer\.md\./m);
  assert.doesNotMatch(started.stdout, /Call the Agent tool/);
  assert.match(started.stdout, new RegExp(`Next: cw ws setup --task ${id}; then cw task review --task ${id} once your report is saved`));
  assert.equal(taskJson(fx, id).self, true);

  const { committed, rulesChecked } = implementYourself(fx, id, fx.app);
  assert.deepEqual([committed.commit.files, committed.commit.subject], [2, '[FEATURE] Add the mul helper']);
  assert.equal(app('log', '-1', '--format=%s', branch), '[FEATURE] Add the mul helper');
  assert.ok(ok(fx.root, ['context', '--task', id]).next.some((line) => line.endsWith('--keyword FEATURE|BUGFIX|TASK|DOCS --commit')));
  ok(fx.root, ['prove', '--task', id, '--test', 'app:src/mul.test.mjs', '--change', 'src/mul.mjs']);
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify({ ...DONE, rulesChecked }));

  const review = ok(fx.root, ['task', 'review', '--task', id]);
  assert.equal(review.agentCall.subagent_type, 'dev-workflow:reviewer', 'the review stays independent');
  assert.equal(review.warnings, undefined);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: app('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  const back = ok(fx.root, ['task', 'return', '--task', id]);
  assert.equal(back.sendMessage, undefined);
  assert.equal(back.agentCall, undefined);
  assert.deepEqual(back.selfImplement.findings, ['- [blocking · CORE-ERRORS] src/mul.mjs:1: No input check — Reject non-numbers']);
  assert.deepEqual(back.next, [`cw task review --task ${id} once your report is saved`]);
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).round, taskJson(fx, id).self], ['implement', 2, true]);
  assert.match(run(fx.root, ['report', 'show', '--task', id]).stderr, /You implement this task yourself: finish with cw report save/);

  // Handing the work to an agent: --new-agent.
  const handed = ok(fx.root, ['task', 'start', '--task', id, '--new-agent']);
  assert.equal(handed.agentCall.subagent_type, 'dev-workflow:implementer-s');
  assert.equal(taskJson(fx, id).self, false);
});

test('task start --agent delegates a task of workflow.selfImplement anyway', (t) => {
  const fx = inPlace(t, { workflow: SELF });
  const { ok } = harness(fx);
  const { id } = specified(fx);
  assert.equal(ok(fx.root, ['task', 'start', '--task', id, '--agent']).agentCall.subagent_type, 'dev-workflow:implementer-s');
  assert.equal(taskJson(fx, id).self, false);
});

test('worktree mode: cw adds the work tree on the task branch, links node_modules and commits without it', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig({ packages: PACKAGES, workflow: SELF }) });
  const { run, ok } = harness(fx);
  const main = gitIn(fx.root, fx.env);
  mkdirSync(join(fx.root, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(fx.root, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  const setup = ok(fx.root, ['ws', 'setup', '--task', id]);
  const tree = setup.workTree;
  assert.ok(tree.endsWith(join('.claude', 'worktrees', `self-${id}`)), tree);
  assert.equal(gitIn(tree, fx.env)('branch', '--show-current'), branch);
  assert.ok(lstatSync(join(tree, 'node_modules')).isSymbolicLink(), 'node_modules is linked from the main checkout');
  assert.equal(ok(fx.root, ['ws', 'setup', '--task', id]).created, false, 'a second setup confirms it');

  const { committed } = implementYourself(fx, id, tree);
  assert.equal(committed.commit.files, 2, 'the node_modules link stays out of the commit');
  assert.doesNotMatch(main('show', '--stat', '--format=', branch), /node_modules/);
  assert.equal(run(fx.root, ['commit', 'msg', '--task', id, '--summary', 'Again', '--keyword', 'TASK', '--commit']).code, 3, 'nothing to commit');

  // After the delivery, cleanup removes the worktree and keeps the task branch.
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify({ ...DONE, rulesChecked: ok(fx.root, ['rules', 'applicable', '--task', id]).rules.map((rule) => rule.id) }));
  ok(fx.root, ['task', 'review', '--task', id]);
  writeReview(fx, id, 1, 'approved', { head: main('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  ok(fx.root, ['pr', 'record', '--task', id, '--skipped', 'No remote in the test.']);
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', id]).action, 'removed');
  assert.equal(existsSync(tree), false);
  assert.notEqual(main('branch', '--list', branch), '', 'the task branch stays');
});
