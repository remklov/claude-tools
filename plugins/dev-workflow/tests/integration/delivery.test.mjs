// Delivery end to end through the cw binary: foreign commits, the review -> deliver step, PR/MR title,
// body and commands for gh and glab (stubbed), the recorded URL and the cleanup, in-place and worktree.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readJson, writeJson } from '../../cli/lib/fsx.mjs';
import { createTask, newTask, readTask, updateTask } from '../../cli/lib/task.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, cw, gitIn, makeInPlace, makeWorktreeRepo, worktreeConfig, write } from '../fixtures/repo.mjs';
import { minimalPath, stubCli, stubDir } from '../fixtures/stubs.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const GITHUB_URL = 'git@github.com:acme/app.git';
const GITLAB_URL = 'git@gitlab.example.com:group/sub/app.git';
const NO_PR = [{ args: ['pr', 'view'], stderr: 'no pull requests found for branch "x"\n', exit: 1 }];

// Points origin at a hosted URL while pushes still land in the fixture's bare repo.
function hostOrigin(repo, env, url, bare) {
  const git = gitIn(repo, env);
  git('remote', 'set-url', 'origin', url);
  git('config', 'remote.origin.pushurl', bare);
}

const writeRound = (ws, id, kind, round, data) => writeJson(taskPath(ws, id, `${kind}-${round}.json`), { kind, version: 1, task: id, round, ...data });

// A task whose round-1 review approved the branch tip: the state the orchestrator reaches before O9.
function reviewedTask(ws, git, { ticket = 'NO-TICKET', review = {}, beforeCommit } = {}) {
  const branch = `${ticket}/feature/mul-helper`;
  const base = git('rev-parse', 'HEAD');
  const task = createTask(ws, newTask(ws, { ticket, title: 'Add the mul helper', type: 'feature', slug: 'mul-helper', branch, ownerSession: 'test-session' }));
  git('switch', '-q', '-c', branch);
  beforeCommit?.();
  write(git('rev-parse', '--show-toplevel'), { 'src/mul.mjs': 'export const mul = (a, b) => a * b;\n' });
  git('add', '-A');
  git('commit', '-q', '-m', '[FEATURE] Add the mul helper');
  const tip = git('rev-parse', 'HEAD');
  updateTask(ws, task.id, (x) => {
    x.phase = 'review';
    x.round = 1;
    x.reviewRound = 1;
    x.base = { branch: 'main', commit: base };
  });
  writeRound(ws, task.id, 'report', 1, { status: 'done', risks: [], openPoints: [], proofs: [] });
  writeRound(ws, task.id, 'review', 1, { status: 'approved', head: tip, findings: [], ...review });
  return { id: task.id, branch, base, tip };
}

function inPlace(t, options = {}) {
  const fx = makeInPlace(t);
  if (options.origin !== null) hostOrigin(fx.app, fx.env, options.origin ?? GITHUB_URL, fx.remote);
  const ws = loadWorkspace({ cwd: fx.root });
  const git = gitIn(fx.app, fx.env);
  return { fx, ws, git, app: realpathSync(fx.app), ...reviewedTask(ws, git, options) };
}

