import assert from 'node:assert/strict';
import { readFileSync, rmSync, symlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { CACHE_TTL_MS, compareVersions, hookOutput, runDoctor } from '../../cli/lib/doctor.mjs';
import { cw, gitIn, inPlaceConfig, makeInPlace, tempBase, write } from '../fixtures/repo.mjs';
import { minimalPath, stubCli, stubDir } from '../fixtures/stubs.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

// A project with a GitHub work repo and an env whose PATH has only the stubs, git and node.
function project(t, { config } = {}) {
  const fx = makeInPlace(t, config ? { config } : {});
  gitIn(fx.app, fx.env)('remote', 'set-url', 'origin', 'git@github.com:acme/app.git');
  const claudeDir = join(fx.base, 'claude-config');
  const env = { PATH: minimalPath(fx.base), HOME: join(fx.base, 'home'), CLAUDE_CONFIG_DIR: claudeDir };
  const doctor = (options = {}) => runDoctor({ cwd: fx.app, env, platform: 'linux', fresh: true, ...options });
  return { fx, env, claudeDir, doctor };
}
const byId = (report) => Object.fromEntries(report.results.map((result) => [result.id, result]));

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('2.1.296', '2.1.303'), -1);
  assert.equal(compareVersions('2.1.303', '2.1.296'), 1);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  assert.equal(compareVersions('2.31', '2.31.0'), 0);
});

test('without a config there is nothing to check, and the hook prints nothing', (t) => {
  const base = tempBase(t);
  assert.deepEqual(runDoctor({ cwd: base, env: {} }), { configRoot: null, stateDir: null, results: [], cached: false });
  const hook = cw(base, ['doctor', '--hook'], { env: { ...process.env, CLAUDECODE: '1' } });
  assert.deepEqual([hook.code, hook.stdout, hook.stderr], [0, '', '']);
  const plain = cw(base, ['doctor']);
  assert.equal(plain.code, 3);
  assert.match(plain.stderr, /Fix: Run cw in the project directory or below it, .*setup\.sh/);
});

test('the host CLI, the Jira plugin and local binding are warnings with their fix', (t) => {
  const { fx, claudeDir, doctor } = project(t, { config: inPlaceConfig({ tickets: { source: 'jira' } }) });
  let checks = byId(doctor({ platform: 'darwin' }));
  assert.deepEqual([checks.node.ok, checks.git.ok, checks.config.ok, checks['work-repo'].ok, checks['state-dir'].ok], [true, true, true, true, true]);
  assert.equal(checks.claude.ok, true, 'claude is not on PATH: not checked');
  assert.match(checks['host-cli'].message, /gh is not installed/);
  assert.equal(checks['host-cli'].level, 'warning');
  assert.match(checks['host-cli'].fix, /^brew install gh, then gh auth login --hostname github\.com/);
  assert.equal(checks.atlassian.ok, false);
  assert.equal(checks['allow-local-binding'].ok, false);
  assert.ok(checks['allow-local-binding'].message.includes(join(claudeDir, 'settings.json')));
  assert.equal(byId(doctor())['allow-local-binding'], undefined, 'only on macOS');

  stubCli(stubDir(fx.base), 'gh');
  write(claudeDir, { 'settings.json': { sandbox: { network: { allowLocalBinding: true } } } });
  write(fx.root, { '.claude/settings.json': { enabledPlugins: { 'atlassian@claude-plugins-official': true } } });
  checks = byId(doctor({ platform: 'darwin' }));
  assert.deepEqual([checks['host-cli'].ok, checks.atlassian.ok, checks['allow-local-binding'].ok], [true, true, true]);
});

