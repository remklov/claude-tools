// The delegation cycle off the happy path, as processes: one in-place task at a time (D6), a lost or
// replaced implementer, agents of an earlier session after a rebind (D3), a work tree that left the
// task branch, kept work after a misclassification, commits after an approval, and the main checkout
// of a separate git dir.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { readJson } from '../../cli/lib/fsx.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, cw, gitIn, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';
import {
  BLOCKED, PACKAGES, STRICT_MUL, blocking, harness, implement, inPlace, misclassified, spec, specified, taskJson, writeReview,
} from './cycle-fixture.mjs';

const worktreeFixture = (t) => makeWorktreeRepo(t, { config: worktreeConfig({ packages: PACKAGES }) });
const asSession = (fx, session) => harness({ ...fx, env: { ...fx.env, CLAUDE_CODE_SESSION_ID: session } });
const R2 = '- R1 Export mul(a, b) from src/mul.mjs.\n- R2 Export div(a, b) as well.';

test('in place: task start refuses while another started task holds app/ (D6)', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const first = specified(fx);
  ok(fx.root, ['task', 'start', '--task', first.id]);
  ok(fx.root, ['ws', 'setup', '--task', first.id]);
  const second = specified(fx, { slug: 'second-task' });

  const refused = run(fx.root, ['task', 'start', '--task', second.id]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, new RegExp(`app is the work tree of the active task ${first.id} \\(phase implement\\)`));
  assert.match(refused.stderr, new RegExp(`Fix: Finish ${first.id} first, or drop it after asking the user: cw task end --task ${first.id} --outcome aborted, then cw task cleanup --task ${first.id}\\.`));
  assert.equal(taskJson(fx, second.id).phase, 'classify');

  ok(fx.root, ['task', 'end', '--task', first.id, '--outcome', 'aborted']);
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', first.id]).action, 'switched');
  assert.equal(ok(fx.root, ['task', 'start', '--task', second.id]).round, 1);
});

test('in place: a brief that cannot be rendered leaves the task as it was; task start --new-agent replaces a lost implementer', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id, branch } = specified(fx);
  const broken = { '.claude/dev-workflow/procedures/tester/check.md': '---\nname: check\ndescription: x\n---\nBody.\n' };
  const brokenDir = join(fx.root, '.claude', 'dev-workflow', 'procedures', 'tester');

  write(fx.root, broken);
  assert.equal(run(fx.root, ['task', 'start', '--task', id]).code, 1);
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).round], ['classify', 0], 'task start changed nothing');
  rmSync(brokenDir, { recursive: true });
  ok(fx.root, ['task', 'start', '--task', id]);

  // The Agent call was lost: no report and no recorded agent; the fix names the way out.
  const missing = run(fx.root, ['report', 'show', '--task', id]);
  assert.match(missing.stderr, new RegExp(`If no implementer runs \\(its Agent call was lost or denied\\), start one: cw task start --task ${id} --new-agent\\.`));
  assert.match(run(fx.root, ['task', 'start', '--task', id]).stderr, /needs phase classify or confirm/);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-lost']);
  const fresh = ok(fx.root, ['task', 'start', '--task', id, '--new-agent']);
  assert.deepEqual([fresh.round, fresh.agentCall.subagent_type, fresh.freshAgent], [1, 'dev-workflow:implementer-s', 'it replaces impl-lost']);
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).round, taskJson(fx, id).agents.implementer], ['implement', 1, null]);

  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  assert.match(run(fx.root, ['task', 'start', '--task', id, '--new-agent']).stderr, /is done; a fresh implementer replaces one that left no report or a blocked one/);
  write(fx.root, broken);
  assert.equal(run(fx.root, ['task', 'review', '--task', id]).code, 1);
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).reviewRound], ['implement', 0], 'task review changed nothing');
  rmSync(brokenDir, { recursive: true });
  ok(fx.root, ['task', 'review', '--task', id]);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: app('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);

  write(fx.root, broken);
  assert.equal(run(fx.root, ['task', 'return', '--task', id]).code, 1);
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).round], ['review', 1], 'task return changed nothing');
  rmSync(brokenDir, { recursive: true });
  assert.equal(ok(fx.root, ['task', 'return', '--task', id]).sendMessage.to, 'impl-1');
});