const run = (fx, args, options = {}) => cw(fx.root, args, { env: fx.env, ...options });
const configBytes = (repo) => readFileSync(join(repo, '.git', 'config'));
const bareHas = (bare, branch, env) => spawnSync('git', ['--git-dir', bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { env, encoding: 'utf8' }).stdout.trim();

test('in-place with gh: the first pr command enters deliver, prints push + create, and cw itself pushes nothing', (t) => {
  const s = inPlace(t);
  const gh = stubCli(stubDir(s.fx.base), 'gh', NO_PR);
  const appConfig = configBytes(s.fx.app);
  const outerConfig = configBytes(s.fx.root);

  const result = run(s.fx, ['pr', 'command', '--task', s.id, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const out = result.json();
  const bodyFile = join(s.ws.stateDir, 'tasks', s.id, 'pr-body.md');
  // In-place the push is git -C <appRoot> from the project root, like every in-place git command (§12).
  assert.deepEqual(out.commands, [
    'git -C app push origin NO-TICKET/feature/mul-helper',
    `gh pr create --repo github.com/acme/app -B main -H NO-TICKET/feature/mul-helper -t '[FEATURE] Add the mul helper' -F ${bodyFile}`,
  ]);
  assert.equal(out.record, `cw pr record --task ${s.id} --url <url>`);
  assert.deepEqual([out.host.kind, out.host.source, out.existing, out.baseUnpushed], ['github', 'origin', null, []]);
  assert.ok(existsSync(bodyFile));
  assert.ok(!out.commands.some((command) => / -u\b|--set-upstream/.test(command)));
  assert.deepEqual(gh.calls(), [['pr', 'view', 'NO-TICKET/feature/mul-helper', '--repo', 'github.com/acme/app', '--json', 'url,state']]);
  assert.equal(bareHas(s.fx.remote, s.branch, s.fx.env), '', 'cw never pushes');

  const task = readTask(s.ws, s.id);
  assert.equal(task.phase, 'deliver');
  assert.equal(task.history.at(-1).by, 'cw pr command');
  assert.equal(readJson(join(s.ws.stateDir, 'state.json')).tasks[0].phase, 'deliver');

  // The orchestrator runs the printed push from the project root (its Bash cwd); it lands in the bare
  // repo and leaves .git/config alone.
  const push = spawnSync('sh', ['-c', out.commands[0]], { cwd: s.fx.root, env: s.fx.env, encoding: 'utf8' });
  assert.equal(push.status, 0, push.stderr);
  assert.equal(bareHas(s.fx.remote, s.branch, s.fx.env), s.tip);

  assert.equal(run(s.fx, ['pr', 'record', '--task', s.id, '--url', 'http://github.com/acme/app/pull/1']).code, 2);
  assert.equal(run(s.fx, ['pr', 'record', '--task', s.id]).code, 2);
  const recorded = run(s.fx, ['pr', 'record', '--task', s.id, '--url', 'https://github.com/acme/app/pull/1', '--json']);
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.deepEqual(recorded.json(), { task: s.id, phase: 'deliver', prUrl: 'https://github.com/acme/app/pull/1', noPrReason: null });
  assert.equal(readJson(join(s.ws.stateDir, 'state.json')).tasks[0].prUrl, 'https://github.com/acme/app/pull/1');
  const other = run(s.fx, ['pr', 'record', '--task', s.id, '--url', 'https://gitlab.example.com/x/-/merge_requests/1']);
  assert.equal(other.code, 0);
  assert.match(other.stderr, /is on gitlab\.example\.com, but the work repo's origin is on github\.com/);

  const cleanup = run(s.fx, ['task', 'cleanup', '--task', s.id, '--json']);
  assert.equal(cleanup.code, 0, cleanup.stderr);
  assert.deepEqual([cleanup.json().action, cleanup.json().branchKept], ['switched', s.branch]);
  assert.equal(s.git('branch', '--show-current'), 'main');
  assert.equal(run(s.fx, ['task', 'cleanup', '--task', s.id, '--json']).json().action, 'already-on-base');
  assert.deepEqual(configBytes(s.fx.app), appConfig);
  assert.deepEqual(configBytes(s.fx.root), outerConfig);
});

test('an open PR means push only and its URL; a merged one is exit 3', (t) => {
  const s = inPlace(t);
  stubCli(stubDir(s.fx.base), 'gh', [{ args: ['pr', 'view'], stdout: { url: 'https://github.com/acme/app/pull/7', state: 'OPEN' } }]);
  const out = run(s.fx, ['pr', 'command', '--task', s.id, '--json']).json();
  assert.deepEqual(out.commands, [`git -C app push origin ${s.branch}`]);
  assert.equal(out.record, `cw pr record --task ${s.id} --url https://github.com/acme/app/pull/7`);
  assert.ok(out.notes.some((note) => /Push only/.test(note)));
  const human = run(s.fx, ['pr', 'command', '--task', s.id]);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /^Host: github \(github\.com\/acme\/app, gh; from origin\)\nCommands, after the user confirmed:\n {2}git -C app push origin NO-TICKET\/feature\/mul-helper\nThen: cw pr record --task \S+ --url https:\/\/github\.com\/acme\/app\/pull\/7\n/);

  stubCli(stubDir(s.fx.base), 'gh', [{ args: ['pr', 'view'], stdout: { url: 'https://github.com/acme/app/pull/6', state: 'MERGED' } }]);
  const merged = run(s.fx, ['pr', 'command', '--task', s.id]);
  assert.equal(merged.code, 3);
  assert.match(merged.stderr, /pull request for NO-TICKET\/feature\/mul-helper is merged: https:\/\/github\.com\/acme\/app\/pull\/6\nFix: Ask the user/);
});

test('gh missing or logged out is exit 3 with the install or login command', (t) => {
  const s = inPlace(t);
  const missing = run(s.fx, ['pr', 'command', '--task', s.id], { env: { ...s.fx.env, PATH: minimalPath(s.fx.base) } });
  assert.equal(missing.code, 3);
  assert.match(missing.stderr, /gh is not installed\.\nFix: brew install gh, then gh auth login --hostname github\.com/);

  stubCli(stubDir(s.fx.base), 'gh', [{ args: ['pr', 'view'], stderr: 'auth required', exit: 4 }]);
  const auth = run(s.fx, ['pr', 'command', '--task', s.id]);
  assert.equal(auth.code, 3);
  assert.match(auth.stderr, /Fix: Run gh auth login --hostname github\.com in your own terminal/);
});

test('pr commands need the approved review at the branch tip and a clean work tree', (t) => {
  const s = inPlace(t);
  stubCli(stubDir(s.fx.base), 'gh', NO_PR);
  write(s.app, { 'src/extra.mjs': 'export const x = 1;\n' });
  const dirty = run(s.fx, ['pr', 'title', '--task', s.id]);
  assert.equal(dirty.code, 0, 'title and body do not need a clean tree');
  const command = run(s.fx, ['pr', 'command', '--task', s.id]);
  assert.equal(command.code, 3);
  assert.match(command.stderr, /uncommitted changes \(src\/extra\.mjs\)/);

  s.git('add', '-A');
  s.git('commit', '-q', '-m', '[TASK] Sneak in a change');
  const moved = run(s.fx, ['pr', 'command', '--task', s.id]);
  assert.equal(moved.code, 3);
  assert.match(moved.stderr, new RegExp(`reviewed ${s.tip.slice(0, 10)}, now ${s.git('rev-parse', 'HEAD').slice(0, 10)}`));
  assert.match(moved.stderr, new RegExp(`Fix: Have the new commits reviewed: cw task review --task ${s.id} \\(a new review round over the commits since ${s.tip.slice(0, 10)}\\)\\.\\n$`));

  writeRound(s.ws, s.id, 'review', 1, { status: 'changes_requested', head: s.git('rev-parse', 'HEAD'), findings: [] });
  updateTask(s.ws, s.id, (x) => {
    x.phase = 'review';
  });
  const rejected = run(s.fx, ['pr', 'body', '--task', s.id]);
  assert.equal(rejected.code, 3);
  assert.match(rejected.stderr, /is changes_requested, not approved\.\nFix: Send the findings back: cw task return/);

  updateTask(s.ws, s.id, (x) => {
    x.phase = 'implement';
  });
  assert.match(run(s.fx, ['pr', 'record', '--task', s.id, '--skipped', 'x']).stderr, /is in implement; delivery needs an approved review/);
  assert.equal(run(s.fx, ['task', 'cleanup', '--task', s.id]).code, 3, 'no cleanup while an agent works');
});

test('unpushed base commits are reported; the title carries later flags', (t) => {
  const fx = makeInPlace(t);
  hostOrigin(fx.app, fx.env, GITHUB_URL, fx.remote);
  const ws = loadWorkspace({ cwd: fx.root });
  const git = gitIn(fx.app, fx.env);
  write(fx.app, { 'NOTES.md': 'local only\n' });
  git('add', '-A');
  git('commit', '-q', '-m', '[DOCS] Add notes');
  const s = reviewedTask(ws, git);
  stubCli(stubDir(fx.base), 'gh', NO_PR);
  const out = cw(fx.root, ['pr', 'command', '--task', s.id, '--json'], { env: fx.env }).json();
  assert.deepEqual(out.baseUnpushed.map((commit) => commit.subject), ['[DOCS] Add notes']);
  assert.ok(out.notes.some((note) => /lacks .*ask the user before pushing anything/.test(note)));

  write(fx.app, { 'src/mul.mjs': 'export const mul = (a, b) => Number(a) * Number(b);\n' });
  git('commit', '-q', '-am', '[SECURITY][TASK] Coerce the input');
  writeRound(ws, s.id, 'review', 1, { status: 'approved', head: git('rev-parse', 'HEAD'), findings: [] });
  const title = cw(fx.app, ['pr', 'title', '--task', s.id], { env: fx.env });
  assert.equal(title.stdout, '[SECURITY][FEATURE] Add the mul helper\n');
});

test('pr body reads the task files; --stdin replaces it', (t) => {
  const s = inPlace(t, { ticket: 'ABC-123', review: { findings: [{ severity: 'non_blocking', rule: 'CORE-NAMING', file: 'src/mul.mjs', line: 1, issue: 'Name a and b', sendAlong: true }] } });
  const file = (name) => taskPath(s.ws, s.id, name);
  writeJson(file('ticket.json'), { version: 1, key: 'ABC-123', summary: 'Invoices need multiplication', url: 'https://example.atlassian.net/browse/ABC-123' });
  write(join(s.ws.stateDir, 'tasks', s.id), { 'spec.md': '### Context\nInvoices multiply.\n\n### Requirements\n- R1 Multiply\n' });
  writeJson(file('checks-1.json'), { kind: 'checks', overall: 'pass', packages: [{ id: 'app', path: '.', checks: [{ command: 'node --test', result: 'pass' }] }] });
  writeRound(s.ws, s.id, 'report', 1, { status: 'done', risks: [], openPoints: [{ text: 'Try it in the UI', tag: 'manual' }], proofs: [], checks: { file: 'checks-1.json', overall: 'pass' } });

  const result = cw(s.fx.app, ['pr', 'body', '--task', s.id, '--json'], { env: s.fx.env });
  assert.equal(result.code, 0, result.stderr);
  const { body, file: written } = result.json();
  assert.equal(written, file('pr-body.md'));
  assert.match(body, /^## What & why\n\n\[ABC-123\]\(https:\/\/example\.atlassian\.net\/browse\/ABC-123\): Invoices need multiplication\n\nInvoices multiply\.\n\n- Multiply\n\n## Testing\n\n- `node --test` in `\.` \(app\): pass\n\n## Open points\n\n- Manual check \(not verified here\): Try it in the UI\n- CORE-NAMING: Name a and b \(`src\/mul\.mjs:1`\)\n\nRelates to ABC-123\n$/);

  // A corrected body keeps the §10 rules: the trailer is appended when it is missing, and only preset
  // sections are accepted.
  const unknown = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: '## Summary\n\nEdited.\n' });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /sections the git preset does not know: "## Summary"\.\nFix: Use only "## What & why", "## Testing", "## Risks & deploy steps", "## Open points"/);
  const replaced = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: '## What & why\n\nEdited.\n\nCo-Authored-By: X <x@example.invalid>\n' });
  assert.equal(replaced.code, 0, replaced.stderr);
  const corrected = '## What & why\n\nEdited.\n\nCo-Authored-By: X <x@example.invalid>\n\nRelates to ABC-123\n';
  assert.equal(readFileSync(file('pr-body.md'), 'utf8'), corrected);
  const again = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: corrected });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(readFileSync(file('pr-body.md'), 'utf8'), corrected, 'a body that ends with the trailer stays as it is');
  stubCli(stubDir(s.fx.base), 'gh', NO_PR);
  const command = cw(s.fx.root, ['pr', 'command', '--task', s.id, '--json'], { env: s.fx.env }).json();
  assert.ok(command.commands[1].endsWith(`-F ${file('pr-body.md')}`));
  assert.equal(readFileSync(file('pr-body.md'), 'utf8'), corrected, 'pr command keeps a corrected body');

  // A "## " line inside a fenced code block is no section; after the fence the sections count again.
  const fenced = '## What & why\n\nText.\n\n```md\n## Not a section\n```\n';
  const inFence = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: fenced });
  assert.equal(inFence.code, 0, inFence.stderr);
  assert.equal(readFileSync(file('pr-body.md'), 'utf8'), `${fenced}\nRelates to ABC-123\n`);
  const afterFence = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: `${fenced}\n## Summary\n` });
  assert.match(afterFence.stderr, /sections the git preset does not know: "## Summary"\./);
  // The same with CRLF line ends: the fence closes, so the later section counts.
  const crlf = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: `${fenced}\n## Summary\n`.replace(/\n/g, '\r\n') });
  assert.match(crlf.stderr, /sections the git preset does not know: "## Summary"\./);
  // A body that starts with the trailer is stored without a leading blank line.
  const trailerFirst = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: 'Relates to ABC-123\n\n## What & why\nText.' });
  assert.equal(trailerFirst.code, 0, trailerFirst.stderr);
  assert.equal(readFileSync(file('pr-body.md'), 'utf8'), '## What & why\nText.\n\nRelates to ABC-123\n');
});

