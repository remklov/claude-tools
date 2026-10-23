// Generates the dry-run projects of docs/dry-run.md into temp dirs and checks them: the layout, the
// origin and the first push, the files cw init wrote, cw config validate, cw doctor --quick, the gh and
// glab stubs through cw's own host adapters, and the CLI launcher. No npm and no network. This file is
// outside the plugin's test glob; run it from the repository root with
//   node --test tests/dry-run/make-project.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { adapterFor, detectHost } from '../../plugins/dev-workflow/cli/lib/host/index.mjs';
import { cw, hermeticEnv, pluginRoot, tempBase } from '../../plugins/dev-workflow/tests/fixtures/repo.mjs';
import { HOSTS } from './make-project.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'make-project.mjs');
const makeProject = (args, env) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const gitIn = (cwd, env) => (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const isExecutable = (path) => (statSync(path).mode & 0o111) !== 0;

// All four combinations: docs/dry-run.md uses in-place with github (3) and gitlab (4, 6), worktree with
// github (5).
const COMBINATIONS = ['in-place', 'worktree'].flatMap((mode) => ['github', 'gitlab'].map((host) => ({ mode, host })));

for (const { mode, host } of COMBINATIONS) {
  test(`make-project builds the ${mode} project with a ${host} origin`, (t) => {
    const base = tempBase(t, 'dw-dry-run-');
    const env = hermeticEnv(base);
    const result = makeProject([join(base, 'project'), '--mode', mode, '--host', host], env);
    assert.equal(result.status, 0, result.stderr);

    const root = realpathSync(join(base, 'project'));
    const work = mode === 'in-place' ? join(root, 'app') : root;
    const kit = join(root, '.dry-run');
    const git = gitIn(root, env);
    const gitWork = gitIn(work, env);

    // The application: npm workspaces with the web and api packages, each with its checks and one test.
    assert.deepEqual(readJson(join(work, 'package.json')).workspaces, ['packages/*']);
    const web = readJson(join(work, 'packages/web/package.json'));
    const api = readJson(join(work, 'packages/api/package.json'));
    for (const pkg of [web, api]) assert.deepEqual(Object.keys(pkg.scripts).filter((name) => ['test', 'lint', 'typecheck'].includes(name)).sort(), ['lint', 'test', 'typecheck']);
    assert.match(web.dependencies.react, /^\^19\./);
    for (const dep of ['vite', 'vitest', '@testing-library/react', 'jsdom', 'eslint', 'typescript']) assert.ok(web.devDependencies[dep], `web lacks ${dep}`);
    assert.match(api.dependencies.express, /^\^5\./);
    for (const dep of ['supertest', 'vitest', 'eslint', 'typescript', '@types/express']) assert.ok(api.devDependencies[dep], `api lacks ${dep}`);
    assert.ok(existsSync(join(work, 'packages/web/src/App.test.tsx')));
    assert.ok(existsSync(join(work, 'packages/api/src/app.test.ts')));
    assert.equal(existsSync(join(work, 'node_modules')), false, 'make-project must not run npm');

    // The layout of the mode: in-place has the ignored nested app repo, worktree a single repo.
    if (mode === 'in-place') {
      assert.ok(statSync(join(work, '.git')).isDirectory());
      assert.equal(spawnSync('git', ['check-ignore', '-q', 'app/'], { cwd: root, env }).status, 0);
    } else {
      assert.equal(existsSync(join(root, 'app')), false);
      assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.claude\/worktrees\/$/m);
    }
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.dry-run/'], { cwd: root, env }).status, 0);
    // /sandbox saves its mode there; the dry-run checks expect a clean status afterwards.
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.claude/settings.local.json'], { cwd: root, env }).status, 0);

    // The origin: the fetch URL names the host, pushes land in the bare repo, which holds main.
    assert.equal(gitWork('remote', 'get-url', 'origin'), HOSTS[host].fetchUrl);
    assert.equal(gitWork('remote', 'get-url', '--push', 'origin'), join(kit, 'origin.git'));
    const head = gitWork('rev-parse', 'main');
    assert.equal(gitWork('rev-parse', 'origin/main'), head);
    assert.equal(git('--git-dir', join(kit, 'origin.git'), 'rev-parse', 'main'), head);
    assert.equal(gitWork('branch', '--show-current'), 'main');
    assert.equal(gitWork('status', '--porcelain'), '');
    assert.equal(git('status', '--porcelain'), '');

    // The files cw init wrote, committed in the project repository.
    const config = readJson(join(root, '.claude/dev-workflow/config.json'));
    assert.deepEqual(config.workspace, mode === 'in-place' ? { mode: 'in-place', appRoot: 'app' } : { mode: 'worktree' });
    assert.equal(config.git.noTicketKey, 'NO-TICKET');
    assert.deepEqual(config.project.language, { repo: 'en', productCopy: 'de' });
    assert.deepEqual(config.packages.map((pkg) => [pkg.id, pkg.path, pkg.areas, pkg.checks]), [
      ['api', 'packages/api', ['backend'], { test: 'npm test', typecheck: 'npm run typecheck', lint: 'npm run lint' }],
      ['web', 'packages/web', ['frontend'], { test: 'npm test', typecheck: 'npm run typecheck', lint: 'npm run lint' }],
    ]);
    const pack = (id) => config.packs.find((entry) => (typeof entry === 'string' ? entry : entry.id) === id);
    assert.equal(pack('express').variant, '5');
    assert.equal(pack('react-vite').variant, 'react-19');
    assert.equal(pack('typescript').options.moduleResolution, 'nodenext');
    assert.ok(pack('vitest') && pack('node-npm'));
    const tracked = git('ls-files').split('\n');
    for (const file of ['.claude/dev-workflow/config.json', '.claude/dev-workflow/rulebook.lock.json', '.claude/settings.json', '.claude/rules/dev-workflow/00-global.md', 'CLAUDE.md', 'scripts/setup-dev-workflow.sh']) {
      assert.ok(tracked.includes(file), `${file} is not committed`);
    }
    const settings = readJson(join(root, '.claude/settings.json'));
    assert.ok(settings.permissions.allow.includes('Bash(cw *)'));
    // In-place, the relative git -C app form cw prints is allowed (§12); worktree mode has no app root.
    const appRules = ['Bash(git -C app add *)', 'Bash(git -C app commit *)'];
    assert.deepEqual(appRules.filter((rule) => settings.permissions.allow.includes(rule)), mode === 'in-place' ? appRules : []);
    assert.ok(settings.permissions.ask.includes('Bash(git -C * push *)'));
    assert.ok(settings.permissions.deny.includes('Agent(model:*)'));
    assert.equal(settings.worktree?.baseRef, mode === 'worktree' ? 'head' : undefined);
    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /^# Dry Run/);
    assert.match(claudeMd, /<!-- dev-workflow:start -->[\s\S]*\/dev-workflow:ticket[\s\S]*<!-- dev-workflow:end -->/);
    assert.ok(isExecutable(join(root, 'scripts/setup-dev-workflow.sh')));

    // cw accepts the project: the config validates, and doctor --quick finds no error (no
    // node_modules, a missing host CLI or Jira plugin are not errors).
    const validate = cw(root, ['config', 'validate'], { env });
    assert.equal(validate.code, 0, validate.stderr);
    const doctor = cw(root, ['doctor', '--quick', '--json'], { env });
    assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
    assert.deepEqual(doctor.json().results.filter((item) => item.level === 'error' && !item.ok), []);

    // The stubs answer cw's own host adapter: no PR/MR yet, so cw pr command prints the create command.
    const stubEnv = { ...env, PATH: `${join(kit, 'bin')}:${env.PATH}` };
    const detected = detectHost({ workTree: work, config: null });
    assert.equal(detected.kind, host);
    const adapter = adapterFor(detected.kind);
    assert.equal(adapter.findExisting({ host: detected, branch: 'NO-TICKET/feature/add-health-route', cwd: work, env: stubEnv }), null);
    const create = adapter.createCommand({ host: detected, base: 'main', branch: 'NO-TICKET/feature/add-health-route', title: '[FEATURE] Add the health route', bodyFile: '/tmp/pr-body.md' });
    assert.match(create, host === 'github' ? /^gh pr create --repo github\.com\/acme\/dry-run -B main / : /^glab mr create -R https:\/\/gitlab\.example\.com\/acme\/dry-run -s /);
    const stub = host === 'github' ? ['gh', ['pr', 'create']] : ['glab', ['mr', 'create']];
    const created = spawnSync(join(kit, 'bin', stub[0]), stub[1], { env: stubEnv, encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stdout.trim(), HOSTS[host].prUrl);

    // The launcher starts claude in the project root, with the stubs first on PATH and the plugin dir.
    const fakeBin = join(base, 'fake-claude');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'claude'), '#!/bin/sh\necho "cwd=$(pwd -P)"\necho "gh=$(command -v gh)"\necho "args=$*"\n', { mode: 0o755 });
    const launched = spawnSync(join(kit, 'start-cli.sh'), ['--resume'], { cwd: base, env: { ...env, PATH: `${fakeBin}:${env.PATH}` }, encoding: 'utf8' });
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(launched.stdout, `cwd=${root}\ngh=${join(kit, 'bin', 'gh')}\nargs=--plugin-dir ${pluginRoot} --resume\n`);

    // The next steps name the npm command and the launcher; make-project ran neither.
    assert.ok(result.stdout.includes(`cd ${work}\n     npm install\n`), result.stdout);
    assert.ok(result.stdout.includes(join(kit, 'start-cli.sh')));
  });
}

