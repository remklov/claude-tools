// The orchestrator's delegation cycle as processes (§6 O4–O8): classify, task start, report show,
// task review, review show, task return, task reset and playbook show, in both workspace modes. The
// implementer's side runs the real implementer commands; the reviewer's result is written as the
// review file cw review save leaves.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { readJson } from '../../cli/lib/fsx.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, cw, gitIn, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';
import { BLOCKED, NO_HANDOVER, PACKAGES, blocking, harness, implement, inPlace, spec, specified, taskJson, writeReview } from './cycle-fixture.mjs';

test('in place: classify, start, report, review, return, a follow-up review and approval', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id, branch, classified } = specified(fx);
  assert.deepEqual([classified.packages, classified.areas, classified.minComplexity, classified.paths], [['app'], ['backend'], 's', ['src/sum.mjs']]);

  const started = ok(join(fx.app, 'src'), ['task', 'start', '--task', id]);
  assert.deepEqual(Object.keys(started.agentCall), ['subagent_type', 'description', 'prompt', 'run_in_background']);
  assert.equal(started.agentCall.subagent_type, 'dev-workflow:implementer-s');
  assert.equal(started.agentCall.run_in_background, false);
  assert.equal(started.base.commit, app('rev-parse', 'HEAD'));
  const brief = readFileSync(started.brief, 'utf8');
  for (const part of ['## Spec', '## Ticket (snapshot', 'CORE-SCOPE', '## Guardrails for complexity S']) assert.ok(brief.includes(part), part);
  assert.equal(run(fx.root, ['report', 'show', '--task', id]).code, 3, 'no report yet');
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);

  implement(fx, id, { cwd: fx.root, tree: fx.app });
  const shown = ok(fx.root, ['report', 'show', '--task', id]);
  assert.equal(shown.status, 'done');
  assert.deepEqual(shown.next, [`cw git foreign-commits --task ${id}`, `cw task review --task ${id}`]);
  assert.ok(taskJson(fx, id).agents.implementer.shownAt);

  const review = ok(fx.root, ['task', 'review', '--task', id]);
  assert.equal(review.agentCall.subagent_type, 'dev-workflow:reviewer');
  assert.equal('isolation' in review.agentCall, false);
  assert.ok(readFileSync(review.brief, 'utf8').includes(`- Implementer report: ${taskPath(loadWorkspace({ cwd: fx.root }), id, 'report-1.json')}`));
  assert.equal(ok(fx.root, ['task', 'review', '--task', id]).reviewRound, 1, 'a repeat only prints the delegation again');
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'reviewer', '--id', 'rev-1']);
  const head1 = app('rev-parse', branch);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: head1 });
  assert.deepEqual(ok(fx.root, ['review', 'show', '--task', id]).next, [`cw task return --task ${id}`]);
  assert.equal(run(fx.root, ['task', 'review', '--task', id]).code, 3, 'the review of this round is saved');

  const back = ok(fx.root, ['task', 'return', '--task', id]);
  assert.equal(back.sendMessage.to, 'impl-1');
  assert.match(back.sendMessage.message, /^Review round 1 requests changes/);
  assert.ok(back.sendMessage.message.includes('- [blocking · CORE-ERRORS] src/mul.mjs:1: No input check — Reject non-numbers'));
  assert.ok(readFileSync(back.brief, 'utf8').includes('## Review findings to fix'));
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).round], ['implement', 2]);

  implement(fx, id, { cwd: fx.app, tree: fx.app, files: { 'src/mul.mjs': "export const mul = (a, b) => {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('mul takes numbers');\n  return a * b;\n};\n" }, summary: 'Reject non-numbers in mul', prove: false });
  ok(fx.root, ['report', 'show', '--task', id]);
  const followUp = ok(fx.root, ['task', 'review', '--task', id]);
  assert.equal(followUp.sendMessage.to, 'rev-1');
  assert.ok(followUp.sendMessage.message.includes(`Review the changes since ${head1}`));
  assert.ok(ok(fx.root, ['task', 'review', '--task', id, '--new-agent']).agentCall, '--new-agent starts a fresh reviewer');
  writeReview(fx, id, 2, 'approved', { head: app('rev-parse', branch) });
  assert.deepEqual(ok(fx.root, ['review', 'show', '--task', id]).next, [`cw pr body --task ${id}`, `cw pr command --task ${id}`]);
  assert.equal(ok(fx.root, ['pr', 'title', '--task', id]).title, '[FEATURE] Add the mul helper');
  assert.equal(taskJson(fx, id).phase, 'deliver');
});