test('pr body --stdin of a no-ticket task is stored without leading blank lines', (t) => {
  const s = inPlace(t);
  const result = cw(s.fx.root, ['pr', 'body', '--task', s.id, '--stdin'], { env: s.fx.env, input: '\n  \n## What & why\nText.\n' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readFileSync(taskPath(s.ws, s.id, 'pr-body.md'), 'utf8'), '## What & why\nText.\n');
});

test('no PR/MR host: exit 3, then pr record --skipped ends delivery', (t) => {
  const s = inPlace(t, { origin: null });
  const result = run(s.fx, ['pr', 'command', '--task', s.id]);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /no PR\/MR host\.\nFix: Ask the user: .*--skipped/);
  const skipped = run(s.fx, ['pr', 'record', '--task', s.id, '--skipped', 'no remote host', '--json']);
  assert.equal(skipped.code, 0, skipped.stderr);
  assert.deepEqual(skipped.json(), { task: s.id, phase: 'deliver', prUrl: null, noPrReason: 'no remote host' });
});

test('in-place cleanup keeps a dirty app on the task branch', (t) => {
  const s = inPlace(t, { origin: null });
  run(s.fx, ['pr', 'record', '--task', s.id, '--skipped', 'no remote']);
  write(s.app, { 'scratch.txt': 'wip\n' });
  const result = run(s.fx, ['task', 'cleanup', '--task', s.id, '--json']);
  assert.equal(result.code, 3);
  assert.deepEqual([result.json().action, result.json().reason], ['kept', `${s.app} has uncommitted changes: scratch.txt.`]);
  assert.equal(s.git('branch', '--show-current'), s.branch);
  assert.match(run(s.fx, ['task', 'cleanup', '--task', s.id]).stdout, /: kept .*scratch\.txt\.\nFix: Ask the user/);
});