test('make-project refuses a used target, a target inside a repository, Claude Code and bad options', (t) => {
  const base = tempBase(t, 'dw-dry-run-');
  const env = hermeticEnv(base);

  mkdirSync(join(base, 'used'));
  writeFileSync(join(base, 'used', 'notes.txt'), 'keep me\n');
  const used = makeProject([join(base, 'used')], env);
  assert.equal(used.status, 3);
  assert.match(used.stderr, /is not empty\.\nFix: Pass a directory that does not exist yet or is empty\./);

  execFileSync('git', ['init', '-q', join(base, 'repo')], { env });
  const nested = makeProject([join(base, 'repo', 'dry-run')], env);
  assert.equal(nested.status, 3);
  assert.match(nested.stderr, /is inside the git repository .*\nFix: Pass a directory outside any git repository/);
  assert.equal(existsSync(join(base, 'repo', 'dry-run')), false);

  const inClaude = makeProject([join(base, 'from-claude')], { ...env, CLAUDECODE: '1' });
  assert.equal(inClaude.status, 3);
  assert.match(inClaude.stderr, /Fix: Run make-project in your own terminal\./);
  assert.equal(existsSync(join(base, 'from-claude')), false);

  assert.equal(makeProject([join(base, 'x'), '--mode', 'docker'], env).status, 2);
  assert.equal(makeProject([join(base, 'x'), '--host', 'bitbucket'], env).status, 2);
  assert.equal(makeProject([], env).status, 2);
  assert.equal(makeProject([join(base, 'x'), '--colour'], env).status, 2);
  assert.equal(existsSync(join(base, 'x')), false);
});
