// The calls the orchestrator saves after the fisko analysis (ADRs 0014, 0015): cw task review reads a
// done report and checks foreign commits in one call, and the findings the user decides on gate the
// return and the delivery. The reviewer's result is written as the file cw review save leaves.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { gitIn, write } from '../fixtures/repo.mjs';
import { blocking, harness, implement, inPlace, specified, taskJson, writeReview } from './cycle-fixture.mjs';

const correctness = { id: 'F2', severity: 'non_blocking', rule: 'correctness', file: 'src/mul.mjs', line: 1, issue: 'mul(NaN, 1) returns NaN silently.', suggestion: 'Reject NaN' };
const question = { id: 'F3', severity: 'non_blocking', rule: 'spec', issue: 'R1 leaves open whether mul takes strings: reject them or convert them?', suggestion: 'Reject them', decision: true };

// A task whose round-1 implementer reported done, with the review round started.
function reviewing(t) {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  const started = ok(fx.root, ['task', 'review', '--task', id]);
  return { fx, run, ok, id, branch, started, head: gitIn(fx.app, fx.env)('rev-parse', branch) };
}

test('task review reads the done report in the same call; SubagentStart records the agents, so no step records them', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const { id } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  const text = run(fx.root, ['task', 'review', '--task', id]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^Report round 1: done · 1 commit\(s\) on \S+ · checks pass · 1 holding proof\(s\)\n {2}AC1 met: [^]*Call the Agent tool with exactly these parameters:/);
  assert.ok(taskJson(fx, id).agents.implementer.shownAt, 'the report counts as read for the stop gate');
  const started = ok(fx.root, ['task', 'review', '--task', id]);
  assert.deepEqual(started.next, [`cw review show --task ${id}`]);
  // cw checks names the rule hints of the diff (ADR 0017): mul's parameters a and b are single letters.
  const checks = ok(fx.root, ['checks', '--changed', '--task', id]);
  assert.deepEqual(checks.hints.map((hint) => hint.text), ['a: a is not an allowed abbreviation', 'b: b is not an allowed abbreviation']);
  // No agent was recorded (no hook ran here): the command that reads the reviewer's result says how.
  writeReview(fx, id, 1, 'approved', { head: gitIn(fx.app, fx.env)('rev-parse', taskJson(fx, id).branch) });
  const shown = harness(fx).run(fx.root, ['review', 'show', '--task', id]);
  assert.match(shown.stderr, /No reviewer is recorded for round 1: the SubagentStart hook records one only while a single task of this session waits for it\. Record it for later messages: cw task agent --task \S+ --role reviewer --id <the agentId the Agent result names>\./);
  assert.equal(ok(fx.root, ['review', 'show', '--task', id]).status, 'approved');
});

test('task review refuses a branch with a foreign commit and names the rebase for the implementer', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const git = gitIn(fx.app, fx.env);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  const base = taskJson(fx, id).base.commit;
  git('switch', '-q', '-c', 'other', base);
  write(fx.app, { 'other.txt': 'other\n' });
  git('add', '-A');
  git('commit', '-q', '-m', '[TASK] Other work');
  git('switch', '-q', branch);
  git('rebase', '-q', 'other');
  const refused = run(fx.root, ['task', 'review', '--task', id]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /The task branch is not ready for a review:\n- foreign commit \w+ \[TASK\] Other work \(other-branch\)/);
  assert.match(refused.stderr, new RegExp(`Fix: send the same implementer the rebase that keeps only its own commits: git -C app rebase --onto ${base} \\w+ ${branch}; the implementer then reruns cw checks --changed --task ${id} and saves its report again`));
  assert.equal(taskJson(fx, id).phase, 'implement', 'the review round did not start');
});

