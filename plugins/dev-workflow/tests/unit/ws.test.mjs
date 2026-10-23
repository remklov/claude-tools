import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { createTask, newTask, readTask, updateTask } from '../../cli/lib/task.mjs';
import { loadWorkspace } from '../../cli/lib/workspace.mjs';
import { requireWorkTree, setupWorkTree } from '../../cli/lib/ws.mjs';
import { addAgentWorktree, gitIn, makeInPlace, makeWorktreeRepo, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const BRANCH = 'NO-TICKET/feature/mul-helper';

// A task in phase implement with the base recorded, as cw task start leaves it.
function implementTask(root, base) {
  const ws = loadWorkspace({ cwd: root });
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Mul', type: 'feature', slug: 'mul-helper', branch: BRANCH, ownerSession: 's1' }));
  updateTask(ws, task.id, (x) => {
    x.phase = 'implement';
    x.round = 1;
    x.base = base;
  });
  return { ws, task: readTask(ws, task.id) };
}

test('in-place: refuses a dirty app, another branch and an existing task branch with exit 3 and "report blocked"', (t) => {
  const fx = makeInPlace(t);
  const app = gitIn(fx.app, fx.env);
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: app('rev-parse', 'HEAD') });
  const blocked = (pattern) => (error) => error.exitCode === 3 && pattern.test(error.message) && /^Report blocked/.test(error.fix);

  write(fx.app, { 'scratch.txt': 'x' });
  assert.throws(() => setupWorkTree(ws, task, { cwd: fx.root }), blocked(/uncommitted changes \(1 files: scratch\.txt\)/));
  app('clean', '-fq');

  app('switch', '-q', '-c', 'other');
  assert.throws(() => setupWorkTree(ws, task, { cwd: fx.root }), blocked(/is on other, not on the recorded base main/));
  app('switch', '-q', 'main');

  app('branch', BRANCH);
  assert.throws(() => setupWorkTree(ws, task, { cwd: fx.root }), blocked(/exists already/));
  app('branch', '-D', BRANCH);

  assert.throws(() => setupWorkTree(ws, { ...task, base: null }, { cwd: fx.root }), blocked(/no recorded base/));
  assert.throws(() => setupWorkTree(ws, { ...task, phase: 'review' }, { cwd: fx.root }), (error) => error.exitCode === 3 && /needs phase implement/.test(error.message));
});

test('in-place: the task branch starts at the current HEAD of the base, base.commit follows it, a rerun is a no-op', (t) => {
  const fx = makeInPlace(t);
  const app = gitIn(fx.app, fx.env);
  const recorded = app('rev-parse', 'HEAD');
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: recorded });
  write(fx.app, { 'later.txt': 'pulled after task start\n' });
  app('add', '-A');
  app('commit', '-q', '-m', 'later');
  const head = app('rev-parse', 'HEAD');
  const configs = [join(fx.root, '.git', 'config'), join(fx.app, '.git', 'config')].map((file) => [file, readFileSync(file)]);

  const result = setupWorkTree(ws, task, { cwd: join(fx.app, 'src') });
  assert.equal(result.created, true);
  assert.equal(result.workTree, realpathSync(fx.app));
  assert.equal(app('branch', '--show-current'), BRANCH);
  assert.equal(gitIn(fx.root, fx.env)('branch', '--show-current'), 'main', 'the outer repo is untouched');
  const saved = readTask(ws, task.id);
  assert.deepEqual(saved.base, { branch: 'main', commit: head });
  assert.equal(saved.steps.done, 1);

  const again = setupWorkTree(ws, saved, { cwd: fx.root });
  assert.equal(again.created, false);
  assert.equal(readTask(ws, task.id).base.commit, head);
  for (const [file, bytes] of configs) assert.deepEqual(readFileSync(file), bytes, `${file} is unchanged`);
});

test('worktree: refuses the main checkout, a foreign worktree, a non-agent branch and an existing task branch', (t) => {
  const fx = makeWorktreeRepo(t);
  const main = gitIn(fx.root, fx.env);
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: main('rev-parse', 'HEAD') });
  assert.throws(() => setupWorkTree(ws, task, { cwd: fx.root }), (error) => error.exitCode === 3 && /is the main checkout/.test(error.message) && /isolation "worktree"/.test(error.fix));

  const other = makeWorktreeRepo(t);
  const foreign = addAgentWorktree(other.root, other.env, 'zzz');
  assert.throws(() => setupWorkTree(ws, task, { cwd: foreign }), (error) => error.exitCode === 3 && /another repository/.test(error.message));

  const wt = addAgentWorktree(fx.root, fx.env, 'one');
  gitIn(wt, fx.env)('switch', '-q', '-c', 'some-branch');
  assert.throws(() => setupWorkTree(ws, task, { cwd: wt }), (error) => error.exitCode === 3 && /not on the worktree-agent-\* branch/.test(error.message));

  const wt2 = addAgentWorktree(fx.root, fx.env, 'two');
  main('branch', BRANCH);
  assert.throws(() => setupWorkTree(ws, task, { cwd: wt2 }), (error) => error.exitCode === 3 && /exists already/.test(error.message));
});

