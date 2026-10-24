// The implementer commands as processes in both workspace modes: ws setup, context, checks, commit msg,
// commit lint, step and report save, run from different cwds (D5: the work tree comes from task.json).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { readJson } from '../../cli/lib/fsx.mjs';
import { createTask, newTask, readTask, recordAgentStart, updateTask } from '../../cli/lib/task.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, cw, gitIn, inPlaceConfig, makeInPlace, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const SPEC = '## Task: Mul helper\n\n### Acceptance criteria\n- [ ] AC1 mul multiplies two numbers\n';
const MUL = {
  'src/mul.mjs': 'export const mul = (a, b) => a * b;\n',
  'src/mul.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { mul } from './mul.mjs';\n\ntest('multiplies', () => assert.equal(mul(2, 3), 6));\n",
};
const REPORT = { status: 'done', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'src/mul.test.mjs › multiplies' }], handover: { decisions: [], rejected: [], testing: ['cw checks --changed'], pitfalls: [], deviations: [] } };

// A task in phase implement with its base recorded, as cw task start (orchestrator area) leaves it.
function startTask(fx, { type = 'feature', slug = 'mul-helper' } = {}) {
  const ws = loadWorkspace({ cwd: fx.root });
  const branch = `NO-TICKET/${type}/${slug}`;
  const { id } = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Mul helper', type, slug, branch, ownerSession: 'test-session' }));
  const commit = gitIn(ws.mode === 'in-place' ? fx.app : fx.root, fx.env)('rev-parse', 'HEAD');
  updateTask(ws, id, (task) => {
    task.phase = 'implement';
    task.round = 1;
    task.packages = ['app'];
    task.base = { branch: 'main', commit };
  });
  writeFileSync(taskPath(ws, id, 'spec.md'), SPEC);
  return { ws, id, branch };
}

const configBytes = (...repos) => repos.map((repo) => readFileSync(join(repo, '.git', 'config')));

