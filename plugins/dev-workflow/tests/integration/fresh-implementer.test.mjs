// A fresh implementer above the context threshold (ADR 0012), as processes: cw task return measures the
// recorded implementer's transcript and prints a fresh Agent call with the takeover brief instead of
// the SendMessage when the context is larger than workflow.freshImplementerAboveTokens; below it, with
// the rule off, or without a readable transcript the SendMessage stays. The report's handover is
// required, and SubagentStop records the transcript path Claude Code reports.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hookInput, runHookScript } from '../fixtures/hooks/index.mjs';
import { addAgentWorktree, gitIn, makeWorktreeRepo, worktreeConfig } from '../fixtures/repo.mjs';
import { homeTranscriptPath, writeTranscript } from '../fixtures/transcript.mjs';
import { HANDOVER, PACKAGES, STRICT_MUL, blocking, harness, implement, inPlace, specified, taskJson, writeReview } from './cycle-fixture.mjs';

// In place: one implementer round (impl-1) with a done report, and a review that requests changes.
function toReturn(fx) {
  const { ok } = harness(fx);
  const { id, branch } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'reviewer', '--id', 'rev-1']);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: gitIn(fx.app, fx.env)('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  return { id, branch };
}

const withLimit = (t, limit) => inPlace(t, { workflow: { freshImplementerAboveTokens: limit } });

test('in place: above the threshold task return prints a fresh Agent call with the takeover brief, records the switch, and the new agent continues', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const { id, branch } = toReturn(fx);
  writeTranscript(homeTranscriptPath(fx.env, 'impl-1'), 451_000);

  const back = ok(fx.root, ['task', 'return', '--task', id]);
  assert.equal('sendMessage' in back, false, 'no SendMessage to the large agent');
  assert.equal(back.agentCall.subagent_type, 'dev-workflow:implementer-s');
  assert.equal(back.freshAgent, 'the context of impl-1 is 451k tokens, above workflow.freshImplementerAboveTokens (150k)');
  assert.deepEqual([back.context.tokens, back.context.limit, back.context.over], [451_000, 150_000, true]);
  assert.deepEqual(back.next, [`cw task agent --task ${id} --role implementer --id <the agentId the Agent tool returned>`, `cw report show --task ${id}`]);

  // The brief: spec, handover, findings and the branch state with its files, but no diff.
  const brief = readFileSync(back.brief, 'utf8');
  for (const part of [
    '## Spec', '## Taking over from an earlier implementer', `You take ${branch} over from an earlier implementer`,
    '### Branch state', '1 commit(s) since the base', '[FEATURE] Add the mul helper', '- Changed files since the base (2):', '  - src/mul.mjs', '  - src/mul.test.mjs',
    '### Handover from the report of round 1 (done)', `- ${HANDOVER.decisions[0]}`, `- ${HANDOVER.rejected[0]}`, `- ${HANDOVER.testing[0]}`,
    '## Review findings to fix', '- [blocking · CORE-ERRORS] src/mul.mjs:1: No input check — Reject non-numbers',
  ]) assert.ok(brief.includes(part), part);
  assert.ok(!/^(diff --git|@@ |[+-]export const mul)/m.test(brief), 'the brief holds no diff');
  assert.ok(!brief.includes('Pitfalls:'), 'empty handover lists are left out');

  // The history and cw task show name the reason and the size.
  const task = taskJson(fx, id);
  const entry = task.history.at(-1);
  assert.equal(entry.note, 'a fresh implementer for round 2 (context 451k > 150k)');
  assert.deepEqual(entry.agentSwitch, { role: 'implementer', previous: 'impl-1', reason: 'context', tokens: 451_000, limit: 150_000 });
  assert.equal(entry.by, 'cw task return');
  assert.deepEqual([task.phase, task.round, task.agents.implementer], ['implement', 2, null]);
  const shown = run(fx.root, ['task', 'show', '--task', id]);
  assert.match(shown.stdout, /^\S+ a fresh implementer for round 2 \(context 451k > 150k\)$/m);

  // The fresh agent takes the branch over and reports the next round.
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-2']);
  implement(fx, id, { cwd: fx.root, tree: fx.app, files: STRICT_MUL, summary: 'Reject non-numbers in mul', prove: false });
  assert.equal(ok(fx.root, ['report', 'show', '--task', id]).round, 2);
});