test('the ticket source decides the ticket check: a Linear server in .mcp.json, or the folder of the local tickets', (t) => {
  const linear = project(t, { config: inPlaceConfig({ tickets: { source: 'linear', contextPath: 'docs/specs/{key}.md' } }) });
  let checks = byId(linear.doctor());
  assert.equal(checks.atlassian, undefined);
  assert.equal(checks['linear-mcp'].ok, false);
  assert.match(checks['linear-mcp'].fix, /claude mcp add --transport http --scope project linear https:\/\/mcp\.linear\.app\/mcp\/readonly/);
  write(linear.fx.root, { '.mcp.json': { mcpServers: { tickets: { type: 'http', url: 'https://mcp.linear.app/mcp/readonly' } } } });
  checks = byId(linear.doctor({ fresh: false }));
  assert.equal(checks['linear-mcp'].ok, true, '.mcp.json is part of the cache key');
  assert.match(checks['linear-mcp'].message, /"tickets" in \.mcp\.json/);

  const local = project(t, { config: inPlaceConfig({ tickets: { source: 'local', contextPath: 'docs/specs/{key}.md' } }) });
  checks = byId(local.doctor());
  assert.deepEqual([checks['ticket-files'].ok, checks['ticket-files'].message], [false, 'tickets.source is local, but docs/specs/ does not exist.']);
  write(local.fx.root, { 'docs/specs/APP-1.md': '# One\n' });
  assert.equal(byId(local.doctor({ fresh: false }))['ticket-files'].ok, true, 'the ticket folder is part of the cache key');
});

test('claude below the minimum is an error; --quick skips it', (t) => {
  const { fx, doctor } = project(t);
  stubCli(stubDir(fx.base), 'claude', [{ args: ['--version'], stdout: '2.1.290 (Claude Code)\n' }]);
  assert.match(byId(doctor()).claude.message, /2\.1\.290 \(needs ≥ 2\.1\.296\)/);
  assert.equal(byId(doctor()).claude.ok, false);
  assert.equal(byId(doctor({ quick: true })).claude, undefined);
  stubCli(stubDir(fx.base), 'claude', [{ args: ['--version'], stdout: '2.1.303 (Claude Code)\n' }]);
  assert.equal(byId(doctor()).claude.ok, true);
});

test('an invalid config and a missing app repo are errors', (t) => {
  const { fx, doctor } = project(t, { config: inPlaceConfig({ workspace: { mode: 'in-place', appRoot: 'missing' } }) });
  assert.equal(byId(doctor())['work-repo'].ok, false);
  assert.match(byId(doctor())['work-repo'].fix, /Clone the application repository into/);
  write(fx.root, { '.claude/dev-workflow/config.json': { version: 1 } });
  const checks = byId(doctor());
  assert.equal(checks.config.ok, false);
  assert.match(checks.config.message, /\$\.project: is required/);
  assert.equal(checks['work-repo'], undefined);
});

const teamRule = (body) => `## TEAM-ONE — Team rule\n<!-- rule: severity=advisory -->\n${body}\n`;