test('an approval with a non-blocking correctness finding waits for the user; accept and ticket go into the open points', (t) => {
  const { fx, run, ok, id, head } = reviewing(t);
  writeReview(fx, id, 1, 'approved', { findings: [correctness, { ...question, id: 'F3' }], head });
  const shown = ok(fx.root, ['review', 'show', '--task', id]);
  assert.deepEqual(shown.findings.map((finding) => [finding.id, finding.needsUser]), [['F2', true], ['F3', true]]);
  assert.match(shown.next[0], new RegExp(`^ask the user about F2,F3 in one AskUserQuestion .*then cw review decide --task ${id} --finding F2,F3 --as fix\\|ticket\\|accept`));
  const refused = run(fx.root, ['pr', 'body', '--task', id]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /The approved review leaves F2, F3 to the user's decision\./);

  assert.equal(run(fx.root, ['review', 'decide', '--task', id, '--finding', 'F9', '--as', 'accept', '--note', 'x']).code, 2);
  assert.equal(run(fx.root, ['review', 'decide', '--task', id, '--finding', 'F2', '--as', 'later', '--note', 'x']).code, 2);
  const first = ok(fx.root, ['review', 'decide', '--task', id, '--finding', 'F2', '--as', 'accept', '--note', 'NaN cannot reach mul today']);
  assert.match(first.next[0], /^ask the user about F3/);
  const second = ok(fx.root, ['review', 'decide', '--task', id, '--finding', 'F3', '--as', 'ticket', '--note', 'Decide with the strings ticket']);
  assert.deepEqual(second.next, [`cw pr body --task ${id} --what <file>`, `cw pr command --task ${id}`]);
  assert.match(run(fx.root, ['review', 'show', '--task', id]).stdout, /F2 \[non_blocking · correctness · the user decided: accept \(NaN cannot reach mul today\)\]/);

  const what = join(fx.base, 'what-1.md');
  writeFileSync(what, '- `mul(a, b)` in `src/mul.mjs` multiplies two numbers.\n');
  const body = ok(fx.root, ['pr', 'body', '--task', id, '--what', what]).body;
  assert.match(body, /^## What & why\n\nNO-TICKET: Add mul\n\n`src\/sum\.mjs` has sum only\.\n\n- `mul\(a, b\)` in `src\/mul\.mjs` multiplies two numbers\.\n\n## Testing/);
  assert.ok(body.includes('- Accepted by the user (NaN cannot reach mul today): correctness: mul(NaN, 1) returns NaN silently. (`src/mul.mjs:1`)'), body);
  assert.ok(body.includes('- Needs a ticket (Decide with the strings ticket): spec: R1 leaves open whether mul takes strings'), body);
  assert.equal(run(fx.root, ['pr', 'body', '--task', id, '--what', join(fx.base, 'missing.md')]).code, 3);

  ok(fx.root, ['pr', 'record', '--task', id, '--skipped', 'No remote in the test.']);
  const ended = ok(fx.root, ['task', 'end', '--task', id, '--outcome', 'done']);
  assert.deepEqual(ended.tickets.map((item) => [item.finding, item.note]), [['1.1:F3', 'Decide with the strings ticket']]);
  assert.match(ended.newSession, /a new session is cheaper/);
  assert.match(ok(fx.root, ['task', 'list']).newSession, new RegExp(`this session ran ${id}`));
});

test('requested changes: a decision goes back in the same round, with a spec the answer changed', (t) => {
  const { fx, run, ok, id, branch, head } = reviewing(t);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking, question], head });
  assert.match(ok(fx.root, ['review', 'show', '--task', id]).next[0], /^ask the user about F3/);
  const early = run(fx.root, ['task', 'return', '--task', id]);
  assert.equal(early.code, 3);
  assert.match(early.stderr, /The user has not decided on F3 of review round 1 yet; the answers go back in this round\./);

  // The answer sharpens the spec: saved now, the returned round works from it.
  const spec = readFileSync(join(fx.root, '.git', 'dev-workflow', 'tasks', id, 'spec.md'), 'utf8').replace('- R1 Export mul(a, b) from src/mul.mjs.', '- R1 Export mul(a, b) from src/mul.mjs; it rejects strings.');
  assert.match(ok(fx.root, ['spec', 'save', '--task', id], spec).next, /then cw task return --task/);
  ok(fx.root, ['review', 'decide', '--task', id, '--finding', 'F3', '--as', 'fix', '--note', 'Reject strings']);
  const back = ok(fx.root, ['task', 'return', '--task', id]);
  assert.equal(back.sendMessage.to, 'impl-1');
  const message = back.sendMessage.message;
  assert.ok(message.includes("The spec changed with the user's answers: the updated brief has the new spec."), message);
  assert.ok(message.includes('- [the user decided: fix (Reject strings) · spec] R1 leaves open whether mul takes strings'), message);
  assert.ok(message.includes('- [blocking · CORE-ERRORS] src/mul.mjs:1: No input check'), message);
  assert.ok(readFileSync(back.brief, 'utf8').includes('it rejects strings'), 'the brief carries the new spec');
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).specRevised, taskJson(fx, id).specChanged], ['implement', false, false]);
  assert.equal(branch, taskJson(fx, id).branch);
});

test('an approval with a fix decision goes back to the implementer; the pr commands refuse until then', (t) => {
  const { fx, run, ok, id, head } = reviewing(t);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  writeReview(fx, id, 1, 'approved', { findings: [correctness], head });
  ok(fx.root, ['review', 'decide', '--task', id, '--finding', 'F2', '--as', 'fix', '--note', 'Fix it now']);
  assert.deepEqual(ok(fx.root, ['review', 'show', '--task', id]).next, [`cw task return --task ${id}`]);
  const refused = run(fx.root, ['pr', 'command', '--task', id]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, new RegExp(`The user decided to fix F2 in this task\\.\\nFix: Send them back first: cw task return --task ${id}\\.`));
  const back = ok(fx.root, ['task', 'return', '--task', id]);
  assert.match(back.sendMessage.message, /^Review round 1 approved, and the user decided to fix these findings in this task\./);
  assert.ok(back.sendMessage.message.includes('- [the user decided: fix (Fix it now) · correctness] src/mul.mjs:1: mul(NaN, 1) returns NaN silently.'));
  assert.deepEqual([taskJson(fx, id).phase, taskJson(fx, id).round], ['implement', 2]);
});