test('git foreign-commits: clean from any cwd, a foreign prefix gets the rebase fix, interleaved asks', (t) => {
  const fx = makeInPlace(t);
  const ws = loadWorkspace({ cwd: fx.root });
  const git = gitIn(fx.app, fx.env);
  const s = reviewedTask(ws, git);
  for (const cwd of [fx.root, fx.app, join(fx.app, 'src')]) {
    const clean = cw(cwd, ['git', 'foreign-commits', '--task', s.id, '--json'], { env: fx.env });
    assert.equal(clean.code, 0, clean.stderr);
    assert.deepEqual([clean.json().commits, clean.json().foreign, clean.json().onTaskBranch], [1, [], true]);
  }

  // Another branch's commit under the task's own: a contiguous prefix.
  git('switch', '-q', '-c', 'other', s.base);
  write(fx.app, { 'other.txt': 'other\n' });
  git('add', '-A');
  git('commit', '-q', '-m', '[TASK] Other work');
  const otherSha = git('rev-parse', 'HEAD');
  git('switch', '-q', s.branch);
  git('rebase', '-q', 'other');
  const prefixed = cw(fx.root, ['git', 'foreign-commits', '--task', s.id, '--json'], { env: fx.env });
  assert.equal(prefixed.code, 1);
  const out = prefixed.json();
  assert.deepEqual(out.foreign.map((commit) => [commit.subject, commit.alsoOn, commit.reasons]), [['[TASK] Other work', ['other'], ['other-branch']]]);
  // In-place the implementer runs git -C <appRoot> from the project root (owner decision 2026-10-20).
  assert.equal(out.command, `git -C app rebase --onto ${s.base} ${otherSha} ${s.branch}`);
  assert.equal(out.fix, `send the same implementer the rebase that keeps only its own commits: ${out.command}`);

  // An old commit after the task's own cannot be dropped by one rebase.
  git('switch', '-q', '-C', s.branch, s.base);
  git('cherry-pick', s.tip);
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', '[TASK] Old work'], { cwd: fx.app, env: { ...fx.env, GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z' } });
  const interleaved = cw(fx.root, ['git', 'foreign-commits', '--task', s.id, '--json'], { env: fx.env });
  assert.equal(interleaved.code, 1);
  assert.deepEqual([interleaved.json().foreign.map((commit) => commit.reasons), interleaved.json().command, interleaved.json().fix], [[['predates-task']], null, "the foreign commits are interleaved with the task's own; ask the user."]);
  assert.match(cw(fx.root, ['git', 'foreign-commits', '--task', s.id], { env: fx.env }).stdout, /interleaved .*ask the user/);

  git('switch', '-q', 'main');
  const off = cw(fx.root, ['git', 'foreign-commits', '--task', s.id, '--json'], { env: fx.env });
  assert.equal(off.code, 1);
  assert.deepEqual([off.json().onTaskBranch, off.json().command], [false, `git -C app switch ${s.branch}`]);
  assert.equal(off.json().fix, `send the same implementer the switch back to the task branch: ${off.json().command}; then the foreign commits are interleaved with the task's own; ask the user.`);
});