test('in place: task start --new-agent refuses changes in app/ that the fresh implementer would not know', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['ws', 'setup', '--task', id]);
  // The lost implementer left an untracked file on the task branch.
  write(fx.app, { 'src/half.mjs': 'export const half = (a) => a / 2;\n' });
  const before = taskJson(fx, id);
  const refused = run(fx.root, ['task', 'start', '--task', id, '--new-agent']);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, new RegExp(`has uncommitted changes \\(src/half\\.mjs\\); the next implementer would not know them\\.\\nFix: Ask the user to commit them on ${branch} or discard them, then run the command again\\.`));
  assert.equal(taskJson(fx, id).rev, before.rev, 'nothing changed');
  rmSync(join(fx.app, 'src', 'half.mjs'));
  assert.equal(ok(fx.root, ['task', 'start', '--task', id, '--new-agent']).round, 1);
});

test('in place: before any ws setup, task start --new-agent asks to stash changes on the base, not to commit them', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  write(fx.app, { 'notes.md': 'mine\n' });
  const refused = run(fx.root, ['task', 'start', '--task', id, '--new-agent']);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, new RegExp(`Fix: Ask the user to stash or discard them \\(.*app is on main, not on ${branch}\\), then run the command again\\.`));
});

test('in place: after a rebind in implement, the implementer of the earlier session gets a fresh Agent call', (t) => {
  const fx = inPlace(t);
  const { ok } = harness(fx);
  const { id } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-old']);
  assert.equal(taskJson(fx, id).agents.implementer.session, 'test-session');

  const later = asSession(fx, 'session-2');
  const rebound = later.ok(fx.root, ['task', 'new', '--rebind', id]);
  assert.deepEqual(rebound.staleAgents, [{ role: 'implementer', id: 'impl-old', session: 'test-session' }]);
  assert.match(rebound.next, new RegExp(`cw task start --task ${id} --new-agent`));
  const missing = later.run(fx.root, ['report', 'show', '--task', id]);
  assert.match(missing.stderr, new RegExp(`Fix: Start a fresh implementer: cw task start --task ${id} --new-agent \\(impl-old was recorded in session test-session, and the task now belongs to session session-2\\)`));
  assert.ok(!missing.stderr.includes('SendMessage'));

  const fresh = later.ok(fx.root, ['task', 'start', '--task', id, '--new-agent']);
  assert.equal(fresh.agentCall.subagent_type, 'dev-workflow:implementer-s');
  later.ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-new']);
  later.ok(fx.root, ['ws', 'setup', '--task', id]);
  later.ok(fx.root, ['report', 'save', '--task', id], JSON.stringify(BLOCKED));
  assert.match(later.ok(fx.root, ['report', 'show', '--task', id]).next[0], /via SendMessage to impl-new \(the same implementer\)/);
});

test('worktree: after a rebind in review, the agents of the earlier session get fresh Agent calls', (t) => {
  const fx = worktreeFixture(t);
  const { ok } = harness(fx);
  const main = gitIn(fx.root, fx.env);
  const { id, branch } = specified(fx, { complexity: 'm' });
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-old']);
  const one = addAgentWorktree(fx.root, fx.env, 'one');
  implement(fx, id, { cwd: one, tree: one });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'reviewer', '--id', 'rev-old']);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: main('rev-parse', branch) });

  const later = asSession(fx, 'session-2');
  assert.deepEqual(later.ok(fx.root, ['task', 'new', '--rebind', id]).staleAgents.map((agent) => agent.id), ['impl-old', 'rev-old']);
  assert.deepEqual(later.ok(fx.root, ['review', 'show', '--task', id]).next, [`cw task return --task ${id} --new-agent`]);
  const back = later.ok(fx.root, ['task', 'return', '--task', id]);
  assert.equal(back.sendMessage, undefined, 'no SendMessage to an agent of the earlier session');
  assert.equal(back.agentCall.isolation, 'worktree');
  assert.match(back.freshAgent, /^impl-old was recorded in session test-session/);
  assert.equal(existsSync(one), false, 'the old worktree is released');
  assert.ok(readFileSync(back.brief, 'utf8').includes('## Review findings to fix'));

  const two = addAgentWorktree(fx.root, fx.env, 'two');
  later.ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-new']);
  implement(fx, id, { cwd: two, tree: two, files: STRICT_MUL, summary: 'Reject non-numbers in mul', prove: false });
  later.ok(fx.root, ['report', 'show', '--task', id]);
  const review = later.ok(fx.root, ['task', 'review', '--task', id]);
  assert.equal(review.sendMessage, undefined);
  assert.match(review.freshAgent, /^rev-old was recorded in session test-session/);
});

