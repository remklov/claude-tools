import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { cw, gitIn, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';
import { harness, inPlace, specified } from './cycle-fixture.mjs';

// A commit on origin's branch from a second clone, as a teammate's merge would leave it. Returns its sha.
function pushUpstream(fx, remote, files, branch = 'main') {
  const clone = mkdtempSync(join(fx.base, 'clone-'));
  execFileSync('git', ['clone', '-q', '-b', 'main', remote, clone], { env: fx.env });
  const git = gitIn(clone, fx.env);
  write(clone, files);
  git('add', '-A');
  git('commit', '-q', '-m', 'Upstream change');
  git('push', '-q', 'origin', `HEAD:${branch}`);
  return git('rev-parse', 'HEAD');
}

const context = (fx, key = 'NO-TICKET') => cw(fx.root, ['ticket', 'context', '--ticket', key], { env: fx.env });
const contextJson = (fx, key = 'NO-TICKET') => cw(fx.root, ['ticket', 'context', '--ticket', key, '--json'], { env: fx.env }).json();

test('ticket context fast-forwards the checked-out base to origin before it reads the ticket', (t) => {
  const fx = makeWorktreeRepo(t);
  const git = gitIn(fx.root, fx.env);
  const upstream = pushUpstream(fx, fx.remote, { 'docs/tickets/APP-7.md': '# Export\n' });
  pushUpstream(fx, fx.remote, { 'export.txt': 'x\n' }, 'APP-7/feature/export');

  const result = context(fx, 'APP-7');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Base: main fast-forwarded by 1 commit to origin\/main \(\w{10}\)\.\nAPP-7 · source local: the ticket is docs\/tickets\/APP-7\.md/);
  assert.equal(result.stderr, '');
  assert.equal(git('rev-parse', 'main'), upstream);
  assert.equal(readFileSync(join(fx.root, 'docs/tickets/APP-7.md'), 'utf8'), '# Export\n', 'the files moved with the branch');
  assert.match(result.stdout, /branch origin\/APP-7\/feature\/export/, 'the fetch brought the remote branches that name the key');

  const again = contextJson(fx);
  assert.deepEqual(again.baseUpdate, { state: 'current', branch: 'main', remote: 'origin/main', needsUser: false, commit: upstream });
});