test('git foreign-commits: the relative command runs from the project root, also below a path with a space', (t) => {
  const previous = process.env.TMPDIR;
  const spaced = mkdtempSync(join(tmpdir(), 'dw space '));
  process.env.TMPDIR = spaced;
  t.after(() => {
    // Assigning undefined would store the string "undefined" (Linux CI has no TMPDIR).
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(spaced, { recursive: true, force: true });
  });
  const fx = makeInPlace(t);
  assert.match(fx.app, / /);
  const git = gitIn(fx.app, fx.env);
  const s = reviewedTask(loadWorkspace({ cwd: fx.root }), git);
  git('switch', '-q', '-c', 'other', s.base);
  write(fx.app, { 'other.txt': 'other\n' });
  git('add', '-A');
  git('commit', '-q', '-m', '[TASK] Other work');
  git('switch', '-q', s.branch);
  git('rebase', '-q', 'other');
  const { command } = cw(fx.root, ['git', 'foreign-commits', '--task', s.id, '--json'], { env: fx.env }).json();
  assert.ok(command.startsWith(`git -C app rebase --onto ${s.base} `), command);
  const rebase = spawnSync('sh', ['-c', command], { cwd: fx.root, env: fx.env, encoding: 'utf8' });
  assert.equal(rebase.status, 0, rebase.stderr);
  assert.equal(cw(fx.root, ['git', 'foreign-commits', '--task', s.id], { env: fx.env }).code, 0);
});