// Runs a command line cw printed the way the Bash tool does, from cwd (the project root in-place).
function sh(cwd, command, env) {
  const result = spawnSync('sh', ['-c', command], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout;
}

test('in-place: from ws setup to a saved report, with cw run from the outer repo, app/ and other dirs', (t) => {
  const fx = makeInPlace(t);
  const { ws, id, branch } = startTask(fx);
  const run = (cwd, args, options) => cw(cwd, [...args, '--task', id], { env: fx.env, ...options });
  const before = configBytes(fx.root, fx.app);
  const app = gitIn(fx.app, fx.env);

  const setup = run(fx.root, ['ws', 'setup', '--json']);
  assert.equal(setup.code, 0, setup.stderr);
  assert.equal(setup.json().workTree, realpathSync(fx.app));
  assert.equal(app('branch', '--show-current'), branch);
  assert.equal(gitIn(fx.root, fx.env)('branch', '--show-current'), 'main');

  // In-place git commands are git -C <appRoot>, relative to the project root (owner decision 2026-10-20).
  const context = run(join(fx.app, 'src'), ['context', '--json']);
  assert.equal(context.code, 0, context.stderr);
  assert.equal(context.json().git, 'git -C app');
  assert.equal(context.json().projectRoot, realpathSync(fx.root));
  assert.deepEqual(context.json().packages.map((p) => p.id), ['app']);
  // The note claims nothing about other git forms: inside app/ plain git reaches the work tree too.
  assert.equal(
    context.json().cwdNote,
    `the cwd ${realpathSync(join(fx.app, 'src'))} is not the project root ${realpathSync(fx.root)}, and the git -C app … commands are relative to the project root, so from this cwd they name another directory. Use git -C ${realpathSync(fx.app)} … instead (it may ask for permission).`,
  );
  const atRoot = run(fx.root, ['context', '--json']).json();
  assert.equal(atRoot.cwdNote, null, 'no note at the project root');
  // With -C app, git reads paths from app/: the placeholder says so.
  assert.deepEqual(atRoot.next.filter((line) => line.startsWith('git')), ['git -C app add <files relative to app/, or absolute>', `git -C app commit -F ${taskPath(ws, id, 'commit-msg.txt')}`]);
  const human = run(join(fx.app, 'src'), ['context']).stdout;
  assert.ok(human.includes(`\nGit: git -C app … exactly in this form, from the project root ${realpathSync(fx.root)} (the Bash cwd stays there; never cd); file paths in it are relative to the work tree, as listed under Changed so far, or absolute\nNote: the cwd `), human);
  assert.doesNotMatch(run(fx.root, ['context']).stdout, /\nNote: /);

  write(fx.app, MUL);
  mkdirSync(join(fx.root, 'docs'));
  const results = [fx.root, fx.app, join(fx.app, 'src'), join(fx.root, 'docs')].map((cwd) => run(cwd, ['checks', '--changed', '--json']));
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  const picked = results.map((result) => JSON.stringify([result.json().changedFiles, result.json().packages.map((p) => p.id), result.json().workTree]));
  assert.equal(new Set(picked).size, 1, 'every cwd checks the same work tree');
  assert.deepEqual(results[0].json().changedFiles, ['src/mul.mjs', 'src/mul.test.mjs']);
  assert.equal(results[0].json().overall, 'pass');
  assert.equal(readTask(ws, id).steps.done, 5);

  const early = run(fx.root, ['report', 'save'], { input: JSON.stringify(REPORT) });
  assert.equal(early.code, 1);
  assert.match(early.stderr, /no commits on NO-TICKET\/feature\/mul-helper since the base/);

  const refused = run(fx.root, ['commit', 'msg', '--summary', 'Add the mul helper', '--keyword', 'feature', '--out', join(fx.app, 'msg.txt')]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /inside the work tree/);
  const message = run(fx.app, ['commit', 'msg', '--summary', 'Add the mul helper', '--keyword', 'feature', '--json']);
  assert.equal(message.code, 0, message.stderr);
  const { file, next } = message.json();
  assert.equal(file, taskPath(ws, id, 'commit-msg.txt'));
  assert.equal(readFileSync(file, 'utf8'), '[FEATURE] Add the mul helper\n');
  assert.equal(next, `git -C app commit -F ${file}`);
  // A body from stdin and trailers as flags: the implementer writes no file under .git itself.
  const piped = run(fx.app, ['commit', 'msg', '--summary', 'Add the mul helper', '--keyword', 'feature', '--body-file', '-', '--trailer', 'Co-Authored-By: Claude <noreply@anthropic.com>', '--json'], { input: 'Multiplication for the invoice totals.\n' });
  assert.equal(piped.code, 0, piped.stderr);
  assert.equal(readFileSync(file, 'utf8'), '[FEATURE] Add the mul helper\n\nMultiplication for the invoice totals.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
  assert.equal(run(fx.app, ['commit', 'msg', '--summary', 'Add the mul helper', '--keyword', 'feature', '--trailer', 'not a trailer']).code, 2);
  run(fx.app, ['commit', 'msg', '--summary', 'Add the mul helper', '--keyword', 'feature']);
  // The printed forms run from the project root, where the Bash cwd stays.
  sh(fx.root, 'git -C app add -A', fx.env);
  sh(fx.root, next, fx.env);
  assert.equal(app('log', '-1', '--format=%s'), '[FEATURE] Add the mul helper');

  const lint = run(fx.root, ['commit', 'lint', '--json']);
  assert.equal(lint.code, 0, lint.stdout);
  assert.equal(lint.json().commits.length, 1);
  assert.equal(readTask(ws, id).steps.done, 6);

  // SubagentStart records the agent before the report is saved (§9).
  const startedAt = new Date().toISOString();
  recordAgentStart(ws, id, { role: 'implementer', agentId: 'a1', agentType: 'dev-workflow:implementer-s', at: startedAt });
  const saved = run(join(fx.app, 'src'), ['report', 'save'], { input: `My report:\n\`\`\`json\n${JSON.stringify(REPORT)}\n\`\`\`\n` });
  assert.equal(saved.code, 0, saved.stderr);
  assert.match(saved.stdout, /^```json\n/);
  const report = readJson(taskPath(ws, id, 'report-1.json'));
  assert.ok(report.savedAt > startedAt);
  assert.equal(report.checks.current, true);
  assert.equal(report.checks.overall, 'pass');
  assert.deepEqual(report.changedFiles, ['src/mul.mjs', 'src/mul.test.mjs']);
  assert.equal(report.commits[0].subject, '[FEATURE] Add the mul helper');
  assert.equal(report.head, app('rev-parse', 'HEAD'));
  assert.deepEqual(report.warnings, ['the new test src/mul.test.mjs has no holding proof (cw prove)']);
  assert.equal(readTask(ws, id).steps.done, 8);
  assert.deepEqual(configBytes(fx.root, fx.app), before, '.git/config of both repos is unchanged');
});

test('in-place with an appRoot that needs quoting: cw quotes it, and the printed commands run from the project root', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ workspace: { mode: 'in-place', appRoot: 'my app' } }) });
  const moved = { ...fx, app: join(fx.root, 'my app') };
  renameSync(fx.app, moved.app);
  const { ws, id } = startTask(moved);
  const run = (args) => cw(fx.root, [...args, '--task', id], { env: fx.env });
  assert.equal(run(['ws', 'setup']).code, 0);
  const context = run(['context', '--json']).json();
  assert.equal(context.git, "git -C 'my app'");
  assert.equal(context.cwdNote, null);
  assert.ok(context.next.includes("git -C 'my app' add <files relative to my app/, or absolute>"));
  write(moved.app, MUL);
  sh(fx.root, "git -C 'my app' add -A", fx.env);
  const { next } = run(['commit', 'msg', '--summary', 'Add the mul helper', '--keyword', 'feature', '--json']).json();
  assert.equal(next, `git -C 'my app' commit -F ${taskPath(ws, id, 'commit-msg.txt')}`);
  sh(fx.root, next, fx.env);
  const lint = run(['commit', 'lint', '--json']);
  assert.equal(lint.code, 0, lint.stdout);
  assert.equal(lint.json().commits.length, 1);
});

test('report save refuses stale checks, failing checks and lint errors; a wrong phase is exit 3', (t) => {
  const fx = makeInPlace(t);
  const { ws, id } = startTask(fx, { type: 'bugfix', slug: 'fix-mul' });
  const run = (args, options) => cw(fx.root, [...args, '--task', id], { env: fx.env, ...options });
  const app = gitIn(fx.app, fx.env);
  assert.equal(run(['ws', 'setup']).code, 0);
  write(fx.app, MUL);
  app('add', '-A');
  app('commit', '-q', '-m', 'add mul');
  const save = () => run(['report', 'save'], { input: JSON.stringify(REPORT) });

  let result = save();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no checks result: run cw checks --changed/);
  assert.match(result.stderr, /git conventions \(\d+ errors\): run cw commit lint/);
  assert.match(result.stderr, /a bug fix needs the regression test's failing run/);
  assert.match(result.stderr, /Fix: Fix each point/);
  assert.equal(existsSync(taskPath(ws, id, 'report-1.json')), false, 'nothing was written');

  assert.equal(run(['checks', '--changed']).code, 0);
  write(fx.app, { 'src/mul.mjs': 'export const mul = (a, b) => a * b; // edited\n' });
  result = save();
  assert.match(result.stderr, /checks ran on an older state \(tree \w{10}, now \w{10}\)/);

  write(fx.app, { 'src/mul.mjs': 'export const mul = () => 0;\n' });
  app('commit', '-qam', '[BUGFIX] Break mul');
  const failing = run(['checks', '--changed']);
  assert.equal(failing.code, 1);
  assert.match(failing.stdout, /app:test fail \(log: .+app-test\.log\)/);
  assert.match(failing.stdout, /Fix: fix the failures/);
  const failingJson = run(['checks', '--changed', '--json']);
  assert.equal(failingJson.code, 1);
  assert.equal(failingJson.json().fix, 'fix the failures (never loosen a check), then run cw checks --changed again.', 'a failing JSON result names its fix');
  assert.match(save().stderr, /checks are fail/);

  const blocked = run(['report', 'save'], { input: JSON.stringify({ status: 'blocked', acceptanceCriteria: [], blocked: { question: 'Which rounding?', needed: 'a decision' }, handover: { decisions: [], rejected: [], testing: [], pitfalls: [], deviations: [] } }) });
  assert.equal(blocked.code, 0, blocked.stderr);
  assert.equal(readJson(taskPath(ws, id, 'report-1.json')).status, 'blocked');

  updateTask(ws, id, (task) => {
    task.phase = 'review';
  });
  const late = save();
  assert.equal(late.code, 3);
  assert.match(late.stderr, /needs phase implement; task .+ is in review/);
  assert.equal(run(['report', 'save'], { input: '' }).code, 2);
});

test('commit lint: a PR/MR title over the limit names the first commit and a rebuilt branch, not an amend of the last', (t) => {
  // The title finding sits on the first commit, which git commit --amend cannot reach (R2-A5).
  const fx = makeInPlace(t);
  const { ws, id } = startTask(fx);
  const run = (args) => cw(fx.root, [...args, '--task', id], { env: fx.env });
  const app = gitIn(fx.app, fx.env);
  assert.equal(run(['ws', 'setup']).code, 0);
  const commit = (file, message) => {
    write(fx.app, { [file]: `${file}\n` });
    app('add', '-A');
    app('commit', '-q', '-m', message);
  };
  commit('a.txt', '[FEATURE] Add the multiplication helper to the math utilities mod');
  commit('b.txt', '[SECURITY][BUGFIX] Escape the input');
  const first = app('rev-parse', 'HEAD~1').slice(0, 10);
  const titleFix = `Shorten the summary of the first commit ${first}, which the PR/MR title is built from: interactive rebase is not available to agents, so rebuild the branch with git -C app reset --soft ${readTask(ws, id).base.commit} and new commits (cw commit msg, then git -C app commit -F <file>), or ask the orchestrator`;
  const lint = run(['commit', 'lint', '--json']);
  assert.equal(lint.code, 1, lint.stdout);
  assert.equal(lint.json().fix, `${titleFix}; then run cw commit lint again.`);
  assert.ok(run(['commit', 'lint']).stdout.endsWith(`\nFix: ${titleFix}; then run cw commit lint again.\n`));
  assert.equal(run(['commit', 'lint', '--last', '--json']).json().fix, `${titleFix}; then run cw commit lint again.`, '--last reports the title too');

  commit('c.txt', 'wip c');
  const both = run(['commit', 'lint', '--json']).json();
  assert.equal(both.fix, `Reword the commits: git -C app commit --amend -F <file> for the last one, otherwise rebuild the branch. ${titleFix}; then run cw commit lint again.`);
});

test('report save counts the proofs that held and still run at HEAD; a proof of a renamed test is stale', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ packages: [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' }, testSingle: 'node --test {file}' }] }) });
  const { ws, id } = startTask(fx, { type: 'bugfix', slug: 'fix-mul' });
  const run = (args, options) => cw(fx.root, [...args, '--task', id], { env: fx.env, ...options });
  const app = gitIn(fx.app, fx.env);
  assert.equal(run(['ws', 'setup']).code, 0);
  write(fx.app, MUL);
  app('add', '-A');
  app('commit', '-q', '-m', '[BUGFIX] Add mul');
  assert.equal(run(['prove', '--test', 'app:src/mul.test.mjs', '--change', 'src/mul.mjs']).code, 0);
  app('mv', 'src/mul.test.mjs', 'src/multiply.test.mjs');
  app('commit', '-q', '-m', '[BUGFIX] Rename the mul test');
  assert.equal(run(['checks', '--changed']).code, 0);
  const save = () => run(['report', 'save', '--json'], { input: JSON.stringify(REPORT) });
  const refused = save();
  assert.equal(refused.code, 1);
  assert.match(refused.json().details.errors.join('\n'), /a bug fix needs the regression test's failing run/);

  assert.equal(run(['prove', '--test', 'app:src/multiply.test.mjs', '--change', 'src/mul.mjs']).code, 0);
  const saved = save();
  assert.equal(saved.code, 0, saved.stderr);
  const report = saved.json();
  assert.deepEqual(report.proofs.map((proof) => proof.id), ['P2']);
  assert.deepEqual(report.staleProofs, [{ id: 'P1', test: 'app:src/mul.test.mjs', reason: 'the test file src/mul.test.mjs no longer exists at HEAD' }]);
  assert.match(saved.stderr, /warning: P1 \(app:src\/mul\.test\.mjs\) is stale and not counted: the test file src\/mul\.test\.mjs no longer exists at HEAD/);
  assert.equal(readJson(taskPath(ws, id, 'report-1.json')).staleProofs.length, 1);
});

test('worktree mode: report save refuses a node_modules link the commits add', (t) => {
  // "node_modules/" matches directories only, so git add -A stages the link Claude Code puts into the
  // agent worktree (worktree.symlinkDirectories, S4).
  const fx = makeWorktreeRepo(t, { config: worktreeConfig(), files: { '.gitignore': 'node_modules/\n.claude/worktrees/\n' } });
  const { id } = startTask(fx);
  const wt = addAgentWorktree(fx.root, fx.env, 'nm');
  const run = (args, options) => cw(wt, [...args, '--task', id], { env: fx.env, ...options });
  assert.equal(run(['ws', 'setup']).code, 0);
  mkdirSync(join(fx.base, 'shared-modules'));
  symlinkSync(join(fx.base, 'shared-modules'), join(wt, 'node_modules'));
  write(wt, MUL);
  const git = gitIn(wt, fx.env);
  git('add', '-A');
  git('commit', '-q', '-m', '[FEATURE] Add mul');
  assert.equal(run(['checks', '--changed']).code, 0);
  const result = run(['report', 'save'], { input: JSON.stringify(REPORT) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /the commits add node_modules \(node_modules is never committed; .+\): git rm --cached node_modules, commit \(step 6\), then save the report again/);
});

test('checks: only unowned files is exit 1 naming the config; an unknown package is exit 2', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ packages: [{ id: 'app', path: 'src', areas: ['backend'], checks: { test: 'node --test' } }] }) });
  const { ws, id } = startTask(fx);
  assert.equal(cw(fx.root, ['ws', 'setup', '--task', id], { env: fx.env }).code, 0);
  write(fx.app, { 'README.md': '# readme\n' });
  const result = cw(fx.app, ['checks', '--changed', '--task', id], { env: fx.env });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /1 changed files belong to no package: README\.md/);
  assert.ok(result.stderr.includes(`Fix: Add a package whose path covers them in ${ws.configPath}`));
  const unknown = cw(fx.root, ['checks', '--package', 'web', '--task', id], { env: fx.env });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown package web\nFix: Use one of app/);
  const all = cw(fx.root, ['checks', '--json'], { env: fx.env });
  assert.equal(all.code, 0, all.stderr);
  assert.equal(all.json().selection, 'all');
});

test('step: 1-8 only, monotonic, the note follows the last call', (t) => {
  const fx = makeInPlace(t);
  const { ws, id } = startTask(fx);
  const step = (...args) => cw(fx.root, ['step', '--task', id, ...args], { env: fx.env });
  assert.equal(step('--done', '0').code, 2);
  assert.equal(step('--done', '9').code, 2);
  assert.equal(step('--done', '5', '--note', 'checks').code, 0);
  const again = step('--done', '3', '--note', 'tests');
  assert.equal(again.stdout, 'step 5/8\n');
  assert.deepEqual(readTask(ws, id).steps, { done: 5, total: 8, note: 'tests' });
});

test('worktree mode: ws setup only in the agent worktree; checks and context follow task.json from the main checkout', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig() });
  const { ws, id, branch } = startTask(fx);
  const before = configBytes(fx.root);
  const fromMain = cw(fx.root, ['ws', 'setup', '--task', id], { env: fx.env });
  assert.equal(fromMain.code, 3);
  assert.match(fromMain.stderr, /is the main checkout\.\nFix: Report blocked; the orchestrator delegates with isolation "worktree"/);

  const wt = addAgentWorktree(fx.root, fx.env, 'abc');
  const setup = cw(join(wt, 'src'), ['ws', 'setup', '--task', id, '--json'], { env: fx.env });
  assert.equal(setup.code, 0, setup.stderr);
  assert.equal(setup.json().agentBranch, 'worktree-agent-abc');
  assert.equal(gitIn(wt, fx.env)('branch', '--show-current'), branch);

  write(wt, MUL);
  const checks = cw(fx.root, ['checks', '--changed', '--task', id, '--json'], { env: fx.env });
  assert.equal(checks.code, 0, checks.stderr);
  assert.equal(checks.json().workTree, realpathSync(wt));
  assert.deepEqual(checks.json().changedFiles, ['src/mul.mjs', 'src/mul.test.mjs']);
  const context = cw(fx.root, ['context', '--task', id, '--json'], { env: fx.env });
  assert.equal(context.json().git, 'git');
  assert.equal(context.json().cwdNote, null, 'worktree mode is unchanged: plain git inside the worktree');
  assert.deepEqual(context.json().next.filter((line) => line.startsWith('git')), ['git add <files>', `git commit -F ${taskPath(ws, id, 'commit-msg.txt')}`]);
  assert.equal(readTask(ws, id).workTree, realpathSync(wt));
  assert.deepEqual(configBytes(fx.root), before);
});