test('worktree: reset spares the live implementer worktree; task start --new-agent releases it; reset --keep continues the branch', (t) => {
  const fx = worktreeFixture(t);
  const { run, ok } = harness(fx);
  const main = gitIn(fx.root, fx.env);
  const { id, branch } = specified(fx, { complexity: 'm' });
  ok(fx.root, ['task', 'start', '--task', id]);
  const one = addAgentWorktree(fx.root, fx.env, 'one');
  ok(one, ['ws', 'setup', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  ok(one, ['report', 'save', '--task', id], JSON.stringify(BLOCKED));

  const live = run(fx.root, ['task', 'reset', '--task', id]);
  assert.equal(live.code, 3);
  assert.match(live.stderr, new RegExp(`is the worktree of this round's implementer; removing it would pull its cwd away\\.\\nFix: .*cw task start --task ${id} --new-agent`));
  assert.ok(existsSync(one));

  const recorded = taskJson(fx, id).workTree;
  const fresh = ok(fx.root, ['task', 'start', '--task', id, '--new-agent']);
  assert.deepEqual([fresh.round, fresh.agentCall.isolation, fresh.releasedWorktree], [1, 'worktree', recorded]);
  assert.equal(existsSync(one), false);
  assert.equal(main('branch', '--list', 'worktree-agent-one'), '');
  assert.deepEqual([taskJson(fx, id).workTree, taskJson(fx, id).resumeBranch], [null, true]);
  const two = addAgentWorktree(fx.root, fx.env, 'two');
  assert.equal(ok(two, ['ws', 'setup', '--task', id]).created, false);
  assert.equal(gitIn(two, fx.env)('branch', '--show-current'), branch);

  // Misclassified after a commit: reset refuses a dirty worktree and commits, and changes nothing.
  ok(two, ['report', 'save', '--task', id], JSON.stringify(misclassified('l')));
  ok(fx.root, ['classify', '--task', id]);
  ok(fx.root, ['classify', '--task', id, '--set', 'l', '--why', 'Bigger.']);
  writeFileSync(join(two, 'stray.txt'), 'x\n');
  const before = taskJson(fx, id);
  const dirty = run(fx.root, ['task', 'reset', '--task', id]);
  assert.equal(dirty.code, 3);
  assert.match(dirty.stderr, /has uncommitted changes \(stray\.txt\)/);
  gitIn(two, fx.env)('add', '-A');
  gitIn(two, fx.env)('commit', '-q', '-m', '[TASK] Keep a note');
  const committed = run(fx.root, ['task', 'reset', '--task', id]);
  assert.equal(committed.code, 3);
  assert.match(committed.stderr, /has 1 commit\(s\) since/);
  assert.ok(existsSync(two));
  assert.notEqual(main('branch', '--list', branch), '');
  assert.notEqual(main('branch', '--list', 'worktree-agent-two'), '');
  assert.deepEqual([taskJson(fx, id).rev, taskJson(fx, id).workTree], [before.rev, before.workTree]);

  // The user keeps the work: the clean worktree is released and the next round continues the branch.
  assert.equal(run(fx.root, ['task', 'reset', '--task', id, '--keep']).code, 2, "--keep needs the user's decision");
  const kept = ok(fx.root, ['task', 'reset', '--task', id, '--keep', '--note', 'The user keeps the note commit.']);
  assert.deepEqual([kept.action, kept.resumeBranch], ['kept', true]);
  assert.equal(kept.next, `AskUserQuestion with the spec summary and the classification, then cw task confirm --task ${id} --note "<what the user confirmed>"`);
  assert.equal(existsSync(two), false);
  assert.equal(taskJson(fx, id).resetPending, false);
  assert.equal(taskJson(fx, id).history.at(-1).note, `work kept on ${branch}: The user keeps the note commit.`);
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', id]).action, 'gone', 'a cleanup meanwhile keeps the reason of the kept branch');
  ok(fx.root, ['task', 'confirm', '--task', id, '--note', 'L is fine']);
  assert.equal(ok(fx.root, ['task', 'start', '--task', id]).round, 2);
  assert.equal(taskJson(fx, id).resumeBranch, true, 'task start keeps the kept branch');
  const three = addAgentWorktree(fx.root, fx.env, 'three');
  assert.equal(ok(three, ['ws', 'setup', '--task', id]).created, false);
  assert.equal(gitIn(three, fx.env)('log', '-1', '--format=%s'), '[TASK] Keep a note');
});

test('in place: reset after a misclassification names the confirmation; reset --keep keeps committed work', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['ws', 'setup', '--task', id]);
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify(misclassified('l')));
  ok(fx.root, ['classify', '--task', id]);
  ok(fx.root, ['classify', '--task', id, '--set', 'l', '--why', 'Bigger.']);
  const reset = ok(fx.root, ['task', 'reset', '--task', id]);
  assert.equal(reset.action, 'deleted');
  assert.equal(reset.next, `AskUserQuestion with the spec summary and the classification, then cw task confirm --task ${id} --note "<what the user confirmed>"`);

  ok(fx.root, ['task', 'confirm', '--task', id, '--note', 'L is fine']);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['ws', 'setup', '--task', id]);
  write(fx.app, { 'src/schema.mjs': 'export {};\n' });
  app('add', '-A');
  app('commit', '-q', '-m', '[FEATURE] Start the schema');
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify(misclassified('xl')));
  ok(fx.root, ['classify', '--task', id]);
  ok(fx.root, ['classify', '--task', id, '--set', 'xl', '--why', 'Even bigger.']);
  assert.match(run(fx.root, ['task', 'reset', '--task', id]).stderr, /--keep --note/);
  assert.equal(run(fx.root, ['task', 'reset', '--task', id, '--note', 'x']).code, 2, '--note goes with --keep');
  write(fx.app, { 'scratch.txt': 'wip\n' });
  assert.match(run(fx.root, ['task', 'reset', '--task', id, '--keep', '--note', 'Keep it.']).stderr, /uncommitted changes \(scratch\.txt\); the next implementer would not know them/);
  rmSync(join(fx.app, 'scratch.txt'));
  assert.deepEqual(ok(fx.root, ['task', 'reset', '--task', id, '--keep', '--note', 'Keep it.']).action, 'kept');
  ok(fx.root, ['task', 'confirm', '--task', id, '--note', 'XL is fine']);
  ok(fx.root, ['task', 'start', '--task', id]);
  assert.equal(ok(fx.root, ['ws', 'setup', '--task', id]).created, false);
  assert.equal(app('log', '-1', '--format=%s', branch), '[FEATURE] Start the schema');
});

