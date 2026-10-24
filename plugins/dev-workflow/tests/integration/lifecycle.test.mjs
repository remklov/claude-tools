// The full task lifecycle as processes, from cw task new to cw task end (P2 acceptance): in-place with
// a GitHub origin and worktree mode with a GitLab origin, both pushing into a bare fixture remote, with
// stub gh and glab. Every role runs from a cwd of its own, and none of them is the work tree's root
// unless the role works there (D5).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { readJson } from '../../cli/lib/fsx.mjs';
import { addAgentWorktree, cw, gitIn, inPlaceConfig, makeInPlace, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';
import { stubCli, stubDir } from '../fixtures/stubs.mjs';

const PACKAGES = [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' }, testSingle: 'node --test {file}' }];
const MUL = {
  'src/mul.mjs': 'export const mul = (a, b) => a * b;\n',
  'src/mul.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { mul } from './mul.mjs';\n\ntest('multiplies', () => assert.equal(mul(2, 3), 6));\n",
};
const NO_PR = [{ args: ['pr', 'view'], stderr: 'no pull requests found\n', exit: 1 }, { args: ['mr', 'view'], stderr: 'no merge request\n', exit: 1 }, { args: ['mr', 'list'], stdout: '[]' }];

const spec = (branch) => `## Task: Add the mul helper

**Ticket:** NO-TICKET · **Type:** feature · **Branch:** ${branch}

### Context
\`src/sum.mjs\` has sum only; CORE-SCOPE keeps the change to the helper.

### Requirements
- R1 Export mul(a, b) from src/mul.mjs.

### Acceptance criteria
- [ ] AC1 mul(2, 3) returns 6.

### Non-goals
- No division.

### Definition of done
- Checks pass.
`;

// Points origin at a hosted URL while pushes still land in the fixture's bare repo.
function hostOrigin(repo, env, url, bare) {
  const git = gitIn(repo, env);
  git('remote', 'set-url', 'origin', url);
  git('config', 'remote.origin.pushurl', bare);
}

function harness(fx) {
  const run = (cwd, args, input, env = fx.env) => cw(cwd, args, { env, input });
  const ok = (cwd, args, input, env) => {
    const result = run(cwd, [...args, '--json'], input, env);
    assert.equal(result.code, 0, `cw ${args.join(' ')}: ${result.stderr}`);
    return result.json();
  };
  return { run, ok };
}

// O1–O10 with the implementer in `implementerCwd` (its work tree: `tree`) and the reviewer elsewhere.
function lifecycle(fx, { orchestratorCwd, implementerCwd: implementerCwdOf, reviewerCwd, tree: treeOf, onReport = () => {} }) {
  const { run, ok } = harness(fx);
  const { task: id, branch } = ok(orchestratorCwd, ['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'mul-helper', '--title', 'Add the mul helper', '--type', 'feature']);
  ok(orchestratorCwd, ['ticket', 'save', '--task', id], '```json\n{ "key": "NO-TICKET", "summary": "Add mul", "source": "notes" }\n```');
  ok(orchestratorCwd, ['spec', 'save', '--task', id], spec(branch));
  ok(orchestratorCwd, ['spec', 'lint', '--task', id]);
  assert.equal(ok(orchestratorCwd, ['classify', '--task', id]).minComplexity, 's');
  ok(orchestratorCwd, ['classify', '--task', id, '--set', 's', '--why', 'One small helper in one file.']);
  const started = ok(orchestratorCwd, ['task', 'start', '--task', id]);
  ok(orchestratorCwd, ['task', 'agent', '--task', id, '--role', 'implementer', '--id', 'impl-1']);

  // The implementer (implementer-playbook steps 1–8).
  const implementerCwd = implementerCwdOf();
  const tree = treeOf(implementerCwd);
  ok(implementerCwd, ['ws', 'setup', '--task', id]);
  const context = ok(implementerCwd, ['context', '--task', id]);
  assert.ok(context.rules.some((rule) => rule.id === 'CORE-SCOPE'));
  write(tree, MUL);
  ok(implementerCwd, ['checks', '--changed', '--task', id]);
  const git = gitIn(tree, fx.env);
  git('add', '-A');
  const { file } = ok(implementerCwd, ['commit', 'msg', '--task', id, '--summary', 'Add the mul helper', '--keyword', 'FEATURE']);
  git('commit', '-q', '-F', file);
  ok(implementerCwd, ['commit', 'lint', '--task', id]);
  assert.equal(ok(implementerCwd, ['prove', '--task', id, '--test', 'app:src/mul.test.mjs', '--change', 'src/mul.mjs']).holds, true);
  ok(implementerCwd, ['checks', '--changed', '--task', id]);
  const report = run(implementerCwd, ['report', 'save', '--task', id], JSON.stringify({ status: 'done', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'src/mul.test.mjs › multiplies' }], handover: { decisions: [], rejected: [], testing: ['cw checks --changed'], pitfalls: [], deviations: [] } }));
  assert.equal(report.code, 0, report.stderr);
  assert.match(report.stdout, /^```json\n\{\n {2}"kind": "dev-report"/);

  // O7, O8: the report, foreign commits, the reviewer.
  assert.equal(ok(orchestratorCwd, ['report', 'show', '--task', id]).status, 'done');
  onReport({ id, ok, run });
  ok(orchestratorCwd, ['git', 'foreign-commits', '--task', id]);
  const review = ok(orchestratorCwd, ['task', 'review', '--task', id]);
  assert.equal(review.agentCall.subagent_type, 'dev-workflow:reviewer');
  ok(orchestratorCwd, ['task', 'agent', '--task', id, '--role', 'reviewer', '--id', 'rev-1']);

  // The reviewer (reviewer-playbook R1–R8), read-only, from its own cwd.
  const scope = ok(reviewerCwd, ['review', 'scope', '--task', id]);
  assert.deepEqual(scope.blocking, []);
  ok(reviewerCwd, ['checks', '--changed', '--task', id]);
  assert.equal(ok(reviewerCwd, ['prove', '--task', id, '--recheck']).allHold, true);
  const applicable = ok(reviewerCwd, ['rules', 'applicable', '--task', id]).rules.map((rule) => rule.id);
  ok(reviewerCwd, ['commit', 'lint', '--task', id]);
  const verdict = { status: 'approved', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'src/mul.test.mjs › multiplies; proof holds' }], rulesChecked: applicable, findings: [] };
  const saved = run(reviewerCwd, ['review', 'save', '--task', id], `Done.\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``);
  assert.equal(saved.code, 0, saved.stderr);

  // O9: delivery.
  assert.deepEqual(ok(orchestratorCwd, ['review', 'show', '--task', id]).next, [`cw pr body --task ${id}`, `cw pr command --task ${id}`]);
  const body = ok(orchestratorCwd, ['pr', 'body', '--task', id]);
  assert.match(body.body, /^## What & why\n\nNO-TICKET: Add mul\n/);
  assert.match(body.body, /## Testing\n\n- `node --test` in `\.` \(app\): pass\n- Proof: `node --test src\/mul\.test\.mjs` fails without the change \(Error \[ERR_MODULE_NOT_FOUND\]: Cannot find module 'src\/mul\.mjs' imported from src\/mul\.test\.mjs\) and passes with it\n/);
  assert.ok(!body.body.includes('cw-prove-'), 'no path of the temporary tree reaches the PR text');
  const command = ok(orchestratorCwd, ['pr', 'command', '--task', id]);
  return { id, branch, started, command, tree };
}

test('lifecycle in place with a GitHub origin: from task new to task end, from three different cwds', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ packages: PACKAGES }) });
  hostOrigin(fx.app, fx.env, 'git@github.com:acme/app.git', fx.remote);
  const gh = stubCli(stubDir(fx.base), 'gh', NO_PR);
  const configBefore = [fx.root, fx.app].map((repo) => readFileSync(join(repo, '.git', 'config'), 'utf8'));
  const { ok } = harness(fx);

  const { id, branch, started, command, tree } = lifecycle(fx, {
    orchestratorCwd: fx.root,
    implementerCwd: () => join(fx.app, 'src'),
    reviewerCwd: join(fx.root, '.claude'),
    tree: () => fx.app,
  });
  assert.equal('isolation' in started.agentCall, false);
  assert.equal(command.host.kind, 'github');
  assert.match(command.commands[1], /^gh pr create --repo github\.com\/acme\/app -B main -H NO-TICKET\/feature\/mul-helper -t '\[FEATURE\] Add the mul helper' -F /);
  assert.deepEqual(gh.calls().map((argv) => argv.slice(0, 2)), [['pr', 'view']]);

  // The orchestrator runs the push the user confirmed; cw itself never pushed.
  assert.equal(spawnSync('git', ['--git-dir', fx.remote, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { env: fx.env }).status, 1);
  execFileSync('sh', ['-c', command.commands[0]], { cwd: fx.root, env: fx.env });
  assert.equal(gitIn(fx.app, fx.env)('rev-parse', branch), execFileSync('git', ['--git-dir', fx.remote, 'rev-parse', branch], { env: fx.env, encoding: 'utf8' }).trim());

  ok(fx.root, ['pr', 'record', '--task', id, '--url', 'https://github.com/acme/app/pull/1']);
  assert.equal(ok(fx.root, ['task', 'cleanup', '--task', id]).action, 'switched');
  assert.equal(gitIn(tree, fx.env)('branch', '--show-current'), 'main');
  assert.equal(ok(fx.root, ['task', 'end', '--task', id, '--outcome', 'done']).prUrl, 'https://github.com/acme/app/pull/1');
  assert.deepEqual(ok(fx.root, ['task', 'list']).tasks, []);
  const state = readJson(join(fx.root, '.git', 'dev-workflow', 'state.json'));
  assert.deepEqual([state.tasks[0].outcome, state.tasks[0].prUrl], ['done', 'https://github.com/acme/app/pull/1']);
  assert.deepEqual([fx.root, fx.app].map((repo) => readFileSync(join(repo, '.git', 'config'), 'utf8')), configBefore, 'cw never rewrote .git/config');
});

