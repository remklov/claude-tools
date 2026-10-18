import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluate, splitSegments, tokenize } from '../../hooks/guard-rules.mjs';
import { detectIntent } from '../../hooks/intent.mjs';
import { findContext } from '../../scripts/lib/ctx.mjs';
import { packGuards, resolvePacks } from '../../scripts/lib/packs.mjs';
import { loadProfile } from '../../scripts/lib/profile.mjs';
import { cleanEnv, cw, git, makeProject, pluginRoot } from '../helpers/repo.mjs';

const hook = (name, input) => {
  const out = execFileSync('node', [join(pluginRoot, 'hooks', `${name}.mjs`)], { input: JSON.stringify(input), encoding: 'utf8', env: cleanEnv() });
  return out ? JSON.parse(out) : null;
};

function guardSetup() {
  const { root } = makeProject();
  const wt = join(root, '.claude/worktrees/agent-1');
  git(root, 'worktree', 'add', '-q', wt, '-b', 'worktree-agent-1', 'HEAD');
  const ctx = findContext(wt);
  const profile = loadProfile(ctx);
  const guards = packGuards(resolvePacks(ctx, profile, { quiet: true }));
  const decide = (command, agentType = 'dev-workflow:implementer-m', tool = 'Bash', toolInput) =>
    evaluate({ input: { tool_name: tool, tool_input: toolInput ?? { command }, agent_type: agentType, cwd: wt }, ctx, profile, guards })?.hookSpecificOutput.permissionDecisionReason.split(':')[0] ?? null;
  return { root, wt, decide };
}

test('shell parsing: segments, quotes, env prefixes, heredocs', () => {
  assert.deepEqual(splitSegments('cd /x && git push; echo "git push" | cat'), ['cd /x', 'git push', 'echo "git push"', 'cat']);
  assert.deepEqual(tokenize('FOO=1 sudo npm install lodash'), ['npm', 'install', 'lodash']);
  assert.deepEqual(splitSegments("cat <<'EOF'\ngit push\nEOF\necho ok"), ["cat <<'EOF'", 'echo ok']);
});

test('guard catalog: each rule denies its case and lets the neighbour through', () => {
  const { root, wt, decide } = guardSetup();
  assert.equal(decide('git push -u origin x'), 'G-PUSH');
  assert.equal(decide('echo "git push"'), null);
  assert.equal(decide('git push --force', ''), 'G-FORCE');
  assert.equal(decide('git push origin main', 'dev-workflow:orchestrator'), null);
  assert.equal(decide(`cd ${root}`), 'G-MAIN-CHECKOUT');
  assert.equal(decide(`git -C ${root} status`), 'G-MAIN-CHECKOUT');
  assert.equal(decide(`cat ${root}/.git/dev-workflow/tasks/x/brief-implementer.md`), null);
  assert.equal(decide(`ls ${wt}/api`), null);
  assert.equal(decide('npm install lodash'), 'G-DEPS');
  assert.equal(decide('npm test'), null);
  assert.equal(decide('make up'), 'G-COMMANDS');
  assert.equal(decide('drizzle-kit push'), 'G-COMMANDS');
  assert.equal(decide('curl http://localhost:5174/'), 'G-PORTS');
  assert.equal(decide('curl http://localhost:3000/'), null);
  assert.equal(decide('npm run dev'), 'G-DEVSERVER');
  assert.equal(decide('echo SECRET=1 > .env'), 'G-WRITE-PATHS');
  assert.equal(decide('git commit -m x', 'dev-workflow:reviewer'), 'G-GIT-WRITE-R');
  assert.equal(decide('git log --oneline', 'dev-workflow:reviewer'), null);
  assert.equal(decide(`sed -i s/a/b/ ${wt}/api/sum.mjs`, 'dev-workflow:reviewer'), 'G-FILE-WRITE-R');
  assert.equal(decide('echo x > /tmp/out.txt', 'dev-workflow:reviewer'), null);
  assert.equal(decide(null, 'dev-workflow:orchestrator', 'Agent', { subagent_type: 'dev-workflow:implementer-m', model: 'haiku' }), 'G-AGENT-OVERRIDE');
  assert.equal(decide(null, '', 'Agent', { subagent_type: 'fable-helper' }), 'G-NO-FABLE');
  assert.equal(decide('npm install', ''), null);
});