test('in-place cleanup switches app back only from its own task branch', (t) => {
  const s = inPlace(t, { origin: null });
  run(s.fx, ['pr', 'record', '--task', s.id, '--skipped', 'no remote']);
  const other = createTask(s.ws, newTask(s.ws, { ticket: 'NO-TICKET', title: 'Other', type: 'feature', slug: 'other-work', branch: 'NO-TICKET/feature/other-work', ownerSession: 'test-session' }));
  s.git('switch', '-q', '-c', other.branch);
  const left = run(s.fx, ['task', 'cleanup', '--task', s.id, '--json']);
  assert.equal(left.code, 0, left.stderr);
  assert.deepEqual([left.json().action, left.json().otherTask], ['left', other.id]);
  assert.equal(left.json().reason, `${s.app} is on ${other.branch} (the branch of the active task ${other.id}), not on ${s.branch}; cleanup leaves it as it is.`);
  assert.equal(s.git('branch', '--show-current'), other.branch);

  s.git('switch', '-q', '-c', 'user/own');
  const own = run(s.fx, ['task', 'cleanup', '--task', s.id]);
  assert.equal(own.code, 0, own.stderr);
  assert.match(own.stdout, /: left .* as it is\. .* is on user\/own \(not a branch of an active task\)/);
  assert.equal(s.git('branch', '--show-current'), 'user/own');
});

