import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadConfig, packageOf, packagesOf, readConfigFile, secretValues, validateConfig, withDefaults } from '../../cli/lib/config.mjs';
import {
  branchExists, changedFiles, commitsBetween, currentBranch, deleteBranch, git, isClean, porcelain,
} from '../../cli/lib/git.mjs';
import { findConfigRoot, gitForm, loadWorkspace, resolveGitDirs, workTreeOf } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, gitIn, inPlaceConfig, makeInPlace, makeWorktreeRepo, tempBase, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

// The §5 example (Acme Shop) with the packs this phase does not define yet left out.
const exampleConfig = {
  version: 1,
  project: { name: 'Acme Shop', language: { repo: 'en', productCopy: 'de' } },
  workspace: { mode: 'in-place', appRoot: 'app' },
  packs: ['node-npm', 'typescript', { id: 'express', variant: '5', options: { appEntry: 'createApp()' } }, { id: 'react-vite', variant: 'react-19' }, 'vitest'],
  packages: [{ id: 'app', path: '.', areas: ['frontend', 'backend'], checks: { test: 'npm test', typecheck: 'npm run typecheck', lint: 'npm run lint' } }],
  git: { preset: 'default', defaultBase: 'main', noTicketKey: 'NO-TICKET' },
  tickets: { source: 'jira', keyPattern: '^[A-Z][A-Z0-9]+-[0-9]+$' },
  workflow: { maxReviewRounds: 3, confirm: ['l', 'xl'], maxQuestionsPerRound: 4 },
  guards: { ports: [], commands: [], devServer: 'allowed' },
  complexity: { escalate: [] },
  rules: { add: [], disable: [], extend: {}, override: {}, options: {}, allowProtected: false },
};

test('the §5 example validates and gets the documented defaults', () => {
  assert.deepEqual(validateConfig(exampleConfig), []);
  const config = withDefaults(exampleConfig);
  assert.equal(config.packs[0].id, 'core');
  assert.equal(config.git.noTicketKey, 'NO-TICKET');
  assert.equal(config.git.conventions.id, 'default');
  assert.equal(config.workflow.checkTimeoutMinutes, 15);
  assert.equal(config.project.language.productCopy, 'de');

  const minimal = withDefaults({ version: 1, project: { name: 'x' }, packs: [], packages: [{ id: 'a', path: './pkg/', areas: ['backend'] }] });
  assert.equal(minimal.workspace.mode, 'worktree');
  assert.equal(minimal.git.noTicketKey, 'maintenance');
  assert.equal(minimal.packages[0].path, 'pkg');
  assert.equal(minimal.project.language.productCopy, 'en');
  assert.deepEqual([minimal.tickets.source, minimal.tickets.contextPath], ['local', 'docs/tickets/{key}.md']);
  const linear = withDefaults({ ...exampleConfig, tickets: { source: 'linear', contextPath: 'docs/specs/{key}.md' } });
  assert.deepEqual([linear.tickets.source, linear.tickets.contextPath], ['linear', 'docs/specs/{key}.md']);
});