test('packs resolve (error) and rules drift (warning): a changed project rule drifts, a broken pack.json fails', (t) => {
  const { fx, env, doctor } = project(t);
  let checks = byId(doctor());
  assert.deepEqual([checks.packs.ok, checks.packs.level, checks.packs.message], [true, 'error', 'Packs resolve: core.']);
  assert.deepEqual([checks.rules.ok, checks.rules.level, checks.rules.fix], [false, 'warning', 'Run cw rules build in a terminal.']);
  assert.match(checks.rules.message, /^The compiled rules in \.claude\/rules\/dev-workflow\/ are out of date \(no-lock: 1, missing: \d+\)\.$/);

  write(fx.root, { '.claude/dev-workflow/rules/team.md': teamRule('First text.') });
  const build = cw(fx.root, ['rules', 'build'], { env: fx.env });
  assert.equal(build.code, 0, build.stderr);
  checks = byId(doctor());
  assert.deepEqual([checks.rules.ok, checks.rules.message], [true, 'Rules up to date in .claude/rules/dev-workflow/.']);
  write(fx.root, { '.claude/dev-workflow/rules/team.md': teamRule('Changed text.') });
  checks = byId(doctor());
  assert.equal(checks.rules.ok, false);
  assert.match(checks.rules.message, /out of date \(changed: 1\)\.$/);

  write(fx.root, {
    '.claude/dev-workflow/config.json': inPlaceConfig({ packs: ['local'] }),
    '.claude/dev-workflow/packs/local/pack.json': '{ "id": "local",',
  });
  checks = byId(doctor());
  assert.deepEqual([checks.packs.ok, checks.packs.level, checks.packs.label], [false, 'error', 'packs do not resolve']);
  assert.match(checks.packs.message, /^Pack resolution failed:\n- .*packs\/local\/pack\.json: not valid JSON/);
  assert.match(checks.packs.fix, /^Correct packs in \.claude\/dev-workflow\/config\.json \(or the named pack\.json\)/);
  assert.equal(checks.rules, undefined, 'no drift check without resolved packs');
  const plain = cw(fx.root, ['doctor', '--quick', '--fresh'], { env: { ...fx.env, ...env } });
  assert.equal(plain.code, 1);
  assert.match(plain.stdout, /ERROR {2}Pack resolution failed/);

  write(fx.root, { '.claude/dev-workflow/packs/local/pack.json': { id: 'local', version: '0.1.0', title: 'Local', rules: 'rules.md' }, '.claude/dev-workflow/packs/local/rules.md': '## LOCAL-ONE — x\n' });
  checks = byId(doctor());
  assert.deepEqual([checks.packs.ok, checks.rules.ok, checks.rules.level, checks.rules.label], [true, false, 'error', 'rules do not compile']);
  assert.match(checks.rules.message, /^Rulebook build failed:\n- .*LOCAL-ONE has no "<!-- rule: … -->" line/);
});

test('results are cached in the state dir until an input changes, the TTL ends or --fresh', (t) => {
  const { fx, env, doctor } = project(t);
  const now = Date.now();
  assert.equal(doctor({ fresh: false, now }).cached, false);
  const again = doctor({ fresh: false, now: now + 1000 });
  assert.equal(again.cached, true);
  assert.ok(readFileSync(join(again.stateDir, 'doctor-cache.json'), 'utf8').includes('"results"'));
  assert.equal(doctor({ fresh: true, now: now + 2000 }).cached, false);
  assert.equal(doctor({ fresh: false, now: now + CACHE_TTL_MS + 5000 }).cached, false);
  assert.equal(doctor({ fresh: false, now: now + CACHE_TTL_MS + 6000 }).cached, true);
  write(fx.root, { '.claude/dev-workflow/config.json': inPlaceConfig({ project: { name: 'Renamed project' } }) });
  assert.equal(doctor({ fresh: false, now: now + CACHE_TTL_MS + 7000 }).cached, false);
  stubCli(stubDir(fx.base), 'gh');
  assert.equal(runDoctor({ cwd: fx.root, env, platform: 'linux', now: now + CACHE_TTL_MS + 8000 }).cached, false, 'a new tool on PATH');

  const later = now + CACHE_TTL_MS + 9000;
  write(fx.root, { '.claude/dev-workflow/rules/team.md': teamRule('One.') });
  assert.equal(doctor({ fresh: false, now: later }).cached, false, 'a new project rule file');
  assert.equal(doctor({ fresh: false, now: later + 1 }).cached, true);
  write(fx.root, { '.claude/dev-workflow/rules/team.md': teamRule('Two, a longer text.') });
  assert.equal(doctor({ fresh: false, now: later + 2 }).cached, false, 'a changed project rule file');
  assert.equal(doctor({ fresh: false, now: later + 3 }).cached, true);
  write(fx.root, { '.claude/dev-workflow/procedures/implementer/team.md': '---\nname: team\n---\nStep.\n' });
  assert.equal(doctor({ fresh: false, now: later + 4 }).cached, false, 'a new project procedure');
});

