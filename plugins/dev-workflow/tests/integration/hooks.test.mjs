// The four hook scripts as Claude Code runs them: a node process with a JSON stdin fixture
// (tests/fixtures/hooks/), in the fixture repos of tests/fixtures/repo.mjs, with the real cw commands
// moving the task between the hook calls.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { fence } from '../../cli/lib/report.mjs';
import { hookInput, runHookScript } from '../fixtures/hooks/index.mjs';
import { addAgentWorktree, cw, makeWorktreeRepo, tempBase, write } from '../fixtures/repo.mjs';
import { BLOCKED, DONE, harness, implement, inPlace, specified, taskJson, writeReview } from './cycle-fixture.mjs';

const IMPLEMENTER = 'dev-workflow:implementer-s';
const REVIEWER = 'dev-workflow:reviewer';

const hook = (fx, script, fixture, values = {}) => runHookScript(script, hookInput(fixture, { cwd: fx.root, ...values }), { env: fx.env });
const hooksLog = (fx) => readFileSync(join(fx.root, '.git', 'dev-workflow', 'hooks.log'), 'utf8');
const silent = (result, label) => assert.deepEqual([result.code, result.stdout, result.stderr], [0, '', ''], label);

function started(t) {
  const fx = inPlace(t);
  const { ok, run } = harness(fx);
  const { id } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  return { fx, ok, run, id };
}

test('every hook is a silent no-op without a project config', (t) => {
  const base = tempBase(t);
  const fx = { root: base, env: { ...process.env } };
  silent(hook(fx, 'session-start', 'session-start'), 'session-start');
  silent(hook(fx, 'subagent-start', 'subagent-start', { agentId: 'a1', agentType: IMPLEMENTER }), 'subagent-start');
  silent(hook(fx, 'subagent-stop', 'subagent-stop', { agentId: 'a1', agentType: IMPLEMENTER, message: 'done' }), 'subagent-stop');
  silent(hook(fx, 'guard', 'pre-tool-use-bash', { command: 'git push --force' }), 'guard');

  // A config outside a git repository: no task state, so only SessionStart speaks up.
  write(base, { '.claude/dev-workflow/config.json': { version: 1, project: { name: 'x' }, packs: [], packages: [] } });
  assert.match(hook(fx, 'session-start', 'session-start').json().systemMessage, /config invalid/);
  silent(hook(fx, 'guard', 'pre-tool-use-bash', { command: 'git push --force' }), 'guard without task state');
});

test('SessionStart prints the setup issues in one line plus the facts, and nothing once all is well', (t) => {
  const fx = inPlace(t);
  const first = hook(fx, 'session-start', 'session-start');
  assert.equal(first.code, 0, first.stderr);
  const output = first.json();
  assert.match(output.systemMessage, /^dev-workflow: \d+ setup issues? \(/);
  assert.doesNotMatch(output.systemMessage, /\n/);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /^dev-workflow setup facts:\n/);
  assert.match(output.hookSpecificOutput.additionalContext, /^- \[warning\] tickets\.source is local, but docs\/tickets\/ does not exist\. Fix: /m);
  assert.match(output.hookSpecificOutput.additionalContext, /out of date .*Fix: Run cw rules build/);

  harness(fx).ok(fx.root, ['rules', 'build']);
  write(fx.root, { 'docs/tickets/APP-1.md': '# A ticket\n' });
  write(join(fx.base, 'home'), { '.claude/settings.json': { sandbox: { network: { allowLocalBinding: true } } } });
  silent(hook(fx, 'session-start', 'session-start', { source: 'resume' }), 'every check passes');

  write(fx.root, { '.claude/dev-workflow/config.json': { version: 1, project: {} } });
  const broken = hook(fx, 'session-start', 'session-start').json();
  assert.match(broken.systemMessage, /config invalid/);
});