test('config errors name the field and the problem', () => {
  const errorsOf = (patch) => validateConfig({ ...exampleConfig, ...patch });
  assert.deepEqual(errorsOf({ workspce: {} }).map((e) => e.path), ['$.workspce']);
  assert.match(errorsOf({ workspce: {} })[0].message, /allowed: version, project, workspace/);
  assert.deepEqual(errorsOf({ workspace: { mode: 'in-place' } }), [{ path: '$.workspace.appRoot', message: 'is required for mode in-place' }]);
  assert.match(errorsOf({ workspace: { mode: 'in-place', appRoot: '../x' } })[0].message, /relative path inside the project/);
  assert.match(errorsOf({ workspace: { mode: 'worktree', appRoot: 'app' } })[0].message, /only allowed with mode in-place/);
  const duplicate = errorsOf({ packages: [{ id: 'a', path: 'x', areas: ['b'] }, { id: 'a', path: './x/', areas: ['b'] }] });
  assert.deepEqual(duplicate.map((e) => e.message), ['duplicates package id "a"', 'duplicates package path "x"']);
  assert.match(errorsOf({ git: { noTicketKey: 'AB-1' } })[0].message, /must not match tickets.keyPattern/);
  assert.match(errorsOf({ tickets: { keyPattern: '(' } })[0].message, /not a valid regular expression/);
  assert.match(errorsOf({ tickets: { source: 'github' } })[0].message, /jira, linear, local/);
  assert.deepEqual(errorsOf({ tickets: { source: 'local' } }), [], 'local without contextPath uses docs/tickets/{key}.md');
  assert.match(errorsOf({ tickets: { source: 'linear', contextPath: 'docs/specs/ticket.md' } })[0].message, /must contain \{key\}/);
  for (const contextPath of ['/docs/{key}.md', '../specs/{key}.md', 'docs/../../{key}.md']) {
    assert.match(errorsOf({ tickets: { source: 'local', contextPath } })[0].message, /relative path inside the project/, contextPath);
  }
  assert.deepEqual(errorsOf({ tickets: { source: 'jira', contextPath: 'docs/specs/{key}.md' } }), []);
  assert.match(errorsOf({ complexity: { escalate: [{ min: 'l', reason: 'x' }] } })[0].message, /needs paths or keywords/);
  assert.match(errorsOf({ git: { preset: 'none' } })[0].message, /names no preset/);
  assert.match(errorsOf({ packs: ['core', 'core'] })[0].message, /duplicates pack "core"/);
});

test('a JSON syntax error carries line and column; an invalid config is exit 3', (t) => {
  const base = tempBase(t);
  writeFileSync(join(base, 'c.json'), '{\n  "version": 1,\n  oops\n}\n');
  assert.throws(() => readConfigFile(join(base, 'c.json')), (error) => error.exitCode === 3 && /line 3/.test(error.message));
  writeFileSync(join(base, 'd.json'), JSON.stringify({ version: 2 }));
  assert.throws(() => loadConfig(join(base, 'd.json')), (error) => error.exitCode === 3 && error.details.errors.length > 0);
});

test('packages are matched by the longest path; env values are secrets', () => {
  const config = withDefaults({
    ...exampleConfig,
    packages: [
      { id: 'root', path: '.', areas: ['infra'] },
      { id: 'web', path: 'packages/web', areas: ['frontend'], env: { API_TOKEN: 'secret-token' } },
    ],
  });
  assert.equal(packageOf(config, 'packages/web/src/a.ts').id, 'web');
  assert.equal(packageOf(config, 'packages/webby/a.ts').id, 'root');
  assert.deepEqual(packagesOf(config, ['packages/web/a', 'README.md']).packages.map((p) => p.id), ['root', 'web']);
  assert.deepEqual(secretValues(config), ['secret-token']);
  const scoped = withDefaults({ ...exampleConfig, packages: [{ id: 'web', path: 'web', areas: ['frontend'] }] });
  assert.deepEqual(packagesOf(scoped, ['web/a', 'docs/b']).unowned, ['docs/b']);
});

test('in-place: the config root and the state come from the outer repo, also from inside app/', (t) => {
  const fx = makeInPlace(t);
  mkdirSync(join(fx.app, 'src', 'deep'), { recursive: true });
  const ws = loadWorkspace({ cwd: join(fx.app, 'src', 'deep') });
  assert.equal(ws.configRoot, realpathSync(fx.root));
  assert.equal(realpathSync(ws.commonDir), realpathSync(join(fx.root, '.git')), 'the state is the outer repo\'s, not app/.git (§3)');
  assert.equal(ws.stateDir, join(ws.commonDir, 'dev-workflow'));
  assert.equal(ws.workRepo, realpathSync(fx.app));
  assert.equal(workTreeOf(ws, null), ws.workRepo);
  assert.deepEqual(resolveGitDirs(fx.app), { repoRoot: fx.app, gitDir: join(fx.app, '.git'), commonDir: join(fx.app, '.git') });
});