test('in place: below the threshold the same implementer gets the SendMessage, unchanged', (t) => {
  const fx = inPlace(t);
  const { run } = harness(fx);
  const { id } = toReturn(fx);
  writeTranscript(homeTranscriptPath(fx.env, 'impl-1'), 149_000);

  const back = run(fx.root, ['task', 'return', '--task', id]);
  assert.equal(back.code, 0, back.stderr);
  assert.match(back.stdout, /^SendMessage to impl-1 \(the same implementer\) with exactly this message:$/m);
  assert.match(back.stdout, /^Review round 1 requests changes/m);
  assert.ok(!/Agent tool|A fresh implementer|context size/.test(back.stdout), back.stdout);
  const task = taskJson(fx, id);
  assert.equal(task.agents.implementer.id, 'impl-1');
  assert.ok(!task.history.some((item) => item.agentSwitch));
  assert.ok(!readFileSync(join(fx.root, '.git', 'dev-workflow', 'tasks', id, 'brief-implementer.md'), 'utf8').includes('## Taking over'), 'the same agent gets no takeover section');
});

test('in place: a missing or unreadable transcript keeps the SendMessage and says so in one line', (t) => {
  for (const [label, prepare, reason] of [
    ['missing', () => {}, /\(no transcript of impl-1 under .*\/home\/\.claude\/projects\)/],
    ['unreadable', (fx) => mkdirSync(homeTranscriptPath(fx.env, 'impl-1'), { recursive: true }), /agent-impl-1\.jsonl cannot be read \(EISDIR\)/],
    ['without usage', (fx) => {
      writeTranscript(homeTranscriptPath(fx.env, 'impl-1'), 1);
      writeFileSync(homeTranscriptPath(fx.env, 'impl-1'), '{"type":"user","message":{"content":"Task …"}}\n');
    }, /agent-impl-1\.jsonl holds no assistant message with token usage/],
  ]) {
    const fx = inPlace(t);
    const { run } = harness(fx);
    const { id } = toReturn(fx);
    prepare(fx);
    const text = run(fx.root, ['task', 'return', '--task', id]);
    assert.equal(text.code, 0, `${label}: ${text.stderr}`);
    const lines = text.stdout.split('\n').filter((line) => line.startsWith('The context size of impl-1 is unknown'));
    assert.equal(lines.length, 1, `${label}: ${text.stdout}`);
    assert.match(lines[0], reason, label);
    assert.match(lines[0], /, so it gets the SendMessage\.$/, label);
    assert.match(text.stdout, /^SendMessage to impl-1 /m, label);
    assert.equal(taskJson(fx, id).agents.implementer.id, 'impl-1', label);
  }
});

test('the rule is off with 0 or null; the default is 150000; config show names the value', (t) => {
  const defaults = inPlace(t);
  assert.equal(harness(defaults).ok(defaults.root, ['config', 'show']).config.workflow.freshImplementerAboveTokens, 150_000);
  for (const limit of [0, null]) {
    const fx = withLimit(t, limit);
    const { ok } = harness(fx);
    assert.equal(ok(fx.root, ['config', 'show']).config.workflow.freshImplementerAboveTokens, limit);
    const { id } = toReturn(fx);
    writeTranscript(homeTranscriptPath(fx.env, 'impl-1'), 900_000);
    const back = ok(fx.root, ['task', 'return', '--task', id]);
    assert.equal(back.sendMessage.to, 'impl-1', `limit ${limit}`);
    assert.equal('context' in back, false, `limit ${limit}: nothing is measured`);
  }
  const low = withLimit(t, 1000);
  const { ok } = harness(low);
  const { id } = toReturn(low);
  writeTranscript(homeTranscriptPath(low.env, 'impl-1'), 1001);
  assert.equal(ok(low.root, ['task', 'return', '--task', id]).freshAgent, 'the context of impl-1 is 1k tokens, above workflow.freshImplementerAboveTokens (1k)');
});

test('config validate refuses a negative or fractional threshold', (t) => {
  for (const limit of [-1, 1.5, '150000']) {
    const fx = withLimit(t, limit);
    const result = harness(fx).run(fx.root, ['config', 'validate']);
    assert.equal(result.code, 1, `limit ${JSON.stringify(limit)}`);
    assert.match(result.stderr, /\$\.workflow\.freshImplementerAboveTokens: must be/);
  }
});