test('worktree mode with glab: commands carry -R, cleanup removes the worktree and its agent branch', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig(), files: { '.gitignore': 'node_modules/\n.claude/worktrees/\n' } });
  hostOrigin(fx.root, fx.env, GITLAB_URL, fx.remote);
  const ws = loadWorkspace({ cwd: fx.root });
  const git = gitIn(fx.root, fx.env);
  const base = git('rev-parse', 'HEAD');
  const branch = 'NO-TICKET/feature/mul-helper';
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Add the mul helper', type: 'feature', slug: 'mul-helper', branch, ownerSession: 'test-session' }));
  const worktree = realpathSync(addAgentWorktree(fx.root, fx.env, '1'));
  const wgit = gitIn(worktree, fx.env);
  wgit('switch', '-q', '-c', branch, base);
  write(worktree, { 'src/mul.mjs': 'export const mul = (a, b) => a * b;\n' });
  wgit('add', '-A');
  wgit('commit', '-q', '-m', '[FEATURE] Add the mul helper');
  mkdirSync(join(fx.root, 'node_modules'));
  symlinkSync(join(fx.root, 'node_modules'), join(worktree, 'node_modules'));
  const tip = wgit('rev-parse', 'HEAD');
  updateTask(ws, task.id, (x) => {
    Object.assign(x, { phase: 'review', round: 1, reviewRound: 1, base: { branch: 'main', commit: base }, workTree: worktree, agentBranch: 'worktree-agent-1' });
  });
  writeRound(ws, task.id, 'review', 1, { status: 'approved', head: tip, findings: [] });
  const glab = stubCli(stubDir(fx.base), 'glab', [{ args: ['mr', 'view'], stderr: 'no open merge request available', exit: 1 }, { args: ['mr', 'list'], stdout: [] }]);
  const repoConfig = configBytes(fx.root);

  const result = cw(fx.root, ['pr', 'command', '--task', task.id, '--json'], { env: fx.env });
  assert.equal(result.code, 0, result.stderr);
  const bodyFile = join(ws.stateDir, 'tasks', task.id, 'pr-body.md');
  assert.deepEqual(result.json().commands, [
    `git -C ${worktree} push origin ${branch}`,
    `glab mr create -R https://gitlab.example.com/group/sub/app -s ${branch} -b main -t '[FEATURE] Add the mul helper' --description-file ${bodyFile} -y`,
  ]);
  assert.deepEqual(glab.calls(), [
    ['mr', 'view', branch, '-R', 'https://gitlab.example.com/group/sub/app', '-F', 'json'],
    ['mr', 'list', '--source-branch', branch, '--all', '-R', 'https://gitlab.example.com/group/sub/app', '-F', 'json'],
  ]);
  assert.equal(cw(fx.root, ['pr', 'record', '--task', task.id, '--url', 'https://gitlab.example.com/group/sub/app/-/merge_requests/1'], { env: fx.env }).code, 0);

  const cleanup = cw(fx.root, ['task', 'cleanup', '--task', task.id, '--json'], { env: fx.env });
  assert.equal(cleanup.code, 0, cleanup.stderr);
  assert.deepEqual([cleanup.json().action, cleanup.json().removedBranch, cleanup.json().branchKept], ['removed', 'worktree-agent-1', branch]);
  assert.ok(!existsSync(worktree));
  assert.ok(existsSync(join(fx.root, 'node_modules')), 'only the link was removed');
  assert.equal(git('branch', '--list', 'worktree-agent-1'), '');
  assert.equal(git('rev-parse', branch), tip, 'the task branch stays');
  assert.equal(cw(fx.root, ['task', 'cleanup', '--task', task.id, '--json'], { env: fx.env }).json().action, 'gone');
  assert.deepEqual(configBytes(fx.root), repoConfig);
});

test('worktree cleanup keeps a dirty worktree', (t) => {
  const fx = makeWorktreeRepo(t);
  const ws = loadWorkspace({ cwd: fx.root });
  const git = gitIn(fx.root, fx.env);
  const base = git('rev-parse', 'HEAD');
  const branch = 'NO-TICKET/feature/mul-helper';
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Add it', type: 'feature', slug: 'mul-helper', branch, ownerSession: 's' }));
  const worktree = realpathSync(addAgentWorktree(fx.root, fx.env, '2'));
  gitIn(worktree, fx.env)('switch', '-q', '-c', branch, base);
  write(worktree, { 'wip.txt': 'wip\n' });
  updateTask(ws, task.id, (x) => Object.assign(x, { phase: 'escalated', round: 1, base: { branch: 'main', commit: base }, workTree: worktree, agentBranch: 'worktree-agent-2' }));
  const result = cw(fx.root, ['task', 'cleanup', '--task', task.id, '--json'], { env: fx.env });
  assert.equal(result.code, 3);
  assert.equal(result.json().action, 'kept');
  assert.ok(existsSync(worktree));
  assert.match(git('branch', '--list', 'worktree-agent-2'), /worktree-agent-2/);

  // Deleted by hand: the agent branch still goes (git 2.54 deletes it without a prune).
  rmSync(worktree, { recursive: true, force: true });
  const gone = cw(fx.root, ['task', 'cleanup', '--task', task.id, '--json'], { env: fx.env });
  assert.equal(gone.code, 0, gone.stderr);
  assert.deepEqual([gone.json().action, gone.json().removedBranch, gone.json().branchKept], ['gone', 'worktree-agent-2', branch]);
  assert.equal(git('branch', '--list', 'worktree-agent-2'), '');
  assert.ok(!git('worktree', 'list', '--porcelain').includes(worktree), 'the record of the deleted worktree is pruned');
  // The active task forgets the worktree; its next agent continues the branch.
  assert.deepEqual([readTask(ws, task.id).workTree, readTask(ws, task.id).resumeBranch], [null, true]);
});