test('ticket context leaves the base alone and asks the user when a fast-forward is not possible', (t) => {
  const fx = makeWorktreeRepo(t);
  const git = gitIn(fx.root, fx.env);
  pushUpstream(fx, fx.remote, { 'src/sum.mjs': 'export const sum = (a, b) => b + a;\n' });

  // A local change in a file the update touches: git refuses, and the change stays.
  write(fx.root, { 'src/sum.mjs': '// local\n' });
  const local = git('rev-parse', 'main');
  const blocked = context(fx);
  assert.equal(blocked.code, 0);
  assert.match(blocked.stderr, /warning: Base: main is 1 commit behind origin\/main, and the fast-forward failed: .*src\/sum\.mjs.* Ask the user whether to go on with the local main or to stop and bring it up to date first\./);
  assert.equal(git('rev-parse', 'main'), local);
  assert.equal(readFileSync(join(fx.root, 'src/sum.mjs'), 'utf8'), '// local\n');
  assert.equal(contextJson(fx).baseUpdate.needsUser, true);
  git('checkout', '--', 'src/sum.mjs');

  // A local commit as well: diverged.
  write(fx.root, { 'local.txt': 'x\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'Local commit');
  assert.deepEqual(contextJson(fx).baseUpdate, { state: 'diverged', branch: 'main', remote: 'origin/main', needsUser: true, commit: git('rev-parse', 'main'), ahead: 1, behind: 1 });

  // Only the local commit: ahead.
  git('reset', '-q', '--hard', 'origin/main');
  write(fx.root, { 'local.txt': 'x\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'Local commit');
  const ahead = context(fx);
  assert.match(ahead.stderr, /warning: Base: main has 1 commit that origin\/main lacks; the task branch would carry them into the PR\/MR\./);
});

test('ticket context moves a base that is not checked out without touching the work tree, but not one checked out elsewhere', (t) => {
  const fx = makeWorktreeRepo(t);
  const git = gitIn(fx.root, fx.env);
  git('switch', '-q', '-c', 'wip');
  write(fx.root, { 'wip.txt': 'mine\n' });
  const upstream = pushUpstream(fx, fx.remote, { 'new.txt': 'x\n' });

  const moved = contextJson(fx);
  assert.equal(moved.baseUpdate.state, 'updated');
  assert.equal(git('rev-parse', 'main'), upstream);
  assert.equal(git('branch', '--show-current'), 'wip');
  assert.equal(readFileSync(join(fx.root, 'wip.txt'), 'utf8'), 'mine\n');
  assert.throws(() => readFileSync(join(fx.root, 'new.txt')), 'the work tree on wip stays as it was');

  const other = join(fx.base, 'other');
  git('worktree', 'add', '-q', other, 'main');
  pushUpstream(fx, fx.remote, { 'newer.txt': 'x\n' });
  const elsewhere = contextJson(fx).baseUpdate;
  assert.equal(elsewhere.state, 'elsewhere');
  assert.equal(elsewhere.behind, 1);
  assert.equal(git('rev-parse', 'main'), upstream);
});

test('ticket context reports a failed fetch, no remote and git.updateBase false', (t) => {
  const fx = makeWorktreeRepo(t);
  const git = gitIn(fx.root, fx.env);
  git('remote', 'set-url', 'origin', join(fx.base, 'gone.git'));
  const failed = context(fx);
  assert.equal(failed.code, 0);
  assert.match(failed.stderr, /warning: Base: git fetch origin failed \(.+\); main may be behind origin\/main\. Ask the user/);

  git('remote', 'remove', 'origin');
  const none = context(fx);
  assert.match(none.stdout, /^Base: no remote origin; main stays as it is\./);
  assert.equal(none.stderr, '');

  const off = makeWorktreeRepo(t, { config: worktreeConfig({ git: { noTicketKey: 'NO-TICKET', updateBase: false } }) });
  const local = gitIn(off.root, off.env)('rev-parse', 'main');
  pushUpstream(off, off.remote, { 'new.txt': 'x\n' });
  const skipped = context(off);
  assert.doesNotMatch(skipped.stdout, /Base:/);
  assert.equal(gitIn(off.root, off.env)('rev-parse', 'main'), local);
  assert.equal(gitIn(off.root, off.env)('rev-parse', '--verify', '--quiet', 'origin/main'), local, 'nothing was fetched');
});

test('task start records the base after the fast-forward, and starts from the local base when it cannot update', (t) => {
  const fx = inPlace(t);
  const { ok } = harness(fx);
  const { id } = specified(fx);
  const upstream = pushUpstream(fx, fx.remote, { 'src/div.mjs': 'export const div = (a, b) => a / b;\n' });

  const started = ok(fx.root, ['task', 'start', '--task', id]);
  assert.equal(started.baseUpdate.state, 'updated');
  assert.deepEqual(started.base, { branch: 'main', commit: upstream });
  assert.equal(gitIn(fx.app, fx.env)('rev-parse', 'HEAD'), upstream, 'app/ is on main and moved with it');

  const second = inPlace(t);
  const { id: other } = specified(second);
  gitIn(second.app, second.env)('remote', 'set-url', 'origin', join(second.base, 'gone.git'));
  const local = gitIn(second.app, second.env)('rev-parse', 'main');
  const fallback = harness(second).run(second.root, ['task', 'start', '--task', other]);
  assert.equal(fallback.code, 0, fallback.stderr);
  assert.match(fallback.stderr, new RegExp(`warning: Base: git fetch origin failed \\(.+\\)[^]*The task starts from the local main at ${local.slice(0, 10)}: tell the user in one line\\.`));
  assert.match(fallback.stdout, /Call the Agent tool with exactly these parameters:/);
});
