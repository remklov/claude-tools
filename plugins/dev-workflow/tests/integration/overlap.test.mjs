import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readJson, writeJson } from '../../cli/lib/fsx.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, gitIn, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';
import { PACKAGES, harness } from './cycle-fixture.mjs';

const specOf = (branch, context) => `## Task: Change ${context}

**Ticket:** NO-TICKET · **Type:** feature · **Branch:** ${branch}

### Context
\`${context}\` changes.

### Requirements
- R1 Change ${context}.

### Acceptance criteria
- [ ] AC1 The change is tested.

### Non-goals
- Nothing else.

### Risks and deploy steps
- None.

### Definition of done
- Checks pass.
`;

const repo = (t, workflow = {}) => makeWorktreeRepo(t, { config: worktreeConfig({ packages: PACKAGES, workflow }) });

// A NO-TICKET task up to its classification, with a spec whose Context names one path.
function classified(fx, slug, path) {
  const { ok } = harness(fx);
  const { task: id, branch } = ok(fx.root, ['task', 'new', '--ticket', 'NO-TICKET', '--slug', slug, '--title', `Change ${path}`, '--type', 'feature']);
  ok(fx.root, ['ticket', 'save', '--task', id], JSON.stringify({ key: 'NO-TICKET', summary: `Change ${path}`, source: 'notes' }));
  ok(fx.root, ['spec', 'save', '--task', id], specOf(branch, path));
  ok(fx.root, ['classify', '--task', id]);
  ok(fx.root, ['classify', '--task', id, '--set', 's', '--why', 'One small change.']);
  return id;
}

const start = (fx, id, extra = []) => harness(fx).run(fx.root, ['task', 'start', '--task', id, ...extra]);

test('task start refuses a task that plans a file another open task plans or changes, until the user accepts', (t) => {
  const fx = repo(t);
  const first = classified(fx, 'sum-first', 'src/sum.mjs');
  assert.equal(start(fx, first).code, 0);

  const second = classified(fx, 'sum-second', 'src/sum.mjs');
  const refused = start(fx, second);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, new RegExp(`overlaps with open tasks[^]*- ${first} \\(NO-TICKET, phase implement\\): files src/sum\\.mjs; packages app`));
  assert.match(refused.stderr, new RegExp(`cw task start --task ${second} --accept-overlap "<the user's reason>"`));

  const accepted = start(fx, second, ['--accept-overlap', 'the user takes the conflict']);
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.match(accepted.stdout, new RegExp(`Overlap \\(accepted by the user\\): ${first} `));
  const ws = loadWorkspace({ cwd: fx.root });
  const history = readJson(taskPath(ws, second, 'task.json')).history.at(-1);
  assert.match(history.note, new RegExp(`overlap with ${first} accepted: the user takes the conflict`));
});

test('task start compares with the files an open task changed, and only notes a shared package', (t) => {
  const fx = repo(t);
  const { ok } = harness(fx);
  const first = classified(fx, 'sum-first', 'src/sum.mjs');
  ok(fx.root, ['task', 'start', '--task', first]);
  const tree = addAgentWorktree(fx.root, fx.env, 'one');
  ok(tree, ['ws', 'setup', '--task', first]);
  write(tree, { 'src/extra.mjs': 'export const extra = 1;\n' });

  const planned = classified(fx, 'extra-second', 'src/extra.mjs');
  assert.match(start(fx, planned).stderr, new RegExp(`${first} \\(NO-TICKET, phase implement\\): files src/extra\\.mjs`));

  const elsewhere = classified(fx, 'other-third', 'src/other.mjs');
  const noted = start(fx, elsewhere);
  assert.equal(noted.code, 0, noted.stderr);
  assert.match(noted.stdout, new RegExp(`Same package, no file in common: ${first} \\(NO-TICKET, phase implement\\): packages app`));
});

test('task start refuses two tasks in one exclusive area with different files', (t) => {
  const fx = repo(t, { exclusivePaths: ['migrations/**'] });
  const first = classified(fx, 'migration-one', 'migrations/001_users.sql');
  assert.equal(start(fx, first).code, 0);
  const second = classified(fx, 'migration-two', 'migrations/002_orders.sql');
  const refused = start(fx, second);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /: exclusive migrations\/\*\*; packages app/);
});

test('an ended task counts until origin\'s base holds its branch', (t) => {
  const fx = repo(t);
  const { ok } = harness(fx);
  const first = classified(fx, 'sum-first', 'src/sum.mjs');
  ok(fx.root, ['task', 'start', '--task', first]);
  const tree = addAgentWorktree(fx.root, fx.env, 'one');
  ok(tree, ['ws', 'setup', '--task', first]);
  write(tree, { 'src/sum.mjs': 'export const sum = (a, b) => b + a;\n' });
  const git = gitIn(tree, fx.env);
  git('commit', '-q', '-am', 'Swap the operands');
  // Ended done with a PR: the state cw task end leaves.
  const ws = loadWorkspace({ cwd: fx.root });
  const file = taskPath(ws, first, 'task.json');
  writeJson(file, { ...readJson(file), phase: 'done', outcome: 'done', endedAt: new Date().toISOString(), prUrl: 'https://github.com/acme/app/pull/1' });

  const second = classified(fx, 'sum-second', 'src/sum.mjs');
  assert.match(start(fx, second).stderr, new RegExp(`${first} \\(NO-TICKET, ended, PR https://github\\.com/acme/app/pull/1 not merged\\): files src/sum\\.mjs`));

  // The PR is merged: origin's base holds the branch, and the start's base update fetches it.
  git('push', '-q', 'origin', `HEAD:main`);
  const started = start(fx, second);
  assert.equal(started.code, 0, started.stderr);
  assert.doesNotMatch(started.stdout, /Overlap|Same package/);
});