test('a commit after the approval gets a new review round, in review and in deliver; then a spec change after the approval', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const ws = loadWorkspace({ cwd: fx.root });
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'reviewer', '--id', 'rev-1']);
  const busy = run(fx.root, ['spec', 'save', '--task', id], spec(branch));
  assert.equal(busy.code, 3);
  assert.match(busy.stderr, new RegExp(`Fix: Wait for the review \\(cw review show --task ${id}\\); the spec can change once it is approved`));
  const approvedHead = app('rev-parse', branch);
  writeReview(fx, id, 1, 'approved', { head: approvedHead });
  ok(fx.root, ['review', 'show', '--task', id]);

  // The user's quick fix lands after the approval, before delivery.
  write(fx.app, { 'src/mul.mjs': 'export const mul = (a, b) => b * a;\n' });
  app('commit', '-q', '-am', '[TASK] Swap the factors');
  const moved = run(fx.root, ['pr', 'body', '--task', id]);
  assert.equal(moved.code, 3);
  assert.match(moved.stderr, new RegExp(`Fix: Have the new commits reviewed: cw task review --task ${id} \\(a new review round over the commits since ${approvedHead.slice(0, 10)}\\)\\.`));
  const recheck = ok(fx.root, ['task', 'review', '--task', id]);
  const recheckBrief = readFileSync(recheck.brief, 'utf8');
  assert.deepEqual([recheck.reviewRound, recheck.sendMessage.to], [2, 'rev-1']);
  assert.match(recheck.sendMessage.message, new RegExp(`${branch} moved after your approval of ${approvedHead}`));
  assert.ok(recheckBrief.includes(`- The branch moved after the approval of ${approvedHead}: review the commits since then.`));
  assert.ok(recheckBrief.includes(`- Your previous review: ${taskPath(ws, id, 'review-1-r1.json')}`));
  assert.equal(existsSync(taskPath(ws, id, 'review-1.json')), false);
  assert.equal(readJson(taskPath(ws, id, 'review-1-r1.json')).status, 'approved', 'the approval is kept under another name');
  assert.equal(run(fx.root, ['review', 'show', '--task', id]).code, 3, 'the new review round has no review yet');
  // The orchestrator lost that output, or the reviewer is gone: a rerun prints the same recheck and brief.
  const rerun = ok(fx.root, ['task', 'review', '--task', id]);
  assert.deepEqual([rerun.reviewRound, rerun.sendMessage], [2, recheck.sendMessage]);
  assert.equal(readFileSync(rerun.brief, 'utf8'), recheckBrief);
  assert.ok(ok(fx.root, ['task', 'review', '--task', id, '--new-agent']).agentCall);
  assert.equal(readFileSync(rerun.brief, 'utf8'), recheckBrief);
  writeReview(fx, id, 1, 'approved', { head: app('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  const body = ok(fx.root, ['pr', 'body', '--task', id]);
  assert.equal(taskJson(fx, id).phase, 'deliver');

  // Again in deliver: back to review, and the PR/MR body of the earlier state is gone.
  app('commit', '-q', '--allow-empty', '-m', '[TASK] Touch nothing');
  assert.match(run(fx.root, ['pr', 'command', '--task', id]).stderr, /Fix: Have the new commits reviewed: cw task review/);
  const again = ok(fx.root, ['task', 'review', '--task', id]);
  assert.deepEqual([again.reviewRound, taskJson(fx, id).phase], [3, 'review']);
  assert.equal(existsSync(body.file), false);

  // After the approval the spec can change; the cycle restarts from review.
  writeReview(fx, id, 1, 'approved', { head: app('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  const changed = ok(fx.root, ['spec', 'save', '--task', id], spec(branch, R2));
  assert.equal(changed.next, `cw task return --task ${id} --spec-changed --note "<what changed>"`);
  assert.match(run(fx.root, ['pr', 'body', '--task', id]).stderr, /changed after the review/);
  const restarted = ok(fx.root, ['task', 'return', '--task', id, '--spec-changed', '--note', 'R2 adds div.']);
  assert.deepEqual([restarted.round, taskJson(fx, id).phase, taskJson(fx, id).specChanged, taskJson(fx, id).reviewRound], [2, 'implement', false, 0]);
});

test('a blocked report: the answer may change the spec and rewrites the brief; the same round then reports done', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  ok(fx.root, ['ws', 'setup', '--task', id]);
  const busy = run(fx.root, ['spec', 'save', '--task', id], spec(branch));
  assert.equal(busy.code, 3, 'no spec change while the implementer works');
  assert.match(busy.stderr, /the spec can change while the report is blocked/);

  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify(BLOCKED));
  assert.deepEqual(ok(fx.root, ['report', 'show', '--task', id]).next, [`answer from the spec and the code via SendMessage to impl-1 (the same implementer), else ask the user; a spec change: cw spec save --task ${id}`]);
  const answered = ok(fx.root, ['spec', 'save', '--task', id], spec(branch, '- R1 Export mul(a, b) from src/mul.mjs; integers only.'));
  const brief = taskPath(loadWorkspace({ cwd: fx.root }), id, 'brief-implementer.md');
  assert.equal(answered.next, `cw spec lint --task ${id}, then SendMessage impl-1 (the same implementer) the answer and that the spec and its brief ${brief} changed`);
  assert.ok(readFileSync(brief, 'utf8').includes('integers only'));
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).round], ['implement', 1]);

  implement(fx, id, { cwd: fx.root, tree: fx.app });
  assert.equal(ok(fx.root, ['report', 'show', '--task', id]).status, 'done');
  assert.deepEqual([ok(fx.root, ['task', 'review', '--task', id]).round, taskJson(fx, id).phase], [1, 'review']);
});