test('ticket intent: German and English start phrases, no false positives', () => {
  const id = '^[A-Z]+-[0-9]+[a-z]?$';
  const cases = [
    ['starte mit Ticket NV-9', ['NV-9']], ['Starte mit NV-9 und APP-2', ['NV-9', 'APP-2']], ['arbeite an Ticket SEC-6 bitte', ['SEC-6']],
    ['work on OPS-12', ['OPS-12']], ['pick up DGII-2', ['DGII-2']], ['nimm das nächste Ticket', 'next'], ['next ticket please', 'next'],
    ['was steht in NV-9?', null], ['erkläre mir NV-9', null], ['wie geht es dir', null],
  ];
  for (const [text, expected] of cases) {
    const result = detectIntent(text, id);
    if (expected === null) assert.equal(result, null, text);
    else if (expected === 'next') assert.equal(result?.next, true, text);
    else assert.deepEqual(result?.ids, expected, text);
  }
});

test('hooks are no-ops without a profile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-noprofile-'));
  git(dir, 'init', '-q');
  for (const name of ['session-start', 'subagent-start', 'subagent-stop', 'guard', 'ticket-intent']) {
    assert.equal(hook(name, { cwd: dir, agent_type: 'dev-workflow:implementer-s', tool_name: 'Bash', tool_input: { command: 'git push' }, prompt: 'starte mit Ticket AB-1' }), null, name);
  }
});

test('subagent-start gives the role context within the limit', () => {
  const { root } = makeProject();
  const out = hook('subagent-start', { cwd: root, agent_type: 'dev-workflow:implementer-m', agent_id: 'a1' });
  const text = out.hookSpecificOutput.additionalContext;
  assert.match(text, /Role: implementer/);
  assert.match(text, /sql-migration/);
  assert.ok(text.length <= 6000);
  assert.equal(hook('subagent-start', { cwd: root, agent_type: 'Explore' }), null);
});

test('ticket-intent adds the first command in an orchestrator session only', () => {
  const { root } = makeProject();
  const out = hook('ticket-intent', { cwd: root, agent_type: 'dev-workflow:orchestrator', prompt: 'starte mit Ticket AB-2' });
  assert.match(out.hookSpecificOutput.additionalContext, /cw intake AB-2/);
  assert.equal(hook('ticket-intent', { cwd: root, prompt: 'starte mit Ticket AB-2' }), null);
});

test('subagent-stop blocks an invalid result twice, then lets go', () => {
  const { root } = makeProject();
  const input = { cwd: root, agent_type: 'dev-workflow:implementer-s', agent_id: 'x1', last_assistant_message: 'All done!' };
  assert.equal(hook('subagent-stop', input).decision, 'block');
  assert.equal(hook('subagent-stop', input).decision, 'block');
  assert.equal(hook('subagent-stop', input), null);
});

test('subagent-stop accepts the saved report', () => {
  const { root } = makeProject();
  cw(root, ['intake', 'AB-2']);
  cw(root, ['task', 'new', '--ticket', 'AB-2', '--slug', 'product-helper', '--title', 'x']);
  const fence = '```json\n' + JSON.stringify({ kind: 'dev-report', version: 1, task: 'ab-2-product-helper', round: 1, status: 'blocked', branch: 'x', changedFiles: [], acceptanceCriteria: [], checks: { overall: 'missing' }, migrations: 'none', docs: [], openPoints: [], blocked: { question: 'q', needed: 'n' } }) + '\n```';
  const unsaved = hook('subagent-stop', { cwd: root, agent_type: 'dev-workflow:implementer-s', agent_id: 'x2', last_assistant_message: fence });
  assert.match(unsaved.reason, /was not saved/);
});

test('session-start reports a stale rulebook once', () => {
  const { root } = makeProject();
  const first = hook('session-start', { cwd: root, source: 'startup' });
  assert.match(first.hookSpecificOutput.additionalContext, /rulebook/);
  cw(root, ['rules', 'build']);
  const second = hook('session-start', { cwd: root, source: 'resume' });
  assert.ok(second === null || !/rulebook/.test(second.hookSpecificOutput.additionalContext));
});