// The sandbox lets git delete the worktree directory but not its record in .git/worktrees (P3 dry run,
// CLI 2.1.308); a read-only .git/worktrees stands in for it.
test('worktree cleanup names the fix when git may not delete the worktree record', { skip: process.getuid?.() === 0 && 'root ignores directory permissions' }, (t) => {
  const fx = makeWorktreeRepo(t);
  const ws = loadWorkspace({ cwd: fx.root });
  const git = gitIn(fx.root, fx.env);
  const base = git('rev-parse', 'HEAD');
  const branch = 'NO-TICKET/feature/mul-helper';
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Add it', type: 'feature', slug: 'mul-helper', branch, ownerSession: 's' }));
  const worktree = realpathSync(addAgentWorktree(fx.root, fx.env, '3'));
  gitIn(worktree, fx.env)('switch', '-q', '-c', branch, base);
  updateTask(ws, task.id, (x) => Object.assign(x, { phase: 'escalated', round: 1, base: { branch: 'main', commit: base }, workTree: worktree, agentBranch: 'worktree-agent-3' }));
  const records = join(fx.root, '.git', 'worktrees');
  chmodSync(records, 0o555);
  let denied;
  try {
    denied = cw(fx.root, ['task', 'cleanup', '--task', task.id], { env: fx.env });
  } finally {
    chmodSync(records, 0o755);
  }
  assert.equal(denied.code, 3, denied.stderr);
  assert.match(denied.stderr, /^cw: git worktree remove \S+ could not finish in \S+: .*(Permission denied|Operation not permitted)\nFix: Run the same cw command again outside the sandbox \(only git's record of the worktree is left\), or ask the user to run git -C \S+ worktree prune\.\n$/);

  const again = cw(fx.root, ['task', 'cleanup', '--task', task.id, '--json'], { env: fx.env });
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual([again.json().action, again.json().removedBranch], ['gone', 'worktree-agent-3']);
  assert.ok(!git('worktree', 'list', '--porcelain').includes(worktree));
});

test('worktree cleanup keeps an agent branch whose commits no other branch holds', (t) => {
  const fx = makeWorktreeRepo(t);
  const ws = loadWorkspace({ cwd: fx.root });
  const git = gitIn(fx.root, fx.env);
  const base = git('rev-parse', 'HEAD');
  const branch = 'NO-TICKET/feature/mul-helper';
  const task = createTask(ws, newTask(ws, { ticket: 'NO-TICKET', title: 'Add it', type: 'feature', slug: 'mul-helper', branch, ownerSession: 's' }));
  const worktree = realpathSync(addAgentWorktree(fx.root, fx.env, '3'));
  const wgit = gitIn(worktree, fx.env);
  write(worktree, { 'early.txt': 'committed before ws setup\n' });
  wgit('add', '-A');
  wgit('commit', '-q', '-m', '[TASK] Early work');
  const early = wgit('rev-parse', 'HEAD');
  wgit('switch', '-q', '-c', branch, base);
  updateTask(ws, task.id, (x) => Object.assign(x, { phase: 'escalated', base: { branch: 'main', commit: base }, workTree: worktree, agentBranch: 'worktree-agent-3' }));

  const result = cw(fx.root, ['task', 'cleanup', '--task', task.id, '--json'], { env: fx.env });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual([result.json().action, result.json().removedBranch], ['removed', null]);
  assert.match(result.stderr, /kept worktree-agent-3: 1 commit\(s\) on it are on no other branch; ask the user/);
  assert.equal(git('rev-parse', 'worktree-agent-3'), early);
  assert.ok(!existsSync(worktree));
});