test('in place: a misclassified report classifies again; task reset refuses commits and deletes an empty branch', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['ws', 'setup', '--task', id]);
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify({ status: 'misclassified', acceptanceCriteria: [], misclassified: { reason: 'It needs a schema change.', suggested: 'l' }, handover: NO_HANDOVER }));
  assert.match(ok(fx.root, ['report', 'show', '--task', id]).next[0], /^cw classify --task .* \(it was s, the implementer suggests l\)/);
  assert.equal(run(fx.root, ['task', 'start', '--task', id]).code, 3);

  const again = ok(fx.root, ['classify', '--task', id]);
  assert.deepEqual([again.previousComplexity, again.suggested], ['s', 'l']);
  assert.deepEqual(ok(fx.root, ['classify', '--task', id, '--set', 'l', '--why', 'A schema change.']).next[0], `cw task reset --task ${id}`);
  assert.match(run(fx.root, ['task', 'start', '--task', id]).stderr, /needs the user's confirmation/);
  ok(fx.root, ['task', 'confirm', '--task', id, '--note', 'L is fine']);
  assert.match(run(fx.root, ['task', 'start', '--task', id]).stderr, /cw task reset --task/);

  write(fx.app, { 'src/schema.mjs': 'export {};\n' });
  app('add', '-A');
  app('commit', '-q', '-m', '[FEATURE] Start the schema');
  const refused = run(fx.root, ['task', 'reset', '--task', id]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /has 1 commit\(s\)/);
  assert.match(refused.stderr, new RegExp(`Fix: Ask the user: keep the work and continue on ${branch} \\(cw task reset --task ${id} --keep --note "<the user's decision>"\\), or discard it`));
  assert.ok(!refused.stderr.includes('commit or stash'), 'committing cannot make the reset pass');
  app('reset', '-q', '--hard', 'main');
  assert.equal(ok(fx.root, ['task', 'reset', '--task', id]).action, 'deleted');
  assert.equal(app('branch', '--show-current'), 'main');
  assert.equal(app('branch', '--list', branch), '');
  assert.equal(ok(fx.root, ['task', 'reset', '--task', id]).action, 'nothing');
  const restarted = ok(fx.root, ['task', 'start', '--task', id]);
  assert.deepEqual([restarted.round, restarted.agentCall.subagent_type], [2, 'dev-workflow:implementer-l']);
});

test('worktree: isolation for the implementer; a new agent takes the branch over; reset removes a clean worktree', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig({ packages: PACKAGES }) });
  const { run, ok } = harness(fx);
  const main = gitIn(fx.root, fx.env);
  const { id, branch } = specified(fx, { complexity: 'm' });
  const started = ok(fx.root, ['task', 'start', '--task', id]);
  assert.deepEqual([started.agentCall.subagent_type, started.agentCall.isolation], ['dev-workflow:implementer-m', 'worktree']);

  const one = addAgentWorktree(fx.root, fx.env, 'one');
  implement(fx, id, { cwd: one, tree: one });
  ok(fx.root, ['report', 'show', '--task', id]);
  assert.equal('isolation' in ok(fx.root, ['task', 'review', '--task', id]).agentCall, false);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: main('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);

  assert.match(run(fx.root, ['task', 'return', '--task', id]).stderr, /--new-agent/, 'no implementer id was recorded');
  writeFileSync(join(one, 'stray.txt'), 'x\n');
  assert.match(run(fx.root, ['task', 'return', '--task', id, '--new-agent']).stderr, /uncommitted changes \(stray\.txt\); a new agent would not get them/);
  gitIn(one, fx.env)('clean', '-fq');
  const recorded = taskJson(fx, id).workTree;
  const handover = ok(fx.root, ['task', 'return', '--task', id, '--new-agent']);
  assert.equal(handover.agentCall.isolation, 'worktree');
  assert.equal(handover.releasedWorktree, recorded);
  assert.equal(existsSync(one), false);
  assert.equal(main('branch', '--list', 'worktree-agent-one'), '');
  assert.notEqual(main('branch', '--list', branch), '');

  const two = addAgentWorktree(fx.root, fx.env, 'two');
  const setup = ok(two, ['ws', 'setup', '--task', id]);
  assert.deepEqual([setup.created, setup.agentBranch], [false, 'worktree-agent-two']);
  assert.equal(gitIn(two, fx.env)('branch', '--show-current'), branch);
  assert.equal(taskJson(fx, id).resumeBranch, false);

  const second = specified(fx, { slug: 'second-task' });
  ok(fx.root, ['task', 'start', '--task', second.id]);
  const three = addAgentWorktree(fx.root, fx.env, 'three');
  ok(three, ['ws', 'setup', '--task', second.id]);
  ok(three, ['report', 'save', '--task', second.id], JSON.stringify({ status: 'misclassified', acceptanceCriteria: [], misclassified: { reason: 'Bigger.', suggested: 'm' }, handover: NO_HANDOVER }));
  ok(fx.root, ['classify', '--task', second.id]);
  ok(fx.root, ['classify', '--task', second.id, '--set', 'm', '--why', 'Bigger.']);
  const reset = ok(fx.root, ['task', 'reset', '--task', second.id]);
  assert.deepEqual([reset.action, reset.removed.sort()], ['removed', [second.branch, 'worktree-agent-three'].sort()]);
  assert.equal(existsSync(three), false);
  assert.equal(taskJson(fx, second.id).workTree, null);
});