test('gitForm: in-place git -C <appRoot> relative to the project root (quoted when needed), worktree plain git', () => {
  const ws = (workspace) => ({ mode: workspace.mode, config: withDefaults({ ...exampleConfig, workspace }) });
  assert.equal(gitForm(ws({ mode: 'in-place', appRoot: 'app' })), 'git -C app');
  assert.equal(gitForm(ws({ mode: 'in-place', appRoot: './apps/web/' })), 'git -C apps/web', 'the normalized appRoot, as cw init writes its allow rules');
  assert.equal(gitForm(ws({ mode: 'in-place', appRoot: 'my app' })), "git -C 'my app'");
  assert.equal(gitForm(ws({ mode: 'worktree' })), 'git');
});

test('worktree: a linked worktree shares the common dir of the main repo', (t) => {
  const fx = makeWorktreeRepo(t);
  const wt = addAgentWorktree(fx.root, fx.env);
  const dirs = resolveGitDirs(wt);
  assert.equal(dirs.repoRoot, wt);
  assert.equal(realpathSync(dirs.commonDir), realpathSync(join(fx.root, '.git')));
  const ws = loadWorkspace({ cwd: wt });
  assert.equal(realpathSync(ws.commonDir), realpathSync(join(fx.root, '.git')));
  assert.equal(workTreeOf(ws, { workTree: wt }), wt);
  assert.equal(ws.configRoot, realpathSync(wt), 'a worktree with the committed config is its own config root');
});

test('without a config: exit 3 naming the project directory first, then setup.sh; or null for hooks', (t) => {
  const base = tempBase(t);
  assert.equal(findConfigRoot(base), null);
  assert.equal(loadWorkspace({ cwd: base, requireConfig: false }), null);
  assert.throws(() => loadWorkspace({ cwd: base }), (error) => error.exitCode === 3 && /^Run cw in the project directory or below it, where \.claude\/dev-workflow\/config\.json is\..*setup\.sh/.test(error.fix));
  write(base, { 'p/.claude/dev-workflow/config.json': inPlaceConfig() });
  assert.throws(() => loadWorkspace({ cwd: join(base, 'p') }), (error) => error.exitCode === 3 && /not inside a git repository/.test(error.message));
});

test('git helpers need a cwd and read status, branches and commits', (t) => {
  const fx = makeWorktreeRepo(t);
  const run = gitIn(fx.root, fx.env);
  assert.throws(() => git(['status']), /without a cwd/);
  assert.equal(isClean(fx.root), true);
  write(fx.root, { 'new file.txt': 'x', 'src/sum.mjs': 'changed\n' });
  assert.deepEqual(porcelain(fx.root).sort(), ['new file.txt', 'src/sum.mjs']);
  run('switch', '-q', '-c', 'APP-1/feature/a-b');
  run('add', '-A');
  run('commit', '-q', '-m', 'work');
  assert.equal(currentBranch(fx.root), 'APP-1/feature/a-b');
  assert.deepEqual(commitsBetween(fx.root, 'main', 'HEAD').map((c) => c.subject), ['work']);
  assert.deepEqual(changedFiles(fx.root, 'main'), ['new file.txt', 'src/sum.mjs']);
  run('switch', '-q', 'main');
  assert.deepEqual(deleteBranch(fx.root, 'APP-1/feature/a-b'), { deleted: true, warning: null });
  assert.equal(branchExists(fx.root, 'APP-1/feature/a-b'), false);
});

test('an untracked node_modules symlink does not count as a change (S4)', (t) => {
  const fx = makeWorktreeRepo(t, { files: { '.gitignore': 'node_modules/\n' } });
  mkdirSync(join(fx.base, 'shared-modules'));
  symlinkSync(join(fx.base, 'shared-modules'), join(fx.root, 'node_modules'));
  assert.equal(isClean(fx.root), true);
});