test('report save refuses a report without the handover, with a Fix line', (t) => {
  const fx = inPlace(t);
  const { run, ok } = harness(fx);
  const { id } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  ok(fx.root, ['ws', 'setup', '--task', id]);
  const refused = run(fx.root, ['report', 'save', '--task', id], JSON.stringify({ status: 'blocked', acceptanceCriteria: [], blocked: { question: 'Integers only?', needed: 'a decision' } }));
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /\$\.handover: is required: \{ "decisions": \[\], "rejected": \[\], "testing": \[\], "pitfalls": \[\], "deviations": \[\] \}, each a list of short notes for a fresh implementer/);
  assert.match(refused.stderr, new RegExp(`Fix: Fix each point, then pipe the report to cw report save --task ${id} again\\.`));
  assert.equal(existsSync(join(fx.root, '.git', 'dev-workflow', 'tasks', id, 'report-1.json')), false);
});

test('worktree: SubagentStop records the transcript path Claude Code reports; above the threshold task return releases the worktree for a fresh agent', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig({ packages: PACKAGES }) });
  const { run, ok } = harness(fx);
  const main = gitIn(fx.root, fx.env);
  const { id, branch } = specified(fx, { complexity: 'm' });
  ok(fx.root, ['task', 'start', '--task', id]);
  const one = addAgentWorktree(fx.root, fx.env, 'one');
  const stop = (agentId) => runHookScript('subagent-stop', hookInput('subagent-stop', {
    cwd: one, agentId, agentType: 'dev-workflow:implementer-m', message: 'done', sessionDir: join(fx.base, 'elsewhere', 'test-session'),
  }), { env: fx.env });
  const start = runHookScript('subagent-start', hookInput('subagent-start', { cwd: one, agentId: 'impl-w', agentType: 'dev-workflow:implementer-m' }), { env: fx.env });
  assert.equal(start.code, 0, start.stderr);
  implement(fx, id, { cwd: one, tree: one });
  const stopped = stop('impl-w');
  assert.deepEqual([stopped.code, stopped.stdout], [0, ''], stopped.stderr);
  const recorded = join(fx.base, 'elsewhere', 'test-session', 'subagents', 'agent-impl-w.jsonl');
  assert.equal(taskJson(fx, id).agents.implementer.transcript, recorded);
  assert.equal(stop('impl-unknown').code, 0, 'an agent of no task records nothing');

  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  writeReview(fx, id, 1, 'changes_requested', { findings: [blocking], head: main('rev-parse', branch) });
  ok(fx.root, ['review', 'show', '--task', id]);
  // Only the recorded path holds the transcript: the HOME search would find nothing.
  writeTranscript(recorded, 300_000);

  const back = run(fx.root, ['task', 'return', '--task', id]);
  assert.equal(back.code, 0, back.stderr);
  assert.match(back.stdout, /^A fresh implementer: the context of impl-w is 300k tokens, above workflow\.freshImplementerAboveTokens \(150k\)\.$/m);
  assert.match(back.stdout, /^Call the Agent tool with exactly these parameters:$/m);
  assert.match(back.stdout, /"isolation": "worktree"/);
  assert.ok(!back.stdout.includes('SendMessage'), back.stdout);
  assert.equal(existsSync(one), false, 'the clean old worktree is released for the new agent');
  const task = taskJson(fx, id);
  assert.deepEqual([task.resumeBranch, task.workTree, task.agents.implementer], [true, null, null]);
  assert.equal(task.history.at(-1).note, 'a fresh implementer for round 2 (context 300k > 150k)');
  const brief = readFileSync(join(fx.root, '.git', 'dev-workflow', 'tasks', id, 'brief-implementer.md'), 'utf8');
  for (const part of ['### Branch state', '  - src/mul.mjs', '### Handover from the report of round 1 (done)', '## Review findings to fix']) assert.ok(brief.includes(part), part);

  const two = addAgentWorktree(fx.root, fx.env, 'two');
  ok(fx.root, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-w2']);
  implement(fx, id, { cwd: two, tree: two, files: STRICT_MUL, summary: 'Reject non-numbers in mul', prove: false });
  assert.equal(ok(fx.root, ['report', 'show', '--task', id]).round, 2);
});