test('maximum review rounds escalate; --continue and a spec change after approval restart the cycle', (t) => {
  const fx = inPlace(t, { workflow: { maxReviewRounds: 1 } });
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'reviewer', '--id', 'rev-1']);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: app('rev-parse', branch) });
  const escalated = ok(fx.root, ['review', 'show', '--task', id]);
  assert.equal(escalated.escalated, true);
  assert.match(escalated.next[0], /--continue --note/);
  assert.equal(taskJson(fx, id).phase, 'escalated');
  assert.equal(run(fx.root, ['task', 'return', '--task', id]).code, 3);

  // After the escalation, also after a rebind, review show prints the open findings again, read-only.
  const shownAt = taskJson(fx, id).agents.reviewer.shownAt;
  const again = ok(fx.root, ['review', 'show', '--task', id]);
  assert.deepEqual([again.escalated, again.findings.map((finding) => finding.id), again.next], [true, ['F1'], escalated.next]);
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).agents.reviewer.shownAt], ['escalated', shownAt], 'no transition, no stamp');
  const rebound = cw(fx.root, ['task', 'new', '--rebind', id, '--json'], { env: { ...fx.env, CLAUDE_CODE_SESSION_ID: 'session-2' } }).json();
  assert.match(rebound.next, new RegExp(`^cw review show --task ${id}`));
  cw(fx.root, ['task', 'new', '--rebind', id], { env: fx.env });

  // --continue records the user's decision: history, the SendMessage text and the brief.
  const noNote = run(fx.root, ['task', 'return', '--task', id, '--continue']);
  assert.equal(noNote.code, 2);
  assert.match(noNote.stderr, /--note is required\nFix: Pass the user's decision/);
  const continued = ok(fx.root, ['task', 'return', '--task', id, '--continue', '--note', 'Keep the name mul; fix F1 only.']);
  assert.match(continued.sendMessage.message, /^The user decided after the escalation: Keep the name mul; fix F1 only\.\nReview round 1 requests changes/);
  assert.ok(readFileSync(continued.brief, 'utf8').includes("## The user's decision after the escalation\n\nKeep the name mul; fix F1 only."));
  assert.ok(readFileSync(continued.brief, 'utf8').includes('## Review findings to fix'));
  assert.equal(taskJson(fx, id).history.at(-1).note, 'the user continues after the escalation: Keep the name mul; fix F1 only.');
  assert.deepEqual([continued.round, continued.cycle, taskJson(fx, id).reviewRound], [2, 2, 0]);
  implement(fx, id, { cwd: fx.root, tree: fx.app, files: { 'src/mul.mjs': 'export const mul = (a, b) => Number(a) * Number(b);\n' }, summary: 'Coerce the mul arguments', prove: false });
  ok(fx.root, ['report', 'show', '--task', id]);
  assert.equal(ok(fx.root, ['task', 'review', '--task', id]).sendMessage.to, 'rev-1');
  writeReview(fx, id, 2, 'approved', { head: app('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  const body = ok(fx.root, ['pr', 'body', '--task', id]);
  assert.equal(taskJson(fx, id).phase, 'deliver');
  // The approval note names the review round of this cycle, not the implementer round (2).
  assert.match(taskJson(fx, id).history.findLast((entry) => entry.to === 'deliver').note, /^review round 1 approved at [0-9a-f]+$/);

  const changed = ok(fx.root, ['spec', 'save', '--task', id], spec(branch, '- R1 Export mul(a, b) from src/mul.mjs.\n- R2 Export div(a, b) as well.'));
  assert.match(changed.next, /--spec-changed/);
  assert.match(run(fx.root, ['task', 'end', '--task', id, '--outcome', 'done']).stderr, /spec of .* changed after the review/);
  // No delivery of a state the approval does not cover, also after a rebind.
  const command = run(fx.root, ['pr', 'command', '--task', id]);
  assert.equal(command.code, 3);
  assert.match(command.stderr, new RegExp(`changed after the review; the approval does not cover it\\.\\nFix: Restart the cycle: cw task return --task ${id} --spec-changed --note`));
  assert.match(cw(fx.root, ['task', 'new', '--rebind', id, '--json'], { env: fx.env }).json().next, /^cw task return --task \S+ --spec-changed --note/);
  assert.equal(run(fx.root, ['task', 'return', '--task', id, '--spec-changed']).code, 2, '--note is required');
  const restarted = ok(fx.root, ['task', 'return', '--task', id, '--spec-changed', '--note', 'R2 adds div.']);
  assert.match(restarted.sendMessage.message, /^The spec changed after the review: R2 adds div\./);
  assert.deepEqual([restarted.round, restarted.cycle, taskJson(fx, id).specChanged], [3, 3, false]);
  assert.equal(existsSync(body.file), false, 'the PR/MR body of the earlier cycle is gone');
});

test('report show lists the proofs that are stale at HEAD', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const app = gitIn(fx.app, fx.env);
  const { id } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  // The proven test file is renamed afterwards: its proof no longer counts, and report show says why.
  app('mv', 'src/mul.test.mjs', 'src/multiply.test.mjs');
  app('commit', '-q', '-m', '[TASK] Rename the mul test');
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify(BLOCKED));
  const reason = 'the test file src/mul.test.mjs no longer exists at HEAD';
  assert.deepEqual(ok(fx.root, ['report', 'show', '--task', id]).staleProofs.map((proof) => [proof.test, proof.reason]), [['app:src/mul.test.mjs', reason]]);
  assert.match(run(fx.root, ['report', 'show', '--task', id]).stdout, new RegExp(`^stale proof \\S+ \\(app:src/mul\\.test\\.mjs\\), not counted: ${reason}$`, 'm'));
});