test('an updated claude at the same PATH entry invalidates the cache', (t) => {
  const { fx, doctor } = project(t);
  const now = Date.now();
  // A symlink to a versioned binary, re-pointed by the update.
  const versions = join(fx.base, 'versions');
  stubCli(versions, '2.1.200', [{ args: ['--version'], stdout: '2.1.200 (Claude Code)\n' }]);
  stubCli(versions, '2.1.303', [{ args: ['--version'], stdout: '2.1.303 (Claude Code)\n' }]);
  symlinkSync(join(versions, '2.1.200'), join(stubDir(fx.base), 'claude'));
  assert.equal(byId(doctor({ fresh: false, now })).claude.ok, false);
  rmSync(join(stubDir(fx.base), 'claude'));
  symlinkSync(join(versions, '2.1.303'), join(stubDir(fx.base), 'claude'));
  let report = doctor({ fresh: false, now: now + 1000 });
  assert.deepEqual([report.cached, byId(report).claude.ok], [false, true]);

  // The binary replaced in place: a new mtime.
  rmSync(join(stubDir(fx.base), 'claude'));
  const { path } = stubCli(stubDir(fx.base), 'claude', [{ args: ['--version'], stdout: '2.1.200 (Claude Code)\n' }]);
  assert.equal(byId(doctor({ fresh: false, now: now + 2000 })).claude.ok, false);
  stubCli(stubDir(fx.base), 'claude', [{ args: ['--version'], stdout: '2.1.303 (Claude Code)\n' }]);
  utimesSync(path, new Date(now + 60_000), new Date(now + 60_000));
  report = doctor({ fresh: false, now: now + 3000 });
  assert.deepEqual([report.cached, byId(report).claude.ok], [false, true]);
});

test('hookOutput: nothing when all is well, else one line plus the facts', () => {
  const ok = { id: 'node', label: 'Node', level: 'error', ok: true, message: 'Node 20.', fix: '' };
  assert.equal(hookOutput([ok]), null);
  const output = hookOutput([ok, { id: 'host-cli', label: 'gh not installed', level: 'warning', ok: false, message: 'gh is not installed.', fix: 'brew install gh' }]);
  assert.deepEqual(output, {
    systemMessage: 'dev-workflow: 1 setup issue (gh not installed). Details: cw doctor',
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'dev-workflow setup facts:\n- [warning] gh is not installed. Fix: brew install gh' },
  });
  const long = hookOutput([{ ...ok, ok: false, message: 'x'.repeat(20_000) }]);
  assert.ok(long.hookSpecificOutput.additionalContext.length <= 10_000);
  const cached = hookOutput([{ ...ok, ok: false, label: 'claude too old' }], { cached: true });
  assert.equal(cached.systemMessage, 'dev-workflow: 1 setup issue (claude too old). Cached result; cw doctor --fresh checks again.');
});

test('cw doctor --hook prints SessionStart JSON for problems; cw doctor exits 1 on an error', (t) => {
  const { fx, env } = project(t, { config: inPlaceConfig({ workspace: { mode: 'in-place', appRoot: 'missing' } }) });
  const cwEnv = { ...fx.env, ...env };
  const hook = cw(fx.root, ['doctor', '--hook', '--quick'], { env: cwEnv });
  assert.equal(hook.code, 0, hook.stderr);
  const output = JSON.parse(hook.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.systemMessage, /^dev-workflow: \d setup issues? \(.*missing\/ is no git repo.*\)\. Details: cw doctor$/);
  const again = cw(fx.root, ['doctor', '--hook', '--quick'], { env: cwEnv });
  assert.match(JSON.parse(again.stdout).systemMessage, /\. Cached result; cw doctor --fresh checks again\.$/);
  const plain = cw(fx.root, ['doctor', '--quick', '--fresh'], { env: cwEnv });
  assert.equal(plain.code, 1);
  assert.match(plain.stdout, /ERROR {2}missing\/ is not a git repository of its own.* Fix: Clone/);
});