test('SubagentStart records the waiting implementer once and gives it its role context', (t) => {
  const { fx, id } = started(t);
  assert.equal(taskJson(fx, id).agents.implementer, null);
  silent(hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-r', agentType: REVIEWER }), 'no task waits for a reviewer');
  silent(hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-x', agentType: IMPLEMENTER, session: 'other-session' }), 'another session owns no task');

  const result = hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-1', agentType: IMPLEMENTER });
  assert.equal(result.code, 0, result.stderr);
  const { hookSpecificOutput: out } = result.json();
  assert.equal(out.hookEventName, 'SubagentStart');
  assert.ok(out.additionalContext.length <= 6000);
  assert.match(out.additionalContext, new RegExp(`you are the implementer of task ${id} .* round 1\\.`));
  assert.match(out.additionalContext, /Git: `git -C app …` exactly in this form, from the project root/);
  assert.match(out.additionalContext, /Your brief file is named in your prompt/);
  assert.match(out.additionalContext, /- app \(path \.; areas backend\): test `node --test`/);

  const agent = taskJson(fx, id).agents.implementer;
  assert.deepEqual({ ...agent, startedAt: typeof agent.startedAt }, { id: 'agent-1', type: IMPLEMENTER, startedAt: 'string', round: 1, session: 'test-session' });
  assert.ok(Date.now() - Date.parse(agent.startedAt) < 60_000);
  silent(hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-2', agentType: IMPLEMENTER }), 'the round has its implementer');
  assert.match(hooksLog(fx), /subagent-start recorded implementer agent-1 \(dev-workflow:implementer-s\)/);
});

test('in-place, the brief, cw context and the SubagentStart context name the same git form', (t) => {
  const fx = inPlace(t);
  const { ok } = harness(fx);
  const { id } = specified(fx);
  const { brief } = ok(fx.root, ['task', 'start', '--task', id]);
  // The agent's Bash cwd is app/src, not the project root: the form stays the same, with the same note.
  const src = join(fx.app, 'src');
  const context = hook(fx, 'subagent-start', 'subagent-start', { cwd: src, agentId: 'agent-1', agentType: IMPLEMENTER }).json().hookSpecificOutput.additionalContext;
  ok(fx.root, ['ws', 'setup', '--task', id]);
  const cwContext = ok(src, ['context', '--task', id]);
  const forms = (text) => [...new Set([...text.matchAll(/`(git -C \S+) …`/g)].map((match) => match[1]))];
  assert.deepEqual(forms(readFileSync(brief, 'utf8')), ['git -C app']);
  assert.deepEqual(forms(context), ['git -C app']);
  assert.equal(cwContext.git, 'git -C app');
  assert.ok(cwContext.next.every((line) => !line.startsWith('git') || line.startsWith('git -C app ')), cwContext.next.join('\n'));
  assert.ok(cwContext.cwdNote);
  assert.ok(context.includes(`\nNote: ${cwContext.cwdNote}`), context);
});

test('SubagentStart records a fresh reviewer of the same round, and the stop check holds it (--new-agent, rebind)', (t) => {
  const { fx, ok, id } = started(t);
  hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-1', agentType: IMPLEMENTER });
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  assert.ok(hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-r1', agentType: REVIEWER }).json(), 'the first reviewer gets its context');
  assert.equal(taskJson(fx, id).agents.reviewer.id, 'agent-r1');

  // The reviewer is gone, and cw review show names --new-agent: the fresh Agent call frees the slot.
  assert.ok(ok(fx.root, ['task', 'review', '--task', id, '--new-agent']).agentCall);
  assert.equal(taskJson(fx, id).agents.reviewer, null);
  const context = hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-r2', agentType: REVIEWER }).json().hookSpecificOutput.additionalContext;
  assert.match(context, new RegExp(`you are the reviewer of task ${id} `));
  assert.deepEqual([taskJson(fx, id).agents.reviewer.id, taskJson(fx, id).agents.reviewer.session], ['agent-r2', 'test-session']);
  const stop = (agentId, session) => hook(fx, 'subagent-stop', 'subagent-stop', { agentId, agentType: REVIEWER, message: 'Looks good.', ...(session ? { session } : {}) });
  const held = stop('agent-r2').json();
  assert.equal(held.decision, 'block');
  assert.match(held.reason, new RegExp(`\\(1/2\\): there is no review-1\\.json for round 1 yet\\. .*pipe its JSON to \`cw review save --task ${id}\`.*end your turn with exactly the JSON fence it prints\\.$`));
  silent(stop('agent-r1'), 'the replaced reviewer is no longer the task\'s');

  // After a rebind the reviewer of the earlier session is stale: cw task review prints a fresh Agent
  // call, and the new session's reviewer is recorded and held the same way.
  const session2 = { ...fx.env, CLAUDE_CODE_SESSION_ID: 'session-2' };
  assert.equal(cw(fx.root, ['task', 'new', '--rebind', id], { env: session2 }).code, 0);
  const fresh = cw(fx.root, ['task', 'review', '--task', id, '--json'], { env: session2 }).json();
  assert.ok(fresh.agentCall);
  assert.match(fresh.freshAgent, /^agent-r2 was recorded in session test-session/);
  assert.equal(taskJson(fx, id).agents.reviewer, null);
  assert.ok(hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-r3', agentType: REVIEWER, session: 'session-2' }).json());
  assert.deepEqual([taskJson(fx, id).agents.reviewer.id, taskJson(fx, id).agents.reviewer.session], ['agent-r3', 'session-2']);
  assert.equal(stop('agent-r3', 'session-2').json().decision, 'block');
});

test('SubagentStart in worktree mode records an implementer only on a task of its complexity, never a guess', (t) => {
  const fx = makeWorktreeRepo(t);
  const { ok } = harness(fx);
  const first = specified(fx, { slug: 'first-task', complexity: 's' }).id;
  const second = specified(fx, { slug: 'second-task', complexity: 'm' }).id;
  ok(fx.root, ['task', 'start', '--task', first]);
  ok(fx.root, ['task', 'start', '--task', second]);
  // The Agent call of the first task was lost; the session delegates the second one.
  const tree = addAgentWorktree(fx.root, fx.env, 'b0b0');
  const out = hook(fx, 'subagent-start', 'subagent-start', { cwd: tree, agentId: 'agent-b', agentType: 'dev-workflow:implementer-m' }).json().hookSpecificOutput;
  assert.match(out.additionalContext, new RegExp(`you are the implementer of task ${second} `));
  assert.deepEqual([taskJson(fx, first).agents.implementer, taskJson(fx, second).agents.implementer.id], [null, 'agent-b']);

  // Two tasks of one complexity wait: the hook records nothing and logs why.
  const third = specified(fx, { slug: 'third-task', complexity: 's' }).id;
  ok(fx.root, ['task', 'start', '--task', third]);
  silent(hook(fx, 'subagent-start', 'subagent-start', { cwd: tree, agentId: 'agent-x', agentType: IMPLEMENTER }), 'two tasks wait for an implementer-s');
  assert.deepEqual([taskJson(fx, first).agents.implementer, taskJson(fx, third).agents.implementer], [null, null]);
  assert.match(hooksLog(fx), /subagent-start recorded no implementer agent-x \(dev-workflow:implementer-s\): 2 tasks wait for one \(/);
});

test('SubagentStart in worktree mode names the agent worktree and plain git', (t) => {
  const fx = makeWorktreeRepo(t);
  const { ok } = harness(fx);
  const { id } = specified(fx);
  ok(fx.root, ['task', 'start', '--task', id]);
  const tree = addAgentWorktree(fx.root, fx.env, 'f00d');
  const out = hook(fx, 'subagent-start', 'subagent-start', { cwd: tree, agentId: 'agent-wt', agentType: IMPLEMENTER }).json().hookSpecificOutput;
  assert.match(out.additionalContext, /Mode: worktree · work tree: your own worktree .*agent-f00d/);
  assert.match(out.additionalContext, /Git: plain `git …` in your worktree/);
  assert.equal(taskJson(fx, id).agents.implementer.id, 'agent-wt');
});

test('SubagentStop holds the implementer until the report is saved, cross-checks the message, at most twice', (t) => {
  const { fx, ok, id } = started(t);
  hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-1', agentType: IMPLEMENTER });
  const stop = (message) => hook(fx, 'subagent-stop', 'subagent-stop', { agentId: 'agent-1', agentType: IMPLEMENTER, message });

  const missing = stop('I am done.');
  assert.equal(missing.code, 0, missing.stderr);
  assert.equal(missing.json().decision, 'block');
  assert.match(missing.json().reason, /^dev-workflow stop check \(1\/2\): there is no report-1\.json for round 1 yet\. .*pipe its JSON to `cw report save --task NO-TICKET__feature__mul-helper`.*JSON fence it prints\.$/);
  assert.deepEqual(taskJson(fx, id).stopBlocks, { 'agent-1': 1 });

  implement(fx, id, { cwd: fx.root, tree: fx.app });
  const report = JSON.parse(readFileSync(join(fx.root, '.git', 'dev-workflow', 'tasks', id, 'report-1.json'), 'utf8'));
  silent(stop(fence(report)), 'a saved, valid, fresh report with the same status');
  silent(stop(undefined), 'the Desktop app sends no last_assistant_message');

  const mismatch = stop(fence({ ...report, status: 'blocked' }));
  assert.match(mismatch.json().reason, /\(2\/2\): your final message says status blocked, but report-1\.json says done/);

  // The orchestrator read the report: a stop after that needs a new save, but the two blocks are used.
  ok(fx.root, ['report', 'show', '--task', id]);
  silent(stop(fence(report)), 'after two blocks the agent may stop');
  assert.match(hooksLog(fx), /let implementer agent-1 of NO-TICKET__feature__mul-helper stop after 2 blocks: report-1\.json was saved at .*before your current turn began/);
  silent(hook(fx, 'subagent-stop', 'subagent-stop', { agentId: 'agent-unknown', agentType: IMPLEMENTER, message: 'x' }), 'an agent of no known task');
});

test('SubagentStop: blocked, SendMessage, and the next report must be saved again', (t) => {
  const { fx, ok, id } = started(t);
  hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-1', agentType: IMPLEMENTER });
  const stop = () => hook(fx, 'subagent-stop', 'subagent-stop', { agentId: 'agent-1', agentType: IMPLEMENTER });
  ok(fx.root, ['ws', 'setup', '--task', id]);
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify(BLOCKED));
  silent(stop(), 'a blocked report is a valid report');

  ok(fx.root, ['report', 'show', '--task', id]);
  const stale = stop().json();
  assert.match(stale.reason, /\(1\/2\): report-1\.json was saved at \S+, before your current turn began \(\S+\); it is the earlier report\./);

  const file = join(fx.root, '.git', 'dev-workflow', 'tasks', id, 'report-1.json');
  writeFileSync(file, '{ "kind": "dev-report" ');
  assert.match(stop().json().reason, /\(2\/2\): report-1\.json cannot be read/);
  ok(fx.root, ['report', 'save', '--task', id], JSON.stringify(BLOCKED));
  silent(stop(), 'saved again after the continuation');
});

test('SubagentStop checks the reviewer against review-<n>.json, never an archived approval', (t) => {
  const { fx, ok, id } = started(t);
  hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-1', agentType: IMPLEMENTER });
  implement(fx, id, { cwd: fx.root, tree: fx.app });
  ok(fx.root, ['report', 'show', '--task', id]);
  ok(fx.root, ['task', 'review', '--task', id]);
  const context = hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-r', agentType: REVIEWER }).json().hookSpecificOutput.additionalContext;
  assert.match(context, /you are the reviewer of task .* review round 1\/3/);
  assert.match(context, /read-only/);
  const stop = () => hook(fx, 'subagent-stop', 'subagent-stop', { agentId: 'agent-r', agentType: REVIEWER, message: 'Looks good.' });

  assert.match(stop().json().reason, /there is no review-1\.json for round 1 yet\. Save this round's review .*`cw review save --task NO-TICKET__feature__mul-helper`/);
  const head = taskJson(fx, id).base.commit;
  writeReview(fx, id, 1, 'approved', { head });
  const dir = join(fx.root, '.git', 'dev-workflow', 'tasks', id);
  writeFileSync(join(dir, 'review-1-r1.json'), readFileSync(join(dir, 'review-1.json')));
  writeFileSync(join(dir, 'review-1.json'), JSON.stringify({ kind: 'review', version: 1, round: 1, reviewRound: 1, savedAt: new Date().toISOString(), status: 'approved' }));
  assert.match(stop().json().reason, /\(2\/2\): review-1\.json is not valid: /);
  writeReview(fx, id, 1, 'approved', { head });
  silent(stop(), 'a saved, valid review');
});

test('the guard denies with the reason in the PreToolUse output and logs it', (t) => {
  const { fx, ok, id } = started(t);
  const file = join(fx.app, 'src', 'sum.mjs');
  const editDeny = hook(fx, 'guard', 'pre-tool-use-edit', { file }).json();
  assert.deepEqual(Object.keys(editDeny.hookSpecificOutput), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
  assert.equal(editDeny.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(editDeny.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(editDeny.hookSpecificOutput.permissionDecisionReason, new RegExp(`^G-ORCH-EDIT: this session orchestrates task ${id}`));
  assert.match(hook(fx, 'guard', 'pre-tool-use-write', { file }).stdout, /G-ORCH-EDIT/);
  assert.match(hook(fx, 'guard', 'pre-tool-use-notebook-edit', { file: join(fx.app, 'x.ipynb') }).stdout, /G-ORCH-EDIT/);
  silent(hook(fx, 'guard', 'pre-tool-use-edit', { file, agentId: 'agent-1', agentType: IMPLEMENTER }), 'the implementer edits');

  const force = hook(fx, 'guard', 'pre-tool-use-bash', { command: 'git -C app push --force origin x' }).json();
  assert.match(force.hookSpecificOutput.permissionDecisionReason, /^G-FORCE: /);
  assert.match(hook(fx, 'guard', 'pre-tool-use-bash', { command: 'echo "$(git push)"', agentId: 'agent-1', agentType: IMPLEMENTER }).stdout, /G-PUSH/);
  silent(hook(fx, 'guard', 'pre-tool-use-bash', { command: 'git -C app push origin x' }), 'the orchestrator pushes after confirmation');
  assert.match(hook(fx, 'guard', 'pre-tool-use-agent', { subagentType: IMPLEMENTER, model: 'opus' }).stdout, /G-AGENT-PARAMS/);
  silent(hook(fx, 'guard', 'pre-tool-use-agent', { subagentType: IMPLEMENTER }), 'exactly the parameters cw prints');
  assert.match(hooksLog(fx), /guard deny G-ORCH-EDIT for the main session: .*sum\.mjs/);
  assert.match(hooksLog(fx), /guard deny G-PUSH for dev-workflow:implementer-s: echo "\$\(git push\)"/);

  ok(fx.root, ['task', 'end', '--task', id, '--outcome', 'aborted']);
  silent(hook(fx, 'guard', 'pre-tool-use-edit', { file }), 'editing works again after cw task end');
});

test('the guard in worktree mode refuses an implementer Agent call without isolation', (t) => {
  const fx = makeWorktreeRepo(t);
  assert.match(hook(fx, 'guard', 'pre-tool-use-agent', { subagentType: 'dev-workflow:implementer-m' }).stdout, /G-AGENT-PARAMS: in worktree mode/);
  silent(hook(fx, 'guard', 'pre-tool-use-agent', { subagentType: 'dev-workflow:implementer-m', isolation: 'worktree' }));
});

test('the hooks fail open on a broken config or input and log why', (t) => {
  const fx = inPlace(t);
  writeFileSync(join(fx.root, '.claude', 'dev-workflow', 'config.json'), '{ broken');
  silent(hook(fx, 'guard', 'pre-tool-use-bash', { command: 'git push --force' }), 'a broken config fails open');
  silent(hook(fx, 'subagent-start', 'subagent-start', { agentId: 'a1', agentType: IMPLEMENTER }));
  assert.match(hooksLog(fx), /guard failed open: .*config\.json/);
  const garbage = runHookScript('guard', { cwd: fx.root }, { env: fx.env, cwd: fx.root });
  silent(garbage, 'an input without a tool');
  const result = cw(fx.root, ['doctor', '--json'], { env: fx.env });
  assert.equal(result.code, 1, 'cw doctor reports the broken config the hooks skip');
});

test('a typical guard call stays well under 300 ms', (t) => {
  const { fx } = started(t);
  const input = hookInput('pre-tool-use-bash', { cwd: fx.root, agentId: 'agent-1', agentType: IMPLEMENTER, command: 'cd app && npm test 2>&1 | tail -20' });
  runHookScript('guard', input, { env: fx.env });
  const times = Array.from({ length: 7 }, () => runHookScript('guard', input, { env: fx.env }).ms).sort((a, b) => a - b);
  t.diagnostic(`guard: median ${times[3].toFixed(0)} ms of ${times.map((ms) => ms.toFixed(0)).join(', ')} (process start included)`);
  // The other test files run in parallel and add noise to the median; the fastest run is the hook's own cost.
  assert.ok(times[0] < 300, `fastest run ${times[0].toFixed(0)} ms`);
  const start = hook(fx, 'subagent-start', 'subagent-start', { agentId: 'agent-1', agentType: IMPLEMENTER });
  const stop = hook(fx, 'subagent-stop', 'subagent-stop', { agentId: 'agent-1', agentType: IMPLEMENTER });
  const session = hook(fx, 'session-start', 'session-start');
  t.diagnostic(`subagent-start ${start.ms.toFixed(0)} ms, subagent-stop ${stop.ms.toFixed(0)} ms, session-start ${session.ms.toFixed(0)} ms`);
  assert.ok(Math.max(start.ms, stop.ms, session.ms) < 2000);
});