test("the in-process git calls of the cycle tests ignore the developer's global git config", (t) => {
  const fx = inPlace(t);
  write(fx.base, { 'developer.gitconfig': `[core]\n\texcludesFile = ${join(fx.base, 'developer.ignore')}\n`, 'developer.ignore': '*.txt\n' });
  write(fx.app, { 'note.txt': 'not ignored here\n' });
  const url = (path) => JSON.stringify(new URL(path, import.meta.url).href);
  const script = `await import(${url('./cycle-fixture.mjs')});
const { porcelain } = await import(${url('../../cli/lib/git.mjs')});
process.stdout.write(JSON.stringify(porcelain(process.env.APP)));`;
  const env = { ...fx.env, GIT_CONFIG_GLOBAL: join(fx.base, 'developer.gitconfig'), APP: fx.app };
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' })), ['note.txt']);
});

test('playbook show lists the role commands, the procedures for a task and the output contract', (t) => {
  const fx = inPlace(t, { packs: ['typescript'] });
  const { ok } = harness(fx);
  const { id } = specified(fx);
  const implementer = ok(fx.root, ['playbook', 'show', 'implementer']);
  assert.ok(implementer.commands.some((command) => command.usage.startsWith('cw ws setup')));
  assert.deepEqual(implementer.contract, { command: 'cw report save', schema: 'schemas/dev-report.schema.json' });
  assert.deepEqual(implementer.procedures.map((procedure) => procedure.name), ['narrow-unknown']);
  assert.deepEqual(ok(fx.root, ['playbook', 'show', 'reviewer', '--task', id]).procedures, []);
  assert.equal(cw(fx.root, ['playbook', 'show', 'tester'], { env: fx.env }).code, 2);
});