test('worktree: git switch -c at base.commit in the agent worktree, recorded as a realpath; .git/config unchanged', (t) => {
  const fx = makeWorktreeRepo(t);
  const main = gitIn(fx.root, fx.env);
  const baseCommit = main('rev-parse', 'HEAD');
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: baseCommit });
  write(fx.root, { 'ahead.txt': 'x\n' });
  main('add', '-A');
  main('commit', '-q', '-m', 'ahead');
  const wt = addAgentWorktree(fx.root, fx.env, 'abc');
  const config = readFileSync(join(fx.root, '.git', 'config'));

  const result = setupWorkTree(loadWorkspace({ cwd: wt }), task, { cwd: join(wt, 'src') });
  assert.equal(result.created, true);
  assert.equal(result.agentBranch, 'worktree-agent-abc');
  const inWt = gitIn(wt, fx.env);
  assert.equal(inWt('branch', '--show-current'), BRANCH);
  assert.equal(inWt('rev-parse', 'HEAD'), baseCommit, 'the branch starts at the recorded base, not at the worktree HEAD');
  const saved = readTask(ws, task.id);
  assert.equal(saved.workTree, realpathSync(wt));
  assert.equal(saved.agentBranch, 'worktree-agent-abc');
  assert.equal(requireWorkTree(ws, saved), realpathSync(wt));
  assert.equal(setupWorkTree(ws, saved, { cwd: wt }).created, false);
  assert.deepEqual(readFileSync(join(fx.root, '.git', 'config')), config);
});

test('in-place: the task branch gets no upstream, also with branch.autoSetupMerge=inherit', (t) => {
  const fx = makeInPlace(t);
  const app = gitIn(fx.app, fx.env);
  app('fetch', '-q', 'origin');
  app('branch', '-q', '--set-upstream-to=origin/main', 'main');
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: app('rev-parse', 'HEAD') });
  const config = join(fx.app, '.git', 'config');
  const before = readFileSync(config, 'utf8');
  const inherit = join(fx.base, 'gitconfig-inherit');
  writeFileSync(inherit, '[branch]\n\tautoSetupMerge = inherit\n');
  process.env.GIT_CONFIG_GLOBAL = inherit;
  t.after(() => {
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  });
  assert.equal(setupWorkTree(ws, task, { cwd: fx.root }).created, true);
  assert.equal(readFileSync(config, 'utf8'), before, 'no [branch] section for the task branch');
});

test('in-place: with resumeBranch, a clean app on the base switches back to the existing task branch', (t) => {
  const fx = makeInPlace(t);
  const app = gitIn(fx.app, fx.env);
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: app('rev-parse', 'HEAD') });
  app('branch', BRANCH);
  assert.throws(() => setupWorkTree(ws, task, { cwd: fx.root }), (error) => error.exitCode === 3 && /exists already/.test(error.message));
  const result = setupWorkTree(ws, { ...task, resumeBranch: true }, { cwd: fx.root });
  assert.equal(result.created, false);
  assert.equal(app('branch', '--show-current'), BRANCH);
  assert.equal(readTask(ws, task.id).resumeBranch, false);
});

test('worktree: commits on the agent branch that no other branch holds block ws setup; a dirty worktree is stashed, not committed', (t) => {
  const fx = makeWorktreeRepo(t);
  const main = gitIn(fx.root, fx.env);
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: main('rev-parse', 'HEAD') });
  const wt = addAgentWorktree(fx.root, fx.env, 'early');
  const inWt = gitIn(wt, fx.env);
  write(wt, { 'early.txt': 'x\n' });
  assert.throws(() => setupWorkTree(ws, task, { cwd: wt }), (error) => error.exitCode === 3 && /uncommitted changes/.test(error.message) && /asks the user to stash or discard them/.test(error.fix));
  inWt('add', '-A');
  inWt('commit', '-q', '-m', 'early');
  assert.throws(
    () => setupWorkTree(ws, task, { cwd: wt }),
    (error) => error.exitCode === 3 && /has 1 commit\(s\) on worktree-agent-early that no other branch holds/.test(error.message) && /^Report blocked/.test(error.fix),
  );
  assert.equal(inWt('branch', '--show-current'), 'worktree-agent-early');
  main('branch', 'keep-early', 'worktree-agent-early');
  assert.equal(setupWorkTree(ws, task, { cwd: wt }).created, true, 'held by another branch, the commit is safe');
});

test('requireWorkTree: exit 3 before ws setup in worktree mode', (t) => {
  const fx = makeWorktreeRepo(t);
  const { ws, task } = implementTask(fx.root, { branch: 'main', commit: gitIn(fx.root, fx.env)('rev-parse', 'HEAD') });
  assert.throws(() => requireWorkTree(ws, task), (error) => error.exitCode === 3 && error.fix.includes(`cw ws setup --task ${task.id}`));
  assert.throws(() => requireWorkTree(ws, { ...task, workTree: join(fx.base, 'gone') }), (error) => error.exitCode === 3 && /does not exist/.test(error.message));
});