test('lifecycle in worktree mode with a GitLab origin, a rebind to a new session and the worktree removed', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig({ packages: PACKAGES }) });
  hostOrigin(fx.root, fx.env, 'git@gitlab.example.com:group/app.git', fx.remote);
  stubCli(stubDir(fx.base), 'glab', NO_PR);
  const { ok } = harness(fx);
  let agentTree = null;

  const { id, started, command } = lifecycle(fx, {
    orchestratorCwd: join(fx.root, 'src'),
    implementerCwd: () => {
      agentTree = addAgentWorktree(fx.root, fx.env, 'impl1');
      return agentTree;
    },
    reviewerCwd: join(fx.root, '.claude'),
    tree: (cwd) => cwd,
    onReport: ({ id: taskId }) => {
      // /clear in the orchestrator session: the new session takes the task over (D3).
      const env = { ...fx.env, CLAUDE_CODE_SESSION_ID: 'session-2' };
      const rebound = cw(fx.root, ['task', 'new', '--rebind', taskId, '--json'], { env });
      assert.equal(rebound.code, 0, rebound.stderr);
      assert.deepEqual([rebound.json().resumeAt, rebound.json().ownerSession], ['O7', 'session-2']);
    },
  });
  assert.equal(started.agentCall.isolation, 'worktree');
  assert.equal(command.host.kind, 'gitlab');
  assert.ok(command.commands.some((line) => line.startsWith('glab mr create')));
  ok(fx.root, ['pr', 'record', '--task', id, '--skipped', 'the user pushes later']);
  const cleanup = ok(fx.root, ['task', 'cleanup', '--task', id]);
  assert.deepEqual([cleanup.action, cleanup.removedBranch], ['removed', 'worktree-agent-impl1']);
  assert.equal(existsSync(agentTree), false);
  assert.equal(ok(fx.root, ['task', 'end', '--task', id, '--outcome', 'done']).outcome, 'done');
});