test('worktree: a removed implementer worktree hands the branch to a new agent, also after task cleanup in deliver', (t) => {
  const fx = worktreeFixture(t);
  const { ok } = harness(fx);
  const main = gitIn(fx.root, fx.env);
  const { id, branch } = specified(fx, { complexity: 'm' });
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  const one = addAgentWorktree(fx.root, fx.env, 'one');
  implement(fx, id, { cwd: one, tree: one });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: main('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);

  // Deleted without git worktree remove: git holds the task branch for it until a prune.
  rmSync(one, { recursive: true, force: true });
  const back = ok(fx.root, ['task', 'return', '--task', id]);
  assert.equal(back.sendMessage, undefined, "no SendMessage to an implementer whose cwd is gone");
  assert.match(back.freshAgent, /is gone/);
  assert.equal(taskJson(fx, id).resumeBranch, true);
  const two = addAgentWorktree(fx.root, fx.env, 'two');
  assert.equal(ok(two, ['ws', 'setup', '--task', id]).created, false);

  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-2']);
  implement(fx, id, { cwd: two, tree: two, files: STRICT_MUL, summary: 'Reject non-numbers in mul', prove: false });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  writeReview(fx, id, 2, 'approved', { head: main('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  ok(fx.root, ['pr', 'title', '--task', id]);

  // task cleanup in deliver removes the worktree; the task can still go back to implement.
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', id]).action, 'removed');
  assert.deepEqual([taskJson(fx, id).workTree, taskJson(fx, id).resumeBranch], [null, true]);
  ok(fx.root, ['spec', 'save', '--task', id], spec(branch, R2));
  const restarted = ok(fx.root, ['task', 'return', '--task', id, '--spec-changed', '--note', 'R2 adds div.']);
  assert.ok(restarted.agentCall);
  const three = addAgentWorktree(fx.root, fx.env, 'three');
  assert.equal(ok(three, ['ws', 'setup', '--task', id]).created, false);
  assert.equal(gitIn(three, fx.env)('log', '-1', '--format=%s'), '[FEATURE] Reject non-numbers in mul');
});

test('in place: after task cleanup in deliver, a spec change sends the implementer back to the task branch first', (t) => {
  const fx = inPlace(t);
  const { ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  writeReview(fx, id, 1, 'approved', { head: app('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  ok(fx.root, ['pr', 'title', '--task', id]);
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', id]).action, 'switched');

  ok(fx.root, ['spec', 'save', '--task', id], spec(branch, R2));
  const restarted = ok(fx.root, ['task', 'return', '--task', id, '--spec-changed', '--note', 'R2 adds div.']);
  assert.match(restarted.sendMessage.message, new RegExp(`First run cw ws setup --task ${id}: the work tree is no longer on ${branch}\\.`));
  assert.equal(taskJson(fx, id).resumeBranch, true);
  assert.equal(ok(fx.root, ['ws', 'setup', '--task', id]).created, false);
  assert.equal(app('branch', '--show-current'), branch);
  assert.equal(taskJson(fx, id).resumeBranch, false);
});

test('task reset before task start keeps a same-named branch cw did not create', (t) => {
  const fixtures = [
    { fx: inPlace(t), repo: (fx) => fx.app },
    { fx: worktreeFixture(t), repo: (fx) => fx.root },
  ];
  for (const { fx, repo } of fixtures) {
    const { run } = harness(fx);
    const git = gitIn(repo(fx), fx.env);
    git('switch', '-q', '-c', 'NO-TICKET/feature/mul-helper');
    write(repo(fx), { 'mine.txt': 'my own start\n' });
    git('add', '-A');
    git('commit', '-q', '-m', 'My own start');
    const mine = git('rev-parse', 'HEAD');
    git('switch', '-q', 'main');

    const created = run(fx.root, ['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'mul-helper', '--title', 'Add the mul helper', '--type', 'feature']);
    assert.equal(created.code, 0, created.stderr);
    assert.match(created.stderr, /NO-TICKET\/feature\/mul-helper exists already in .*; cw did not create it/);
    const refused = run(fx.root, ['task', 'reset', '--task', 'NO-TICKET__feature__mul-helper']);
    assert.equal(refused.code, 3);
    assert.match(refused.stderr, /but NO-TICKET__feature__mul-helper never started, so cw did not create it\.\nFix: Ask the user whose branch it is/);
    assert.equal(git('rev-parse', 'NO-TICKET/feature/mul-helper'), mine);
  }
});

// The user's own branch with the task's name and a commit on it, made in the main checkout.
function userBranch(fx, name) {
  const git = gitIn(fx.root, fx.env);
  git('switch', '-q', '-c', name);
  write(fx.root, { 'mine.txt': 'my own start\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'My own start');
  git('switch', '-q', 'main');
}

test('worktree: task cleanup before task start does not make the next agent continue a branch cw did not create', (t) => {
  const fx = worktreeFixture(t);
  const { run, ok } = harness(fx);
  userBranch(fx, 'NO-TICKET/feature/mul-helper');
  const { id, branch } = specified(fx, { complexity: 'm' });
  const cleanup = ok(fx.root, ['task', 'cleanup', '--task', id]);
  assert.deepEqual([cleanup.action, cleanup.branchKept], ['gone', branch]);
  assert.equal(taskJson(fx, id).resumeBranch, false);

  ok(fx.root, ['task', 'start', '--task', id]);
  const one = addAgentWorktree(fx.root, fx.env, 'one');
  const setup = run(one, ['ws', 'setup', '--task', id]);
  assert.equal(setup.code, 3);
  assert.match(setup.stderr, new RegExp(`The task branch ${branch} exists already`));
  assert.equal(gitIn(one, fx.env)('branch', '--show-current'), 'worktree-agent-one');
});

test('worktree: task start drops a resume that only task cleanup recorded', (t) => {
  const fx = worktreeFixture(t);
  const { run, ok } = harness(fx);
  const { id, branch } = specified(fx, { complexity: 'm' });
  ok(fx.root, ['task', 'start', '--task', id]);
  const one = addAgentWorktree(fx.root, fx.env, 'one');
  ok(one, ['ws', 'setup', '--task', id]);
  ok(one, ['report', 'save', '--task', id], JSON.stringify(misclassified('l')));
  ok(fx.root, ['classify', '--task', id]);
  ok(fx.root, ['classify', '--task', id, '--set', 'l', '--why', 'Bigger.']);
  assert.equal(ok(fx.root, ['task', 'reset', '--task', id]).action, 'removed');

  // Meanwhile the user starts a branch of the same name; task cleanup of the started task sees it.
  userBranch(fx, branch);
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', id]).action, 'gone');
  assert.equal(taskJson(fx, id).resumeBranch, true);
  ok(fx.root, ['task', 'confirm', '--task', id, '--note', 'L is fine']);
  ok(fx.root, ['task', 'start', '--task', id]);
  assert.equal(taskJson(fx, id).resumeBranch, false);
  const two = addAgentWorktree(fx.root, fx.env, 'two');
  assert.match(run(two, ['ws', 'setup', '--task', id]).stderr, new RegExp(`The task branch ${branch} exists already`));
});

test('classify --override takes the reason the user approved', (t) => {
  const fx = inPlace(t, { complexity: { escalate: [{ paths: ['src/**'], min: 'm', reason: 'core code' }] } });
  const { run, ok } = harness(fx);
  const { id } = specified(fx, { complexity: 'm' });
  const below = run(fx.root, ['classify', '--task', id, '--set', 's', '--why', 'Only a comment.']);
  assert.equal(below.code, 3);
  assert.match(below.stderr, /Fix: Pick m or higher, or ask the user and pass --override "<the reason the user approved>"\./);
  ok(fx.root, ['classify', '--task', id, '--set', 's', '--why', 'Only a comment.', '--override', 'The user approved: it only touches a comment.']);
  assert.deepEqual(taskJson(fx, id).complexityOverride, { min: 'm', chosen: 's', why: 'Only a comment.', reason: 'The user approved: it only touches a comment.' });
  assert.equal(run(fx.root, ['classify', '--task', id, '--set', 's', '--why', 'x', '--override']).code, 2, '--override needs the reason');
});

test('worktree mode in a clone with a separate git dir: the main checkout is the clone, not the git dir', (t) => {
  const fx = worktreeFixture(t);
  const root = join(fx.base, 'separate');
  execFileSync('git', ['clone', '-q', `--separate-git-dir=${join(fx.base, 'separate.git')}`, fx.root, root], { env: fx.env });
  const clone = { ...fx, root };
  const { ok } = harness(clone);
  const { id } = specified(clone, { complexity: 'm' });
  const started = ok(root, ['task', 'start', '--task', id]);
  assert.equal(started.base.commit, gitIn(root, fx.env)('rev-parse', 'main'));
  const agent = addAgentWorktree(root, fx.env, 'one');
  ok(agent, ['ws', 'setup', '--task', id]);
  ok(agent, ['report', 'save', '--task', id], JSON.stringify(misclassified('l')));
  ok(root, ['classify', '--task', id]);
  ok(root, ['classify', '--task', id, '--set', 'm', '--why', 'Still m.']);
  assert.equal(ok(root, ['task', 'reset', '--task', id]).action, 'removed');
  assert.equal(existsSync(agent), false);
});

test('worktree mode in a submodule: the main checkout comes from core.worktree, also from a linked worktree outside it', (t) => {
  const sub = worktreeFixture(t);
  const superRoot = join(sub.base, 'super');
  execFileSync('git', ['init', '-q', '-b', 'main', superRoot], { env: sub.env });
  const superGit = gitIn(superRoot, sub.env);
  superGit('commit', '-q', '--allow-empty', '-m', 'super init');
  superGit('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', '-b', 'main', sub.remote, 'app');
  superGit('commit', '-q', '-m', 'Add app');
  const appGit = gitIn(join(superRoot, 'app'), sub.env);
  // The orchestrator runs in a linked worktree of the submodule outside its checkout, so no directory
  // above the cwd is the main checkout: only core.worktree names it (git 2.54: ../../../app).
  const side = join(sub.base, 'app-side');
  appGit('worktree', 'add', '-q', '-b', 'side', side);
  const fx = { ...sub, root: side };
  const { ok } = harness(fx);
  const { id } = specified(fx, { complexity: 'm' });
  const started = ok(side, ['task', 'start', '--task', id]);
  assert.equal(started.base.commit, appGit('rev-parse', 'main'));
  assert.notEqual(started.base.commit, superGit('rev-parse', 'main'));
  const agent = addAgentWorktree(side, sub.env, 'one');
  ok(agent, ['ws', 'setup', '--task', id]);
  ok(agent, ['report', 'save', '--task', id], JSON.stringify(misclassified('l')));
  ok(side, ['classify', '--task', id]);
  ok(side, ['classify', '--task', id, '--set', 'm', '--why', 'Still m.']);
  assert.equal(ok(side, ['task', 'reset', '--task', id]).action, 'removed');
  assert.equal(existsSync(agent), false);
});

test('worktree: a commit after the approval starts no re-review once the implementer worktree is gone', (t) => {
  const fx = worktreeFixture(t);
  const { run, ok } = harness(fx);
  const main = gitIn(fx.root, fx.env);
  const ws = loadWorkspace({ cwd: fx.root });
  const { id, branch } = specified(fx, { complexity: 'm' });
  ok(fx.root, ['task', 'start', '--task', id]);
  const one = addAgentWorktree(fx.root, fx.env, 'one');
  implement(fx, id, { cwd: one, tree: one });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  writeReview(fx, id, 1, 'approved', { head: main('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  ok(fx.root, ['pr', 'body', '--task', id]);
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', id]).action, 'removed');
  // A late commit on the branch, which no worktree holds any more.
  const late = main('commit-tree', main('rev-parse', `${branch}^{tree}`), '-p', branch, '-m', '[TASK] Late change');
  main('update-ref', `refs/heads/${branch}`, late);
  const before = taskJson(fx, id);
  const refused = run(fx.root, ['task', 'review', '--task', id]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /the implementer worktree is gone, so no reviewer can check the new commits/);
  assert.match(refused.stderr, new RegExp(`branch -f ${branch} [0-9a-f]{40}\\) and continue with cw pr command`));
  const after = taskJson(fx, id);
  assert.deepEqual([after.rev, after.phase, after.reviewRound], [before.rev, 'deliver', before.reviewRound], 'nothing changed');
  assert.equal(existsSync(taskPath(ws, id, 'review-1.json')), true, 'the approval was not archived');
});

test('in place: a task branch that existed before task start is the user\'s: ws setup asks, task reset keeps it', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  app('branch', 'NO-TICKET/feature/mul-helper');
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  assert.equal(taskJson(fx, id).branchPreexisted, true);
  const setup = run(fx.root, ['ws', 'setup', '--task', id]);
  assert.equal(setup.code, 3);
  assert.match(setup.stderr, /existed before cw task start, so cw did not create it\.\nFix: Report blocked; the orchestrator asks the user whose branch it is/);
  const reset = run(fx.root, ['task', 'reset', '--task', id]);
  assert.equal(reset.code, 3);
  assert.match(reset.stderr, new RegExp(`${branch} existed in .* before cw task start, so cw did not create it\\.`));
  assert.notEqual(app('branch', '--list', branch), '', 'the user\'s branch is still there');
});

test('after a rebind, git foreign-commits sends no SendMessage to the implementer of the earlier session', (t) => {
  const fx = inPlace(t);
  const { ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-old']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  asSession(fx, 'session-2').ok(fx.root, ['task', 'new', '--rebind', id]);
  app('switch', '-q', 'main');
  const result = cw(fx.root, ['git', 'foreign-commits', '--task', id, '--json'], { env: { ...fx.env, CLAUDE_CODE_SESSION_ID: 'session-2' } });
  assert.equal(result.code, 1);
  assert.match(result.json().fix, new RegExp(`^the implementer belongs to an earlier session \\(no SendMessage\\): continue with cw task review --task ${id}; .* cw task return --task ${id} --new-agent gives a fresh implementer the switch back to the task branch: git -C `));
});
